"""SEMPHN data layer client — used by the /api/chat Function.

Fetches a small, page-relevant slice of real SEMPHN data from the
`domato_semphn` Postgres database on the existing AU East flexible server.
The chat Function then formats this slice as JSON in its system prompt
so Foundry (GPT-4o-mini) grounds its answer in real figures with
citations — no more hand-waving.

Connection:
  - Reads PG_CONN_STRING from SWA Application Settings
  - Uses the read-only role `semphn_reader` (SELECT on `semphn` schema only)
  - Connection cached at module level for warm Function calls
  - Hard 5s connect + 8s query timeout, 200-row LIMIT enforced server-side

Page → data mapping:

  HNA pages         → v_hna_chapter + matching v_kpis_catchment rows
  Dashboards page   → v_kpis_catchment + v_kpis_by_lga (top metrics) + v_recent_commissioning_30d
  Maps page         → v_kpis_by_lga (all 10 LGAs for the most-likely metric)

All queries are static SELECTs against curated views — no SQL generation
from user input, no risk of injection. The DB connection role can only
SELECT; even if a query were tampered with it could not write.
"""
from __future__ import annotations

import json
import logging
import os
from contextlib import contextmanager
from typing import Any, Dict, List, Optional

try:
    import psycopg2
    import psycopg2.extras
except Exception:  # noqa: BLE001 — soft fail if psycopg2 not yet installed
    psycopg2 = None
    psycopg2_extras = None

log = logging.getLogger("chat.semphn_data")

CONN_STRING_ENV = "PG_CONN_STRING"
CONNECT_TIMEOUT_S = 5
QUERY_TIMEOUT_MS = 8000  # set via SET statement_timeout
MAX_ROWS = 200

_conn_cache: Optional[Any] = None


def _connect() -> Optional[Any]:
    """Lazy-connect using PG_CONN_STRING. Cached per warm Function."""
    global _conn_cache
    if psycopg2 is None:
        log.warning("psycopg2 not available — skipping data lookup")
        return None
    if _conn_cache is not None and not _conn_cache.closed:
        return _conn_cache
    conn_string = os.environ.get(CONN_STRING_ENV, "").strip()
    if not conn_string:
        log.info("PG_CONN_STRING not set — skipping data lookup")
        return None
    try:
        _conn_cache = psycopg2.connect(conn_string, connect_timeout=CONNECT_TIMEOUT_S)
        _conn_cache.autocommit = True
        with _conn_cache.cursor() as cur:
            cur.execute(f"SET statement_timeout = {QUERY_TIMEOUT_MS}")
        return _conn_cache
    except Exception:
        log.exception("Failed to connect to domato_semphn")
        _conn_cache = None
        return None


@contextmanager
def _cursor():
    """Yield a dict-cursor with a fresh statement_timeout. Reconnects on stale conn."""
    conn = _connect()
    if conn is None:
        yield None
        return
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"SET statement_timeout = {QUERY_TIMEOUT_MS}")
            yield cur
    except psycopg2.InterfaceError:
        # Connection went stale — drop and let the next call reconnect.
        global _conn_cache
        try:
            conn.close()
        except Exception:
            pass
        _conn_cache = None
        yield None


def _fetch(sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Run a curated-view query. Returns [] on any error (logged)."""
    with _cursor() as cur:
        if cur is None:
            return []
        try:
            cur.execute(sql + f" LIMIT {MAX_ROWS}", params)
            rows = cur.fetchall()
            return [dict(r) for r in rows]
        except Exception:
            log.exception("Query failed: %s", sql[:80])
            return []


# ----------------------------------------------------------------------
# Page-specific lookups
# ----------------------------------------------------------------------

def lookup_for_page(page: str) -> Dict[str, Any]:
    """Return a JSON-serialisable dict of real SEMPHN data slices relevant to
    the active workbench page. Empty dict when DB unavailable."""
    page = (page or "").lower()
    if page.startswith("workbench-hna") or page == "hna":
        return _lookup_hna()
    if page.startswith("workbench-dashboards") or page == "dashboards":
        return _lookup_dashboards()
    if page.startswith("workbench-maps") or page == "maps":
        return _lookup_maps()
    return _lookup_default()


def _lookup_default() -> Dict[str, Any]:
    return {
        "catchment": _fetch(
            "SELECT metric_label, value, unit, source_id FROM semphn.v_kpis_catchment "
            "WHERE category IN ('demographics','service_capacity','workforce')"
        )
    }


def _lookup_hna() -> Dict[str, Any]:
    """All 10 HNA chapters (deck only — body truncated to keep prompt small)
    + catchment-wide KPIs for citation lookup."""
    chapters = _fetch(
        "SELECT chapter_no, slug, title, category, deck_md, priorities, sources "
        "FROM semphn.v_hna_chapter ORDER BY chapter_no"
    )
    catchment = _fetch(
        "SELECT metric_label, value, unit, source_id "
        "FROM semphn.v_kpis_catchment ORDER BY category, metric_label"
    )
    sources = _fetch(
        "SELECT source_id, name, publisher, cadence FROM semphn.v_data_source"
    )
    return {
        "chapters": _stringify_jsonb(chapters, ("priorities", "sources")),
        "catchment_kpis": catchment,
        "data_sources": sources,
    }


def _group_by_metric_sorted(rows: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Reshape a flat [{metric_code, lga_name, value, ...}] list into
    {metric_code: [rows pre-sorted by value DESC, ...]}. This enforces
    sort order through JSON structure — the model can't iterate the wrong
    way because each metric_code key has its own pre-ordered array."""
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        grouped.setdefault(r["metric_code"], []).append(r)
    for code, items in grouped.items():
        items.sort(key=lambda x: float(x.get("value") or 0), reverse=True)
        # Drop metric_code from each row inside its bucket — already in the key
        for it in items:
            it.pop("metric_code", None)
    return grouped


def _lookup_dashboards() -> Dict[str, Any]:
    """Catchment KPIs + per-LGA cuts for chart-worthy metrics + recent
    commissioning rows."""
    catchment = _fetch(
        "SELECT metric_code, metric_label, category, value, unit, source_id "
        "FROM semphn.v_kpis_catchment "
        "WHERE category IN ('demographics','service_capacity','workforce',"
        "                   'screening','funding','mental_health','first_nations',"
        "                   'homelessness','older')"
    )
    by_lga = _fetch(
        "SELECT metric_code, metric_label, lga_name, value, unit, source_id "
        "FROM semphn.v_kpis_by_lga "
        "WHERE metric_code IN ('mh_conditions_per_1k','first_nations_irseo',"
        "                      'homeless_rate_per_10k','gp_practices_count',"
        "                      'bulk_billing_pct') "
        "ORDER BY metric_code, value DESC"
    )
    recent = _fetch(
        "SELECT activity_name, lga_name, schedule_name, value_aud, status, "
        "       due_date, approved_at "
        "FROM semphn.v_recent_commissioning_30d"
    )
    funding = sorted(
        _fetch("SELECT code, name, value_aud, awp_status FROM semphn.v_funding_schedule"),
        key=lambda r: -float(r.get("value_aud") or 0),
    )
    return {
        "catchment_kpis": catchment,
        # Keyed by metric_code → pre-sorted desc by value. Iteration-order safe.
        "by_lga_ranked": _group_by_metric_sorted(by_lga),
        "recent_commissioning": recent,
        "funding_schedules_ranked": funding,
    }


def _lookup_maps() -> Dict[str, Any]:
    """LGA-keyed values for the most-likely choropleth metrics + LGA
    metadata for tile sizing/labelling."""
    lgas = _fetch(
        "SELECT lga_code, lga_name, short_name, corridor, area_km2 FROM semphn.v_lga"
    )
    by_lga = _fetch(
        "SELECT metric_code, metric_label, lga_code, lga_name, value, unit, source_id "
        "FROM semphn.v_kpis_by_lga "
        "WHERE metric_code IN ('mh_conditions_per_1k','first_nations_irseo',"
        "                      'homeless_rate_per_10k','gp_practices_count',"
        "                      'bulk_billing_pct')"
    )
    providers = _fetch(
        "SELECT type, lga_name, COUNT(*) AS provider_count "
        "FROM semphn.v_service_provider GROUP BY type, lga_name "
        "ORDER BY type, provider_count DESC"
    )
    return {
        "lgas": lgas,
        # Keyed by metric_code → pre-sorted desc by value
        "by_lga_ranked": _group_by_metric_sorted(by_lga),
        "providers_by_lga": providers,
    }


def _stringify_jsonb(rows: List[Dict[str, Any]], cols: tuple) -> List[Dict[str, Any]]:
    """JSONB cols come back as dict/list from psycopg2 — keep them as-is.
    But trim long body_md fields to keep the system prompt manageable."""
    out = []
    for r in rows:
        rr = dict(r)
        # Trim deck_md to a reasonable length (deck only, no body included)
        if "deck_md" in rr and isinstance(rr["deck_md"], str) and len(rr["deck_md"]) > 400:
            rr["deck_md"] = rr["deck_md"][:400] + "…"
        out.append(rr)
    return out


def render_for_prompt(page: str) -> str:
    """Return a compact string (~1-3KB) describing the page-relevant SEMPHN
    data slice, formatted for the system prompt. Returns '' if the DB is
    unavailable so the chat still works (just less grounded)."""
    data = lookup_for_page(page)
    if not data:
        return ""
    # Use compact JSON with default=str so dates/decimals serialise cleanly.
    try:
        body = json.dumps(data, default=str, separators=(",", ":"))
    except Exception:
        log.exception("Failed to serialise SEMPHN data slice")
        return ""
    # Hard cap on prompt enrichment. GPT-4o-mini handles 128K context easily,
    # so this only matters for cost. ~24KB ≈ 6K tokens — comfortable.
    # Truncation is by full-section now (drop tail keys) rather than mid-JSON
    # so the model never sees a malformed object.
    MAX_CHARS = 24000
    if len(body) <= MAX_CHARS:
        return body
    # Re-serialise with sections dropped one at a time until it fits.
    keys = list(data.keys())
    while keys and len(body) > MAX_CHARS:
        # Drop the largest remaining section
        sizes = [(k, len(json.dumps(data[k], default=str))) for k in keys]
        sizes.sort(key=lambda kv: -kv[1])
        drop_key = sizes[0][0]
        del data[drop_key]
        keys.remove(drop_key)
        try:
            body = json.dumps(data, default=str, separators=(",", ":"))
        except Exception:
            return ""
    # Mark which sections were dropped so the model can flag it
    dropped = [k for k in ("catchment_kpis", "kpis_by_lga", "recent_commissioning",
                           "funding_schedules", "chapters", "lgas",
                           "providers_by_lga", "data_sources") if k not in data]
    if dropped:
        body = body[:-1] + f',"_dropped":{json.dumps(dropped)}' + "}"
    return body
