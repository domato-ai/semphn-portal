-- ============================================================================
-- domato_semphn · initial schema + seed (migration 001)
--
-- Connects: domato_semphn database on svr-domato-realestate-aue (AU East)
-- Pattern : Mirrors the 4-schema layout used by every other Domato database
--           (domato_abs, domato_datavic, etc.)
--
-- Schemas:
--   semphn_raw  · staging from public + tenant data sources (one table per loader)
--   semphn_meta · catalog of sources, columns, refresh log
--   semphn_geo  · LGA + SA2 boundaries scoped to SEMPHN catchment
--   semphn      · curated views — what the chat NLQ + frontend reads
--
-- Read-only role 'semphn_reader' is the only role the NLQ Function uses.
-- Grants: SELECT on the v_* views, EXECUTE on a few helper functions.
-- ============================================================================

-- Required extensions (idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ----------------------------------------------------------------------------
-- Schemas
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS semphn_raw;
CREATE SCHEMA IF NOT EXISTS semphn_meta;
CREATE SCHEMA IF NOT EXISTS semphn_geo;
CREATE SCHEMA IF NOT EXISTS semphn;

COMMENT ON SCHEMA semphn_raw  IS 'Staged raw rows from each loader. Not for queries.';
COMMENT ON SCHEMA semphn_meta IS 'Source catalog, refresh log, column descriptions.';
COMMENT ON SCHEMA semphn_geo  IS 'LGA + SA2 boundaries for the SEMPHN catchment.';
COMMENT ON SCHEMA semphn      IS 'Curated views — the only schema the chat NLQ may read.';

-- ----------------------------------------------------------------------------
-- Reader role (read-only on curated views only)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'semphn_reader') THEN
    CREATE ROLE semphn_reader NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA semphn TO semphn_reader;

-- ============================================================================
-- semphn_meta · sources + refresh log
-- ============================================================================
CREATE TABLE IF NOT EXISTS semphn_meta.data_source (
  source_id     text PRIMARY KEY,
  name          text NOT NULL,
  publisher     text,
  url           text,
  cadence       text NOT NULL CHECK (cadence IN (
                  'one_off','census','triennial','annual','quarterly','monthly','weekly','ad_hoc'
                )),
  last_ingest_at timestamptz,
  next_due      date,
  owner_email   text,
  licence       text,
  notes         text
);

CREATE TABLE IF NOT EXISTS semphn_meta.refresh_log (
  id            bigserial PRIMARY KEY,
  source_id     text REFERENCES semphn_meta.data_source(source_id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  rows_loaded   int,
  status        text CHECK (status IN ('ok','failed','partial')),
  error_msg     text
);

-- ============================================================================
-- semphn_geo · the 10 SEMPHN LGAs (catchment scope)
-- ============================================================================
CREATE TABLE IF NOT EXISTS semphn_geo.lga (
  lga_code      char(5) PRIMARY KEY,
  lga_name      text NOT NULL,
  short_name    text,
  state         char(3) NOT NULL DEFAULT 'VIC',
  area_km2      numeric,
  corridor      text,              -- sub-regional grouping (Bayside, Growth, Inner, Peninsula)
  centroid_lat  numeric,
  centroid_lon  numeric
);
COMMENT ON TABLE semphn_geo.lga IS '10 LGAs in the SEMPHN catchment. Boundaries (geom) sourced from domato_abs.abs_geo.geo_area when the cross-DB FDW is wired.';

-- ============================================================================
-- semphn · curated base tables (queryable directly + via v_ views)
-- ============================================================================

-- KPI observations in long format. Add a new metric? Insert rows, no migration.
CREATE TABLE IF NOT EXISTS semphn.kpi_observation (
  id            bigserial PRIMARY KEY,
  metric_code   text NOT NULL,
  metric_label  text NOT NULL,
  category      text NOT NULL CHECK (category IN (
                  'demographics','disadvantage','first_nations','cald','older','homelessness',
                  'mental_health','aod','chronic','workforce','screening','immunisation',
                  'service_capacity','funding'
                )),
  lga_code      char(5) REFERENCES semphn_geo.lga(lga_code), -- NULL = catchment-wide
  period_start  date,
  period_end    date,
  value         numeric NOT NULL,
  unit          text NOT NULL CHECK (unit IN (
                  'pct','per_1k','per_100k','per_10k','count','aud','years','ratio','index_score'
                )),
  source_id     text REFERENCES semphn_meta.data_source(source_id),
  ingest_at     timestamptz NOT NULL DEFAULT now(),
  notes         text,
  UNIQUE (metric_code, lga_code, period_end)
);
CREATE INDEX IF NOT EXISTS ix_kpi_metric ON semphn.kpi_observation (metric_code);
CREATE INDEX IF NOT EXISTS ix_kpi_lga    ON semphn.kpi_observation (lga_code);

-- HNA chapters (one row per chapter, edits replace + version-bump)
CREATE TABLE IF NOT EXISTS semphn.hna_chapter (
  chapter_no    int PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  title         text NOT NULL,
  category      text NOT NULL,    -- "Foundations" | "Region overview" | "Priority population" | "Priority health" | "Workforce"
  deck_md       text,
  body_md       text,
  priorities    jsonb,            -- array of {text, ref?}
  recommendations jsonb,          -- array of {category, rec, ref}
  sources       jsonb,            -- array of source_ids cited
  version_tag   text NOT NULL DEFAULT 'v1.0',
  edition       text NOT NULL DEFAULT '2025-28',
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Service provider register (GPs, RACFs, pharmacies, ACCHS, headspace)
CREATE TABLE IF NOT EXISTS semphn.service_provider (
  provider_id   text PRIMARY KEY,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN (
                  'gp_practice','racf','pharmacy','acchs','headspace','community_health','hospital'
                )),
  lga_code      char(5) REFERENCES semphn_geo.lga(lga_code),
  address       text,
  postcode      char(4),
  centroid_lat  numeric,
  centroid_lon  numeric,
  accredited    boolean,
  bulk_billing_pct numeric,
  extras        jsonb,
  ingest_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_provider_type ON semphn.service_provider (type);
CREATE INDEX IF NOT EXISTS ix_provider_lga  ON semphn.service_provider (lga_code);

-- Funding schedules (the 11 SEMPHN AWPs)
CREATE TABLE IF NOT EXISTS semphn.funding_schedule (
  code          text PRIMARY KEY,
  name          text NOT NULL,
  fy            text NOT NULL,    -- 'FY26'
  value_aud     numeric NOT NULL,
  awp_status    text CHECK (awp_status IN ('draft','submitted','approved','published')),
  awp_approved_at date,
  mpr_due       date,             -- 12-month performance report due
  notes         text
);

-- Recent commissioning activity (CRM-style, drives the dashboard table)
CREATE TABLE IF NOT EXISTS semphn.commissioning_activity (
  id            bigserial PRIMARY KEY,
  activity_name text NOT NULL,
  lga_code      char(5) REFERENCES semphn_geo.lga(lga_code),
  schedule_code text REFERENCES semphn.funding_schedule(code),
  value_aud     numeric NOT NULL,
  status        text NOT NULL CHECK (status IN ('draft','in_review','approved','due','active','completed')),
  due_date      date,
  approved_at   date,
  notes         text
);
CREATE INDEX IF NOT EXISTS ix_commission_status ON semphn.commissioning_activity (status);

-- ============================================================================
-- semphn · curated views (v_*) — these are what the NLQ Function reads
-- ============================================================================

CREATE OR REPLACE VIEW semphn.v_lga AS
SELECT lga_code, lga_name, short_name, state, area_km2, corridor,
       centroid_lat, centroid_lon
FROM semphn_geo.lga;

CREATE OR REPLACE VIEW semphn.v_kpi_observation AS
SELECT k.metric_code, k.metric_label, k.category,
       k.lga_code, l.lga_name,
       k.period_start, k.period_end,
       k.value, k.unit,
       k.source_id, ds.name AS source_name, ds.url AS source_url, ds.cadence,
       k.ingest_at, k.notes
FROM semphn.kpi_observation k
LEFT JOIN semphn_geo.lga       l  ON l.lga_code = k.lga_code
LEFT JOIN semphn_meta.data_source ds ON ds.source_id = k.source_id;

CREATE OR REPLACE VIEW semphn.v_kpis_by_lga AS
SELECT lga_code, lga_name, category, metric_code, metric_label, unit,
       value, period_end, source_id
FROM semphn.v_kpi_observation
WHERE lga_code IS NOT NULL;

CREATE OR REPLACE VIEW semphn.v_kpis_catchment AS
SELECT category, metric_code, metric_label, unit, value, period_end, source_id
FROM semphn.v_kpi_observation
WHERE lga_code IS NULL;

CREATE OR REPLACE VIEW semphn.v_hna_chapter AS
SELECT chapter_no, slug, title, category, deck_md, body_md,
       priorities, recommendations, sources,
       version_tag, edition, updated_at
FROM semphn.hna_chapter
ORDER BY chapter_no;

CREATE OR REPLACE VIEW semphn.v_service_provider AS
SELECT s.provider_id, s.name, s.type,
       s.lga_code, l.lga_name,
       s.address, s.postcode,
       s.centroid_lat, s.centroid_lon,
       s.accredited, s.bulk_billing_pct, s.extras
FROM semphn.service_provider s
LEFT JOIN semphn_geo.lga l ON l.lga_code = s.lga_code;

CREATE OR REPLACE VIEW semphn.v_service_capacity AS
SELECT type, lga_code, COUNT(*) AS provider_count
FROM semphn.service_provider
GROUP BY type, lga_code;

CREATE OR REPLACE VIEW semphn.v_funding_schedule AS
SELECT code, name, fy, value_aud, awp_status, awp_approved_at, mpr_due, notes
FROM semphn.funding_schedule
ORDER BY value_aud DESC;

CREATE OR REPLACE VIEW semphn.v_recent_commissioning_30d AS
SELECT c.activity_name, c.lga_code, l.lga_name,
       c.schedule_code, f.name AS schedule_name,
       c.value_aud, c.status, c.due_date, c.approved_at, c.notes
FROM semphn.commissioning_activity c
LEFT JOIN semphn_geo.lga       l ON l.lga_code = c.lga_code
LEFT JOIN semphn.funding_schedule f ON f.code = c.schedule_code
WHERE c.approved_at >= (CURRENT_DATE - 30) OR c.status IN ('in_review','draft','due');

CREATE OR REPLACE VIEW semphn.v_data_source AS
SELECT source_id, name, publisher, url, cadence, last_ingest_at, next_due, licence
FROM semphn_meta.data_source;

-- ----------------------------------------------------------------------------
-- Reader grants — SELECT only on curated views
-- ----------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES    IN SCHEMA semphn TO semphn_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA semphn TO semphn_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA semphn GRANT SELECT ON TABLES TO semphn_reader;

-- Done.
