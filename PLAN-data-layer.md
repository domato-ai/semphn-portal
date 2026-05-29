# SEMPHN data layer · architectural plan

> **Purpose.** Build a single source of truth for everything SEMPHN-specific so the workbench chat (HNA / Dashboards / Maps) can ground its responses, charts and maps in real data — not handwave with hard-coded numbers.
>
> **Status.** Plan only. No infra changes have been made.

---

## TL;DR

| | |
|---|---|
| Where it lives | New `domato_semphn` database on the **existing** `svr-domato-realestate-aue` Postgres flexible server (AU East, B1ms Burstable, $0 incremental) |
| Pattern | Same 4-schema pattern your other databases already use: `semphn_raw` / `semphn_meta` / `semphn_geo` / `semphn` |
| Geography | Re-use the LGA + SA2 boundaries already loaded in `domato_abs.abs_geo.geo_area` — no duplication |
| Loaders | Python ETL scripts in a new `etl/` folder. Quarterly cadence for most public sources, weekly for tenant CRM, on-demand for HNA chapter content |
| Chat integration | New SWA Function `api/nlq` that takes a chat query → NLQ → safe SELECT against a **whitelisted curated view set** → returns JSON for the chat to format |
| Cost | **~$0/mo** to host (sits on existing server). LLM-side cost unchanged from current Foundry budget |
| Timeline | 1 week to MVP (loaders + curated views + NLQ endpoint), 4-6 weeks to full coverage of POLAR/rediCASE/CRM partnerships |

---

## 1. Where it lives

**Add a new database to the existing flexible server**, don't spin up a new one. The server is already running 8 databases on the same Burstable B1ms instance ($~50/mo total) with negligible CPU; adding `domato_semphn` costs nothing extra.

```
svr-domato-realestate-aue (AU East · Burstable B1ms)
├── domato_abs         ← keep, this is the canonical geography + ABS Census home
├── domato_admin       ← keep
├── domato_datavic     ← keep
├── domato_datansw     ← keep
├── domato_dataqld     ← keep
├── domato_datawa      ← keep
├── domato_datasa      ← keep
├── realestate_portal  ← keep
└── domato_semphn      ← NEW · everything SEMPHN-specific
```

If at some point we need to ring-fence the data physically (e.g. SEMPHN insists), we can split this off to its own instance later. For now, single-server is the right call.

---

## 2. Schema pattern (4 schemas, matches existing convention)

| Schema | Role | Examples |
|---|---|---|
| `semphn_raw` | Staging tables, one per source. Loader script writes here. No deduplication, no validation. | `raw_abs_census_g01_lga`, `raw_aihw_shs_clients`, `raw_polar_consults`, `raw_redicase_episodes`, `raw_crm_commissioning`, `raw_semphn_hna_chapter` |
| `semphn_meta` | Metadata — table catalog, column descriptions, source URLs, refresh times, contact owner. Drives the workbench's "Sources" panel. | `data_sources`, `column_catalog`, `refresh_log`, `lodgement_log` |
| `semphn_geo` | Subset of LGA + SA2 boundaries scoped to SEMPHN's catchment. Cached locally as foreign tables / materialised view of `domato_abs.abs_geo` so we don't duplicate. | `lga` (10 rows), `sa2` (~120 rows), `iare` (Indigenous Areas) |
| `semphn` | **Curated views** — clean, deduplicated, joined, ready for AI consumption. **This is what the chat NLQ queries against.** | `v_population_by_lga`, `v_kpi_observations`, `v_hna_chapters`, `v_service_providers`, `v_funding_schedules`, `v_recent_commissioning_30d` |

---

## 3. Tables · concrete shape

### `semphn_geo.lga`
| Column | Type | Notes |
|---|---|---|
| lga_code | char(5) | ABS LGA code (e.g. 21610 Casey) — primary key |
| lga_name | text | "Casey", "Greater Dandenong" |
| short_name | text | For UI chips |
| state | char(3) | "VIC" |
| area_km2 | numeric | |
| corridor | text | "South East Growth" \| "Bayside" \| "Inner" \| "Peninsula" — SEMPHN sub-regional grouping |
| geom | geometry(MultiPolygon, 4326) | From `domato_abs.abs_geo.geo_area` |

10 rows. Loaded once.

### `semphn.v_kpi_observations` — the workhorse table for dashboards

| Column | Type | Example |
|---|---|---|
| metric_code | text | `bowel_screening_rate`, `mh_conditions_per_1k`, `gp_fte_per_100k` |
| metric_label | text | "Bowel cancer screening rate" |
| lga_code | char(5) | Or `NULL` for catchment-wide |
| period_start | date | "2025-10-01" |
| period_end | date | "2025-12-31" |
| value | numeric | `47.5` |
| unit | text | `pct`, `per_1k`, `per_100k`, `count`, `aud` |
| source_id | text | FK → `semphn_meta.data_sources` |
| ingest_at | timestamptz | When loaded |

**Long format** (not wide). Easy to add new metrics without schema migration. The chat NLQ does `SELECT … WHERE metric_code IN (…)` and pivots client-side for charts.

### `semphn.v_hna_chapters`

| Column | Type |
|---|---|
| chapter_no | int (1-10) |
| chapter_slug | text |
| title | text |
| deck_md | text (markdown) |
| body_md | text (markdown) |
| priorities | jsonb (array of bullet objects) |
| key_insights | jsonb (Murray-style theme/insight/data-ref) |
| recommendations | jsonb |
| sources | jsonb |
| version_tag | text |
| edition | text (`2025-28-v1.2`) |
| updated_at | timestamptz |

Backs the HNA workbench. Each chapter is a row. Chat can read + edit + version.

### `semphn.v_service_providers`

| Column | Type | Notes |
|---|---|---|
| provider_id | text | AHPRA or ABN-derived |
| name | text | |
| type | text | `gp_practice`, `racf`, `pharmacy`, `acchs`, `headspace`, `phn_office` |
| lga_code | char(5) | |
| address | text | |
| geom | geometry(Point, 4326) | For map plotting |
| accredited | bool | RACGP accreditation flag |
| bulk_billing_pct | numeric | For GP practices |
| extras | jsonb | Per-type fields without schema bloat |

~1,800 rows (497 GPs + 155 RACFs + 410 pharmacies + 2 ACCHS + 9 headspace + misc).

### `semphn.v_funding_schedules` — the 11 schedules

`code`, `name`, `fy26_value_aud`, `awp_status`, `awp_approved_at`, `mpr_due`, `notes`.

### `semphn_meta.data_sources` — the citation register

| Column | Type | Example |
|---|---|---|
| source_id | text | `abs_census_2021_g01` |
| name | text | "ABS Census 2021 — Selected Person Characteristics" |
| publisher | text | "Australian Bureau of Statistics" |
| url | text | |
| cadence | text | `annual`, `quarterly`, `monthly`, `census`, `triennial`, `ad_hoc` |
| last_ingest_at | timestamptz | |
| next_due | date | |
| owner_email | text | Who to chase |
| licence | text | Open / DUA / tenant-only |

Every figure on every workbench output cites a `source_id` from here. The chat can answer "where did 47.5% come from?" by joining back to this.

---

## 4. Data sources · loading plan

| Source | What it gives us | Cadence | Load method | Phase |
|---|---|---|---|---|
| **ABS Census 2021** (G01–G18, G36) | Population, age, language, country of birth, First Nations, education, income, housing per LGA + SA2 | One-off (5-yearly) | Already loaded in `domato_abs` — write a cross-DB curated view | 1 |
| **ABS ERP** (cat. 3218.0) | Population estimates updated annually | Annual | Already loaded — view | 1 |
| **ABS SEIFA 2021** | IRSD / IRSEO disadvantage indices by LGA | Census-linked | Already loaded — view | 1 |
| **AIHW PHN performance indicators** | Bowel/breast/cervical screening, immunisation, MH KPIs | Annual | Python loader → `semphn_raw.raw_aihw_phn_indicators` | 1 |
| **AIHW SHS NMDS** | Specialist Homelessness Services clients by SA | Annual | Python loader | 1 |
| **AIHW AODTS NMDS** | AOD treatment episodes | Annual | Python loader | 1 |
| **AIHW MyHospitals** | Hospital + ED activity at hospital level | Quarterly | Already partly loaded in `domato_abs` — view | 1 |
| **VAED via VAHI** | Victorian admitted episodes (linkable at SA2) | Quarterly | DUA-dependent · Python loader | 2 |
| **VEMD via VAHI** | Victorian ED presentations | Quarterly | DUA-dependent · Python loader | 2 |
| **ACARA Schools** | School profile + locations | Annual | Already loaded in `domato_abs` — view | 1 |
| **AHPRA** | Registered practitioners by LGA | Monthly | Existing scraper (in `domato-abs/packages/etl`) — extend | 1 |
| **My Aged Care** | RACF provider register | Monthly | Python loader | 1 |
| **POLAR** (tenant) | De-identified GP records | Monthly | Tenant API · requires data-sharing agreement | **2** |
| **rediCASE** (tenant) | MH consumer service data | Weekly | Tenant API · DSA | **2** |
| **HealthMap** (tenant) | Service mapping | Quarterly | Tenant API · DSA | **2** |
| **SEMPHN CRM** (tenant) | Commissioning + contracts + providers | Weekly | Tenant API · DSA | **2** |
| **SEMPHN HNA 2025-28 PDF** | Chapter content + tables | Already published | One-time PDF extract → `semphn.v_hna_chapters` rows | **1** |
| **SEMPHN Strategic Plan + AWP funding summaries** | 11 funding schedules, strategy pillars | Annual | Manual seed → table | **1** |

**Phase 1 = public data + SEMPHN published documents** = launchable in 1 week with what's freely accessible.
**Phase 2 = tenant data** = needs a data-sharing agreement with SEMPHN to enable POLAR / rediCASE / CRM connectors. 4-6 weeks once agreement signs.

---

## 5. Chat → data path

```
[ User types in /dashboards chat: "bowel screening by LGA, lowest 3 highlighted" ]
        │
        ▼
[ Frontend POST /api/chat  + active page = dashboards ]
        │
        ▼
[ /api/chat Function ]
        │  Sees the question shape, decides "this needs data"
        │  Calls /api/nlq with the user's question + page context
        ▼
[ /api/nlq Function ]                       ← NEW
        │  Uses Foundry GPT-4o-mini to translate to a SELECT against
        │  the WHITELISTED set of curated views in schema 'semphn'.
        │  Validates: SELECT only, named view only, max 5000 rows,
        │  10s timeout, no DDL, no joins outside whitelist.
        ▼
[ Postgres · domato_semphn.semphn.v_kpi_observations ]
        │  Returns rows
        ▼
[ /api/nlq returns { sql, rows, columns, source_ids } ]
        │
        ▼
[ /api/chat passes the rows back to Foundry GPT-4o-mini as TOOL OUTPUT ]
        │
        ▼
[ Model writes the reply — for a dashboards page, returns a Vega-Lite
  or simple chart spec + citation list. Frontend renders SVG. ]
        │
        ▼
[ Chat turn appears: prompt → chart artefact → "Source: AIHW Cancer
  Screening Program 2025". Pin / Edit / Export buttons. ]
```

Key safety properties:
- **Whitelist-only views** — the NLQ Function holds a hard-coded list of views it's allowed to query (~12 to start). Model cannot reach into `raw` tables or other databases.
- **Read-only role** — new Postgres role `semphn_reader` with SELECT-only grant on the `semphn` schema. No write, no DROP, no other databases.
- **Hard limits** — `SET statement_timeout = '10s'; SET LOCK_TIMEOUT = '5s';` on every query. `LIMIT 5000` enforced.
- **Citation discipline** — every row carries its `source_id`. The chat must show the source line. If it can't cite, it should say "no data".

---

## 6. Where this plugs into the workbench

| Workbench page | What `domato_semphn` gives it |
|---|---|
| **/hna** | `v_hna_chapters` for the document on the right · `v_kpi_observations` for figure look-ups when drafting · `data_sources` for the footnote line |
| **/dashboards** | `v_kpi_observations` (long form) + per-LGA cuts · drives the KPI cards, charts, recent-commissioning table |
| **/maps** | `semphn_geo.lga` (boundaries) + `v_kpi_observations` (values) for choropleth · `v_service_providers` (point geom) for overlays |

---

## 7. Cost

| Line item | Now | After this plan |
|---|---|---|
| Postgres flexible server (B1ms Burstable) | ~$50/mo (existing, shared across 8 DBs) | **same** — adding a 9th DB is free |
| Storage (initially ~1 GB SEMPHN data) | — | <$1/mo |
| Backups | included in existing | included |
| Network egress to SWA Functions | ~negligible | ~negligible |
| LLM via Foundry (per the budget alert already on $50/mo) | varies | unchanged |
| **Net additional** | | **~$0 / month** |

If we later move to a dedicated B2s for SEMPHN-only data sovereignty, add ~$30-50/mo. Not needed for Phase 1.

---

## 8. Phase 1 deliverables (1-week build)

1. Create `domato_semphn` database + 4 schemas + `semphn_reader` Postgres role
2. Loader scripts in `etl/`:
   - `etl/load_public_demographics.py` — cross-DB views from `domato_abs`
   - `etl/load_aihw_indicators.py` — AIHW PHN indicators bundle
   - `etl/load_aihw_shs.py` — Specialist Homelessness Services NMDS
   - `etl/load_aihw_aodts.py` — AOD Treatment Services NMDS
   - `etl/load_ahpra.py` — Practitioner counts by LGA
   - `etl/load_my_aged_care.py` — RACF register
   - `etl/load_semphn_hna_pdf.py` — Parse the published HNA PDF into chapter rows
   - `etl/seed_semphn_funding.py` — Manual seed of the 11 funding schedules
3. Curated views in `semphn` schema (~12 views)
4. `data_sources` register populated
5. New SWA Function `api/nlq` — NLQ endpoint with whitelist + safety
6. Wire `api/chat` to call `api/nlq` when the question is data-shaped
7. Frontend: each page renders the returned rows (chart for /dashboards, paragraph for /hna, map for /maps)

## 9. Phase 2 (4-6 weeks, partnership-gated)

1. Data-sharing agreement with SEMPHN (POLAR + rediCASE + CRM + HealthMap)
2. Tenant-data connectors using their published APIs
3. Tenant-data refresh schedule (weekly for CRM, monthly for POLAR, etc.)
4. Audit trail — every tenant-data query logged with user + timestamp

---

## Open questions for you

1. **Repo location for the ETL.** Add `etl/` to the existing `domato-ai/semphn-portal` repo, or carve a sibling repo `domato-ai/semphn-data`? Recommendation: keep it in `semphn-portal/etl/` for now — it's small, single-purpose, and shares the SWA's CI/CD.
2. **Tenant-data DSA timeline.** SEMPHN's own data is where the real value lives. When can you start the partnership conversation?
3. **HNA chapter ownership.** Once loaded into `v_hna_chapters`, who's the final approver for edits the AI suggests? Just SEMPHN's strategy lead, or a board sub-committee?
4. **Schema sovereignty.** Are you OK with this sitting on the same Postgres instance as the SuburbIQ / DataNSW / etc. databases (single bill, simpler ops), or do you need it physically separate for the SEMPHN partnership conversation?

---

> Once you sign off on this plan, Phase 1 is ~3 days of work to build the loaders + curated views + NLQ endpoint, then ~2 days to wire it into the workbench so the chat starts returning real grounded answers. Total: 1 week to a workbench that's no longer hand-waving.
