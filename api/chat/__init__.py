"""Chat-assist Function for the SEMPHN HNA Workbench.

POST /api/chat — body JSON:
  {
    "step_slug": "04-first-nations",     # required
    "step_name": "First Nations people", # required
    "messages": [                        # required: prior conversation + latest user msg
      {"role": "user", "content": "What's the strongest finding here?"},
      ...
    ],
    "context_summary": "Catchment 7,500 First Nations residents; MH prevalence..."  # optional
  }

Sends to Azure AI Foundry (OpenAI-compatible Inference API) using model determined
by MODEL_TIER env var (default: 'mini' = gpt-4o-mini).

Returns:
  { "reply": "<assistant text>", "model": "<deployment name>" }
  { "error": "<message>" } on failure

SWA Application Settings required (set after deploy):
  AZURE_FOUNDRY_ENDPOINT  — e.g. https://aif-semphn-portal.<region>.inference.azure.com
  AZURE_FOUNDRY_KEY       — primary key from Foundry → Keys
  MODEL_TIER              — 'mini' (default) | 'sonnet' (Phase 2)
  MODEL_MINI_DEPLOYMENT   — Foundry deployment name for mini path (default 'gpt-4o-mini')
  MODEL_SONNET_DEPLOYMENT — Foundry deployment name for sonnet path (default 'claude-sonnet-4-5')

Cost & safety:
  - Hard per-call message cap (10 messages back). Older history truncated.
  - Total response cap: 600 output tokens (per call).
  - Rate-limit: in-memory token bucket per client IP (200 requests / day).
    NOTE: SWA Functions are stateless across cold starts → this is best-effort.
    For real rate limiting, swap to Azure Table Storage in Phase 1.5.

System prompt is built per-step from a small static dict — when Phase 2 lands and
each step has live SEMPHN data in the payload, the system prompt can pull richer
context dynamically.
"""
from __future__ import annotations

import json
import logging
import os
import time
from collections import defaultdict, deque

import azure.functions as func
from openai import AzureOpenAI, OpenAIError

from . import semphn_data  # local module — fetches real rows from domato_semphn

log = logging.getLogger("chat")

# ---- Configuration ---------------------------------------------------------

DEFAULT_TIMEOUT_S = 25
MAX_HISTORY = 10
MAX_OUTPUT_TOKENS = 2200  # raised from 600 — a 6-tile dashboard reply
                          # serialises to ~1.8K tokens of JSON. Cost impact
                          # per request: ~$0.001 at gpt-4o-mini rates.
RATE_LIMIT_REQUESTS_PER_DAY = 200

DEFAULT_DEPLOYMENTS = {
    "mini":   "gpt-4o-mini",
    "sonnet": "claude-sonnet-4-5",
}

# Per-step system prompt — keeps the model grounded in what the user is doing.
STEP_PROMPTS = {
    "01-introduction":     "the methodology + frameworks chapter — Bradshaw's Taxonomy of Need, Dahlgren-Whitehead SDOH, DoH triangulation matrix",
    "02-region":           "the regional overview — 10 LGAs, 1.56M residents, 24% of Victoria, projected 2M by 2030",
    "03-cald":             "the CALD priority population — 1 in 3 residents born overseas, concentrated in Casey + Greater Dandenong",
    "04-first-nations":    "the First Nations priority population — catchment IRSEO 25 vs Vic 14, MH the most common chronic condition",
    "05-older-people":     "the 65+ priority population — 16.2% of catchment, +29.7% projected growth to 2030",
    "06-homelessness":     "the homelessness priority population — 4,580 residents homeless or marginal; Greater Dandenong 149.5/10k",
    "07-mental-health":    "the mental health priority — Frankston highest MH conditions per 1k; Casey highest diagnosis share at 22.4%",
    "08-aod":              "the AOD priority — alcohol consistent with state; risky drinking highest in coastal LGAs",
    "09-chronic-disease":  "chronic disease — dementia leading cause for women, CHD for men; multi-chronic highest in Mornington Peninsula",
    "10-workforce":        "the health workforce — 497 GPs, 2,813 practitioners, 155 RACFs, 2 ACCHS, bulk-billing concentrated in disadvantaged LGAs",
    "11-recommendations":  "aggregated recommendations across all 9 substantive chapters",
    "12-preflight":        "the DoH Compliance Checklist + Performance Rubric pre-flight check",
    "13-lodgement":        "final lodgement to PPERS",
}


def _cfg(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _deployment_for_tier(tier: str) -> str:
    if tier == "sonnet":
        return _cfg("MODEL_SONNET_DEPLOYMENT", DEFAULT_DEPLOYMENTS["sonnet"])
    return _cfg("MODEL_MINI_DEPLOYMENT", DEFAULT_DEPLOYMENTS["mini"])


def _system_prompt(step_slug: str, step_name: str, context_summary: str) -> str:
    """Build a system prompt with both the static page description AND a
    fresh slice of real SEMPHN data fetched from domato_semphn. The model
    grounds its answer in real numbers — no more hand-waving."""
    step_desc = STEP_PROMPTS.get(step_slug, f"step '{step_name}'")
    parts = [
        "You are an assistant for SEMPHN (South Eastern Melbourne Primary Health Network) "
        "staff preparing their 2025-2028 Health Needs Assessment annual update for "
        "lodgement to the Australian Department of Health and Aged Care via PPERS.",
        f"The user is currently on {step_desc}.",
        "Help them frame priorities, draft narrative, and decide what rises to a "
        "recommendation in the lodged HNA.",
        "Be concise: 2-4 sentences unless they ask for a draft paragraph.",
        "Cite specific LGA names and figures from the SEMPHN data below where "
        "relevant. When you cite a figure, append the source_id in parentheses "
        "e.g. '116.1 (semphn_hna_2025_28)'.",
        "When listing rows from a data array, PRESERVE the order they arrive "
        "in (the DB query already sorted them how the user likely wants). "
        "If you need to re-rank, sort BY THE NUMERIC VALUE — never by the order "
        "you happened to list them.",
        "Format responses in markdown: **bold** key figures, use bullet lists "
        "for multiple items, use `code` for metric_codes.",
        "Australian English. Australian healthcare terminology.",
        "Never invent figures. If a figure isn't in the SEMPHN data below or in "
        "the conversation, say so plainly — don't guess. If the data slice "
        "shows `_dropped` listing some sections, tell the user that section was "
        "too large to fit and offer to query a narrower cut.",
    ]
    # ---- Maps page · LIVE MAP OVERLAY mode (different from Dashboards) ----
    if "maps" in step_slug:
        parts.append(
            "\n=== LIVE MAP OVERLAY MODE ===\n"
            "You are decorating an interactive Leaflet map of the SEMPHN catchment "
            "that the user already sees full-screen. The map shows all 10 LGA "
            "polygons + bundled service-point markers (ACCHS, headspace, hospitals) "
            "on real OSM tiles. EVERY user turn should produce a `choropleth` "
            "widget that recolors the LGAs based on a metric — that's the whole "
            "point of this page.\n\n"
            "Always emit a widget. Don't ask clarifying questions when the user's "
            "intent is reasonably clear — just produce the most useful map and "
            "let them refine. Keep prose to 1 short sentence ('Mapped X by LGA, "
            "highest in Y.'). The legend + interactive map speak for themselves.\n\n"
            "Available SEMPHN/ABS data sources (use real values from the data "
            "slice below, never fabricate):\n"
            "  • ABS Census 2021 — population, age, language, IRSEO\n"
            "  • ABS SEIFA 2021 — disadvantage deciles by LGA\n"
            "  • POLAR primary-care data — chronic conditions, MH prevalence, "
            "screening rates per 1,000 residents by LGA\n"
            "  • AIHW PHIDU — bulk-billing %, GP encounters, avoidable hosp.\n"
            "  • SEMPHN commissioning — FY26 funding schedules + activities\n"
            "  • SEMPHN service-locator — ACCHS, headspace, GP practices\n\n"
            "If the metric the user asked for isn't in the data slice, pick the "
            "closest real metric AND mention the swap in your prose. NEVER guess "
            "values just to fill all 10 LGAs.\n\n"
            "Widget schema (return ONLY these fields, no extras):\n"
            "```widget\n"
            "{\n"
            '  "type": "choropleth",\n'
            '  "title": "<short title shown on the map indicator chip>",\n'
            '  "unit": "pct" | "per_1k" | "per_10k" | "per_100k" | "count" | "aud",\n'
            '  "unit_label": "<friendly axis label, e.g. \\"per 1,000 residents\\">",\n'
            '  "source_id": "<source_id from data slice>",\n'
            '  "highlight": "<optional LGA name to outline in ink>",\n'
            '  "data": [{"label": "Frankston", "value": 116.1}, ...]\n'
            "}\n"
            "```\n"
            "Labels MUST be one of the 10 SEMPHN LGA names exactly: Bayside, "
            "Cardinia, Casey, Frankston, Glen Eira, Greater Dandenong, Kingston, "
            "Mornington Peninsula, Port Phillip, Stonnington. Missing LGAs render "
            "as 'no data' (grey)."
        )

    # ---- Dashboards page · widget-builder mode ----
    elif "dashboards" in step_slug:
        parts.append(
            "\n=== DASHBOARD BUILDER MODE ===\n"
            "When the user asks for a chart, KPI, table or anything that should "
            "land as a tile on their dashboard, emit one or more fenced "
            "```widget code blocks each containing a JSON object. The frontend "
            "parses every ```widget block and renders each as a tile.\n\n"
            "IMPORTANT — multi-widget responses:\n"
            "  • If the user asks for a 'complete dashboard', 'full dashboard', "
            "'multiple widgets', or anything that calls for more than one tile, "
            "emit ALL widgets in the same reply, each in its own ```widget block.\n"
            "  • A good catchment dashboard is 4-6 tiles: 1-2 KPIs, 1-2 bars, "
            "1 donut or table. Mix types — don't repeat the same chart.\n"
            "  • Use ```widget for EVERY widget block. NEVER use bare ``` or "
            "```json — those won't be picked up by the renderer.\n"
            "  • Keep prose to ONE short sentence at the very start "
            "('Here's a 5-tile dashboard…') and put NOTHING between blocks. "
            "Don't title or number the tiles in prose — the title field does that.\n\n"
            "Widget schema (return ONLY these fields, no extras):\n"
            "```widget\n"
            "{\n"
            '  "type": "bar" | "line" | "area" | "donut" | "kpi" | "table" | "choropleth",\n'
            '  "title": "<short title shown on the tile>",\n'
            '  "subtitle": "<one line of context>",\n'
            '  "unit": "pct" | "per_1k" | "per_10k" | "per_100k" | "count" | "aud",\n'
            '  "source_id": "<the source_id from the data>",\n'
            '  "data": [...],   // shape depends on type — see below\n'
            '  "highlight": "<optional label of the row/slice to emphasise (bar/donut)>",\n'
            '  "delta": "<optional, KPI only: \\"+8.6%\\" or \\"-2.4%\\">"\n'
            "}\n"
            "```\n\n"
            "Data shapes:\n"
            "  bar:        [{\"label\": \"Frankston\", \"value\": 116.1}, ...]"
            " — pre-sorted desc by value.\n"
            "  line/area:  [{\"label\": \"FY22\", \"value\": 72.4}, ...]"
            " — pre-sorted ascending by time / x-axis.\n"
            "  donut:      [{\"label\": \"Mental health\", \"value\": 25.6e6}, ...]"
            " — slices auto-sum to 100%. Use for share-of-total.\n"
            "  kpi:        [{\"label\": \"Catchment population\", \"value\": 1638200}]"
            " — single entry.\n"
            "  table:      [{\"<col1>\": ..., \"<col2>\": ...}, ...]"
            " — array of column-keyed rows.\n"
            "  choropleth: [{\"label\": \"Frankston\", \"value\": 116.1}, ...]"
            " — one entry per LGA. Labels MUST match the 10 SEMPHN LGA names"
            " exactly (Bayside, Cardinia, Casey, Frankston, Glen Eira,"
            " Greater Dandenong, Kingston, Mornington Peninsula, Port Phillip,"
            " Stonnington). Missing LGAs render as 'no data'.\n\n"
            "Picking the right type:\n"
            "  • Compare across LGAs / categories  → bar\n"
            "  • Change over time (3+ points)      → line (or area for total magnitude)\n"
            "  • Share of a whole / breakdown      → donut\n"
            "  • Single headline number            → kpi\n"
            "  • Mixed columns (names + status)    → table\n"
            "  • Spatial pattern across LGAs       → choropleth (Maps page only)\n\n"
            "Rules:\n"
            "  • USE REAL VALUES from the SEMPHN data slice — no fabricating.\n"
            "  • Title MUST match what was asked.\n"
            "  • Keep your prose reply VERY short (1 sentence) explaining what you built. "
            "The widget speaks for itself; don't repeat the values in prose.\n"
            "  • If the user asks for something the data doesn't support, "
            "say so in prose and DON'T emit a widget block."
        )
    if context_summary:
        parts.append(f"\nStep-specific data context:\n{context_summary.strip()}")
    # ---- NEW: inject a page-relevant slice of real SEMPHN data ----
    db_slice = semphn_data.render_for_prompt(step_slug)
    if db_slice:
        parts.append(
            "\nLive SEMPHN data slice (from the domato_semphn database, fetched "
            "this request). Treat as authoritative. Cite source_id values when "
            "you use a figure:\n```json\n" + db_slice + "\n```"
        )
    return "\n".join(parts)


# ---- Rate limiting (in-memory, best-effort) --------------------------------
_buckets: dict[str, deque] = defaultdict(deque)


def _allowed(client_id: str) -> bool:
    now = time.time()
    day_ago = now - 86400
    b = _buckets[client_id]
    while b and b[0] < day_ago:
        b.popleft()
    if len(b) >= RATE_LIMIT_REQUESTS_PER_DAY:
        return False
    b.append(now)
    return True


def _client_id(req: func.HttpRequest) -> str:
    fwd = req.headers.get("x-forwarded-for") or req.headers.get("X-Forwarded-For") or ""
    if fwd:
        # Take the first IP, strip any port
        ip = fwd.split(",")[0].strip()
        if ":" in ip and "." in ip:
            ip = ip.split(":")[0]
        return ip
    return "anonymous"


# ---- Response helpers ------------------------------------------------------
def _cors_headers() -> dict:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }


def _json_response(payload: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        body=json.dumps(payload),
        status_code=status,
        mimetype="application/json",
        headers=_cors_headers(),
    )


# ---- Main handler ----------------------------------------------------------
def main(req: func.HttpRequest) -> func.HttpResponse:
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=_cors_headers())

    # Rate limit
    cid = _client_id(req)
    if not _allowed(cid):
        log.warning("rate-limited %s", cid)
        return _json_response(
            {"error": "Too many requests. Daily limit reached. Try again tomorrow."},
            status=429,
        )

    # Parse body
    try:
        body = req.get_json()
    except ValueError:
        return _json_response({"error": "Body must be valid JSON."}, status=400)

    step_slug = (body.get("step_slug") or "").strip()
    step_name = (body.get("step_name") or "").strip()
    messages_in = body.get("messages") or []
    context_summary = (body.get("context_summary") or "").strip()

    if not step_slug or not step_name:
        return _json_response(
            {"error": "step_slug and step_name are required."}, status=400
        )
    if not isinstance(messages_in, list) or not messages_in:
        return _json_response({"error": "messages must be a non-empty list."}, status=400)

    # Truncate history to the most recent MAX_HISTORY turns
    history = [
        {"role": m.get("role"), "content": m.get("content")}
        for m in messages_in[-MAX_HISTORY:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    if not history:
        return _json_response({"error": "no valid messages in history."}, status=400)

    # Config check
    endpoint = _cfg("AZURE_FOUNDRY_ENDPOINT")
    key = _cfg("AZURE_FOUNDRY_KEY")
    tier = _cfg("MODEL_TIER", "mini").lower()
    if not endpoint or not key:
        log.error("Foundry config missing — set AZURE_FOUNDRY_ENDPOINT + AZURE_FOUNDRY_KEY")
        return _json_response(
            {"error": "Chat assist is not configured. Contact support@domato.ai."},
            status=503,
        )

    deployment = _deployment_for_tier(tier)
    system_prompt = _system_prompt(step_slug, step_name, context_summary)

    # Build the prompt
    messages = [{"role": "system", "content": system_prompt}] + history

    # Call Foundry via the OpenAI-compatible API
    try:
        client = AzureOpenAI(
            azure_endpoint=endpoint,
            api_key=key,
            api_version="2024-08-01-preview",
            timeout=DEFAULT_TIMEOUT_S,
        )
        completion = client.chat.completions.create(
            model=deployment,
            messages=messages,
            max_tokens=MAX_OUTPUT_TOKENS,
            temperature=0.4,
        )
    except OpenAIError as e:
        log.exception("Foundry API call failed")
        return _json_response(
            {"error": "Chat assist temporarily unavailable. Try again in a moment."},
            status=502,
        )
    except Exception:
        log.exception("Unexpected error in chat handler")
        return _json_response(
            {"error": "Unexpected error. Try again in a moment."}, status=500
        )

    if not completion.choices:
        return _json_response({"error": "Model returned no choices."}, status=502)
    reply = (completion.choices[0].message.content or "").strip()
    if not reply:
        return _json_response({"error": "Model returned an empty reply."}, status=502)

    return _json_response({"reply": reply, "model": deployment})
