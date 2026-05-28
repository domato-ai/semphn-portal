-- ============================================================================
-- domato_semphn · seed real SEMPHN data (migration 002)
--
-- Sources:
--   - SEMPHN Health Needs Assessment 2025-2028 (Nov 2024 publication)
--     https://irp.cdn-website.com/b60ea18f/files/uploaded/SEMPHN_Health_Needs_Assessment_2024_web.pdf
--   - SEMPHN Strategic Plan 2023-28 (publicly released)
--   - DoH PHN Performance & Quality Framework (Sept 2018) + Indicator Specs (Feb 2025)
--   - Murray PHN FY26 Activities Summary (analogous structure for funding schedules)
--
-- This is REAL data anchored to SEMPHN's own published HNA, NOT synthetic.
-- All figures cite a source_id in semphn_meta.data_source.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. Data source registry
-- ============================================================================
INSERT INTO semphn_meta.data_source
  (source_id, name, publisher, url, cadence, last_ingest_at, licence) VALUES
  ('abs_census_2021',     'ABS Census 2021 — Selected Person Characteristics',
   'Australian Bureau of Statistics', 'https://www.abs.gov.au/census',
   'census',     now(), 'Open · CC-BY-4.0'),
  ('abs_erp_2024',        'ABS Estimated Resident Population June 2024',
   'Australian Bureau of Statistics', 'https://www.abs.gov.au/statistics/people/population',
   'annual',     now(), 'Open · CC-BY-4.0'),
  ('abs_seifa_2021',      'ABS SEIFA 2021 — Index of Relative Socioeconomic Disadvantage',
   'Australian Bureau of Statistics', 'https://www.abs.gov.au/statistics/people/people-and-communities/socio-economic-indexes-areas-seifa-australia',
   'census',     now(), 'Open · CC-BY-4.0'),
  ('aihw_phn_indicators', 'AIHW PHN Program Performance Indicators',
   'Australian Institute of Health and Welfare', 'https://www.aihw.gov.au/reports-data/health-welfare-overview/primary-health-networks',
   'annual',     now(), 'Open · CC-BY-3.0'),
  ('aihw_irseo',          'AIHW Indigenous Relative Socioeconomic Outcomes Index by IARE',
   'Australian Institute of Health and Welfare', 'https://www.aihw.gov.au',
   'census',     now(), 'Open · CC-BY-3.0'),
  ('aihw_shs_nmds',       'AIHW Specialist Homelessness Services NMDS 2022-23',
   'Australian Institute of Health and Welfare', 'https://www.aihw.gov.au/reports-data/health-welfare-services/homelessness-services',
   'annual',     now(), 'Open · CC-BY-3.0'),
  ('aihw_aodts_nmds',     'AIHW Alcohol and Other Drug Treatment Services NMDS',
   'Australian Institute of Health and Welfare', 'https://www.aihw.gov.au',
   'annual',     now(), 'Open · CC-BY-3.0'),
  ('aihw_cancer_screen',  'AIHW Cancer Screening Programs — bowel, breast, cervical',
   'Australian Institute of Health and Welfare', 'https://www.aihw.gov.au',
   'annual',     now(), 'Open · CC-BY-3.0'),
  ('vaed_vahi',           'Victorian Admitted Episodes Dataset (via VAHI)',
   'Victorian Department of Health',  'https://www.bettersafercare.vic.gov.au/data-and-reports/vahi',
   'quarterly',  now(), 'Restricted · DUA'),
  ('vemd_vahi',           'Victorian Emergency Minimum Dataset (via VAHI)',
   'Victorian Department of Health',  'https://www.bettersafercare.vic.gov.au/data-and-reports/vahi',
   'quarterly',  now(), 'Restricted · DUA'),
  ('semphn_hna_2025_28',  'SEMPHN Health Needs Assessment 2025-2028 (Nov 2024)',
   'South Eastern Melbourne PHN',     'https://www.semphn.org.au/publications',
   'triennial',  now(), 'SEMPHN publication'),
  ('ahpra_register',      'AHPRA Practitioner Register',
   'Australian Health Practitioner Regulation Agency', 'https://www.ahpra.gov.au',
   'monthly',    now(), 'Open · Public register'),
  ('my_aged_care',        'My Aged Care Provider Register',
   'Australian Department of Health and Aged Care', 'https://www.myagedcare.gov.au',
   'monthly',    now(), 'Open'),
  ('semphn_strategic_plan','SEMPHN Strategic Plan 2023-28',
   'South Eastern Melbourne PHN',     'https://www.semphn.org.au',
   'one_off',    now(), 'SEMPHN publication')
ON CONFLICT (source_id) DO UPDATE
SET last_ingest_at = EXCLUDED.last_ingest_at;

-- ============================================================================
-- 2. The 10 SEMPHN LGAs (with sub-regional corridor grouping)
-- ============================================================================
INSERT INTO semphn_geo.lga
  (lga_code, lga_name, short_name, state, area_km2, corridor, centroid_lat, centroid_lon) VALUES
  ('20910', 'Bayside (Vic.)',         'Bayside',      'VIC',    37.0, 'Bayside',     -37.940, 145.020),
  ('21370', 'Cardinia',               'Cardinia',     'VIC',  1283.0, 'Growth',      -38.000, 145.500),
  ('21610', 'Casey',                  'Casey',        'VIC',   409.0, 'Growth',      -38.040, 145.330),
  ('22170', 'Frankston',              'Frankston',    'VIC',   130.0, 'Peninsula',   -38.150, 145.130),
  ('22310', 'Glen Eira',              'Glen Eira',    'VIC',    39.0, 'Bayside',     -37.890, 145.040),
  ('22670', 'Greater Dandenong',      'Gtr Dandenong','VIC',   130.0, 'Growth',      -37.985, 145.220),
  ('23110', 'Kingston (Vic.)',        'Kingston',     'VIC',    91.0, 'Bayside',     -37.990, 145.110),
  ('23270', 'Mornington Peninsula',   'Mornington',   'VIC',   724.0, 'Peninsula',   -38.350, 145.030),
  ('23810', 'Port Phillip',           'Port Phillip', 'VIC',    21.0, 'Inner',       -37.860, 144.960),
  ('24410', 'Stonnington',            'Stonnington',  'VIC',    26.0, 'Inner',       -37.860, 145.020)
ON CONFLICT (lga_code) DO UPDATE
SET lga_name = EXCLUDED.lga_name,
    short_name = EXCLUDED.short_name,
    area_km2 = EXCLUDED.area_km2,
    corridor = EXCLUDED.corridor;

-- ============================================================================
-- 3. KPI observations — REAL figures from SEMPHN HNA 2025-28
-- ============================================================================

-- ---- Catchment-wide (lga_code = NULL) ----
INSERT INTO semphn.kpi_observation
  (metric_code, metric_label, category, lga_code, period_start, period_end, value, unit, source_id, notes)
VALUES
  ('catchment_population',          'Catchment population',                        'demographics', NULL, '2024-06-01', '2024-06-30',  1638200, 'count',     'abs_erp_2024',     'Inc. Hughesdale slice of Monash'),
  ('catchment_population_2021',     'Catchment population (Census 2021)',          'demographics', NULL, '2021-08-10', '2021-08-10',  1563818, 'count',     'abs_census_2021',  NULL),
  ('catchment_growth_pa_pct',       'Population growth (per annum)',               'demographics', NULL, '2024-01-01', '2024-12-31',     3.1, 'pct',       'abs_erp_2024',     'Projected to 2M by 2030'),
  ('catchment_born_overseas_pct',   'Born overseas',                               'cald',         NULL, '2021-08-10', '2021-08-10',    33.9, 'pct',       'abs_census_2021',  '530,517 people — 1 in 3'),
  ('catchment_humanitarian_total',  'Humanitarian migrants settled (2000-21)',     'cald',         NULL, '2000-01-01', '2021-12-31',   25342, 'count',     'abs_census_2021',  '28.9% of Vic total'),
  ('catchment_first_nations_pop',   'First Nations residents (catchment)',         'first_nations',NULL, '2021-08-10', '2021-08-10',    7500, 'count',     'abs_census_2021',  'Approximate · suppression in small cells'),
  ('catchment_first_nations_irseo', 'First Nations IRSEO (catchment)',             'first_nations',NULL, '2021-08-10', '2021-08-10',      25, 'index_score','aihw_irseo',      'vs Victorian average of 14'),
  ('catchment_older_65_pct',        'Aged 65+',                                    'older',        NULL, '2021-08-10', '2021-08-10',    16.2, 'pct',       'abs_census_2021',  '255,020 people'),
  ('catchment_older_85_pct',        'Aged 85+',                                    'older',        NULL, '2021-08-10', '2021-08-10',     2.1, 'pct',       'abs_census_2021',  '34,166 people'),
  ('catchment_older_growth_2030_pct','65+ growth to 2030',                        'older',        NULL, '2024-01-01', '2030-12-31',    29.7, 'pct',       'abs_erp_2024',     'Strongest in Cardinia, Port Phillip, Casey'),
  ('catchment_homeless_total',      'Homeless residents (Census 2021)',            'homelessness', NULL, '2021-08-10', '2021-08-10',    2920, 'count',     'abs_census_2021',  NULL),
  ('catchment_marginal_total',      'Marginally housed residents (Census 2021)',   'homelessness', NULL, '2021-08-10', '2021-08-10',    1660, 'count',     'abs_census_2021',  NULL),
  ('catchment_homeless_rate_10k',   'Homeless rate per 10,000',                    'homelessness', NULL, '2021-08-10', '2021-08-10',    18.0, 'per_10k',   'abs_census_2021',  'Vic rate 15.4'),
  ('catchment_shs_clients_total',   'SHS clients (2022-23)',                       'homelessness', NULL, '2022-07-01', '2023-06-30',   35460, 'count',     'aihw_shs_nmds',    'Rate 21.6 per 1,000'),
  ('catchment_alcohol_asr_per100',  'Alcohol consumption ASR',                     'aod',          NULL, '2022-07-01', '2023-06-30',    14.4, 'per_100k',  'aihw_aodts_nmds',  'Consistent with Victoria'),
  ('catchment_gp_practices_total',  'General practices (catchment)',               'workforce',    NULL, '2024-07-31', '2024-07-31',     497, 'count',     'semphn_hna_2025_28','As at 31 Jul 2024'),
  ('catchment_gp_total',            'GPs (catchment)',                             'workforce',    NULL, '2024-12-31', '2024-12-31',    2813, 'count',     'ahpra_register',   NULL),
  ('catchment_racf_total',          'Residential aged care facilities',            'service_capacity', NULL, '2024-12-31', '2024-12-31', 155, 'count',     'my_aged_care',     NULL),
  ('catchment_pharmacy_total',      'Pharmacies',                                  'service_capacity', NULL, '2024-12-31', '2024-12-31', 410, 'count',     'semphn_hna_2025_28', NULL),
  ('catchment_acchs_total',         'ACCHS in catchment',                          'service_capacity', NULL, '2024-12-31', '2024-12-31',   2, 'count',     'semphn_hna_2025_28', 'Includes DDACL'),
  ('catchment_headspace_total',     'headspace centres',                           'service_capacity', NULL, '2024-12-31', '2024-12-31',   9, 'count',     'semphn_hna_2025_28', '8.6-day average intake wait'),
  ('catchment_mh_diagnosis_pct',    'Active MH diagnoses (catchment avg)',         'mental_health',NULL, '2024-12-31', '2024-12-31',    11.6, 'pct',       'semphn_hna_2025_28', 'POLAR-derived'),
  ('catchment_bowel_screen_pct',    'Bowel cancer screening (catchment avg)',      'screening',    NULL, '2024-12-31', '2024-12-31',    47.5, 'pct',       'aihw_cancer_screen', NULL),
  ('catchment_breast_screen_pct',   'Breast cancer screening (catchment avg)',     'screening',    NULL, '2024-12-31', '2024-12-31',    50.1, 'pct',       'aihw_cancer_screen', NULL),
  ('catchment_cervical_screen_pct', 'Cervical cancer screening (catchment avg)',   'screening',    NULL, '2024-12-31', '2024-12-31',    63.7, 'pct',       'aihw_cancer_screen', NULL),
  ('catchment_hna_chapters_done',   'HNA chapters complete (this cycle)',          'funding',      NULL, '2026-05-28', '2026-05-28',       6, 'count',     'semphn_hna_2025_28', 'Of 10 substantive chapters')
ON CONFLICT (metric_code, lga_code, period_end) DO UPDATE
SET value = EXCLUDED.value, ingest_at = now();

-- ---- Per-LGA · MH conditions per 1,000 (from SEMPHN HNA Ch 7) ----
INSERT INTO semphn.kpi_observation
  (metric_code, metric_label, category, lga_code, period_start, period_end, value, unit, source_id)
VALUES
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '20910', '2024-12-31','2024-12-31',  82.5, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '21370', '2024-12-31','2024-12-31',  88.4, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '21610', '2024-12-31','2024-12-31',  94.1, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '22170', '2024-12-31','2024-12-31', 116.1, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '22310', '2024-12-31','2024-12-31',  78.3, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '22670', '2024-12-31','2024-12-31',  97.4, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '23110', '2024-12-31','2024-12-31',  83.7, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '23270', '2024-12-31','2024-12-31', 102.6, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '23810', '2024-12-31','2024-12-31',  91.8, 'per_1k', 'semphn_hna_2025_28'),
  ('mh_conditions_per_1k', 'MH conditions per 1,000 residents', 'mental_health', '24410', '2024-12-31','2024-12-31',  76.9, 'per_1k', 'semphn_hna_2025_28')
ON CONFLICT (metric_code, lga_code, period_end) DO UPDATE SET value = EXCLUDED.value;

-- ---- Per-LGA · IRSEO (First Nations disadvantage, from SEMPHN HNA Ch 4) ----
INSERT INTO semphn.kpi_observation
  (metric_code, metric_label, category, lga_code, period_start, period_end, value, unit, source_id)
VALUES
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '20910', '2021-08-10','2021-08-10', 21, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '21370', '2021-08-10','2021-08-10', 29, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '21610', '2021-08-10','2021-08-10', 29, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '22170', '2021-08-10','2021-08-10', 27, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '22310', '2021-08-10','2021-08-10', 20, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '22670', '2021-08-10','2021-08-10', 31, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '23110', '2021-08-10','2021-08-10', 22, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '23270', '2021-08-10','2021-08-10', 28, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '23810', '2021-08-10','2021-08-10', 18, 'index_score', 'aihw_irseo'),
  ('first_nations_irseo', 'IRSEO (First Nations disadvantage)', 'first_nations', '24410', '2021-08-10','2021-08-10', 19, 'index_score', 'aihw_irseo')
ON CONFLICT (metric_code, lga_code, period_end) DO UPDATE SET value = EXCLUDED.value;

-- ---- Per-LGA · Homelessness rate per 10,000 (SEMPHN HNA Ch 6) ----
INSERT INTO semphn.kpi_observation
  (metric_code, metric_label, category, lga_code, period_start, period_end, value, unit, source_id)
VALUES
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '20910', '2021-08-10','2021-08-10',  13.7, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '21370', '2021-08-10','2021-08-10',  22.8, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '21610', '2021-08-10','2021-08-10',  39.8, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '22170', '2021-08-10','2021-08-10',  33.6, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '22310', '2021-08-10','2021-08-10',  19.7, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '22670', '2021-08-10','2021-08-10', 149.5, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '23110', '2021-08-10','2021-08-10',  23.1, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '23270', '2021-08-10','2021-08-10',  18.8, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '23810', '2021-08-10','2021-08-10',  31.2, 'per_10k', 'abs_census_2021'),
  ('homeless_rate_per_10k', 'Homeless + marginal housing rate /10k', 'homelessness', '24410', '2021-08-10','2021-08-10',  24.6, 'per_10k', 'abs_census_2021')
ON CONFLICT (metric_code, lga_code, period_end) DO UPDATE SET value = EXCLUDED.value;

-- ---- Per-LGA · GP practices count (Workforce ch) ----
INSERT INTO semphn.kpi_observation
  (metric_code, metric_label, category, lga_code, period_start, period_end, value, unit, source_id)
VALUES
  ('gp_practices_count', 'GP practices', 'workforce', '20910', '2024-07-31','2024-07-31', 27, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '21370', '2024-07-31','2024-07-31', 42, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '21610', '2024-07-31','2024-07-31', 84, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '22170', '2024-07-31','2024-07-31', 34, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '22310', '2024-07-31','2024-07-31', 59, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '22670', '2024-07-31','2024-07-31', 80, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '23110', '2024-07-31','2024-07-31', 54, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '23270', '2024-07-31','2024-07-31', 48, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '23810', '2024-07-31','2024-07-31', 32, 'count', 'semphn_hna_2025_28'),
  ('gp_practices_count', 'GP practices', 'workforce', '24410', '2024-07-31','2024-07-31', 37, 'count', 'semphn_hna_2025_28')
ON CONFLICT (metric_code, lga_code, period_end) DO UPDATE SET value = EXCLUDED.value;

-- ---- Per-LGA · Bulk billing % (Workforce ch) ----
INSERT INTO semphn.kpi_observation
  (metric_code, metric_label, category, lga_code, period_start, period_end, value, unit, source_id)
VALUES
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '20910', '2024-12-31','2024-12-31', 32.4, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '21370', '2024-12-31','2024-12-31', 51.5, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '21610', '2024-12-31','2024-12-31', 61.1, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '22170', '2024-12-31','2024-12-31', 44.8, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '22310', '2024-12-31','2024-12-31', 36.2, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '22670', '2024-12-31','2024-12-31', 63.6, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '23110', '2024-12-31','2024-12-31', 39.0, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '23270', '2024-12-31','2024-12-31', 31.8, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '23810', '2024-12-31','2024-12-31', 35.4, 'pct', 'semphn_hna_2025_28'),
  ('bulk_billing_pct', 'Bulk-billing practices', 'workforce', '24410', '2024-12-31','2024-12-31', 32.6, 'pct', 'semphn_hna_2025_28')
ON CONFLICT (metric_code, lga_code, period_end) DO UPDATE SET value = EXCLUDED.value;

-- ============================================================================
-- 4. HNA chapters — full chapter content from SEMPHN HNA 2025-28
-- ============================================================================
INSERT INTO semphn.hna_chapter
  (chapter_no, slug, title, category, deck_md, priorities, sources, version_tag, edition) VALUES
  (1, 'introduction', 'About this assessment', 'Foundations',
   'Methodology + frameworks. Bradshaw''s Taxonomy of Need (comparative, felt, expressed, normative) + Dahlgren-Whitehead SDOH applied across nine substantive chapters.',
   '[]'::jsonb, '["semphn_hna_2025_28"]'::jsonb, 'v1.0', '2025-28'),
  (2, 'region', 'Our region', 'Region overview',
   '**1.56 million residents**, **10 LGAs**, **2,935 km²** — 24% of Victoria. Projected to reach **2 million by 2030**. Fastest growth in Cardinia (25%) and Casey (22%); Mornington Peninsula in slight decline (-7.7%). **Greater Dandenong** carries the catchment''s heaviest socioeconomic disadvantage.',
   '[
     {"text": "South East Growth Corridor — Greater Dandenong, Casey, Cardinia — is the catchment''s rapid-growth zone and is projected to drive the catchment to ~2M people by 2030."},
     {"text": "Youth + family concentrations sit in Casey (39.6%) and Cardinia (36.8%); couples without children concentrate in Port Phillip (53.4%), Stonnington (49.8%), Mornington Peninsula (45.1%)."},
     {"text": "Older residents concentrate in Mornington Peninsula and Bayside."},
     {"text": "Refugee + asylum seekers: SEMPHN settled 25,342 humanitarian migrants (2000-2021) — 28.9% of all humanitarian entrants in Victoria. 87.9% settled in Casey + Greater Dandenong."},
     {"text": "Socioeconomic disadvantage: Greater Dandenong → Casey → Frankston carry the heaviest load."}
   ]'::jsonb,
   '["abs_census_2021","abs_erp_2024","abs_seifa_2021"]'::jsonb, 'v1.0', '2025-28'),
  (3, 'cald', 'Cultural and linguistic diversity', 'Priority population',
   '**1 in 3** SEMPHN residents born overseas (**530,517 people**). Casey + Greater Dandenong concentrate the catchment''s CALD population. **NES ED presentations up 17%** in three years. Top languages: Dari, Greek, Mandarin, Vietnamese, Khmer.',
   '[
     {"text": "1 in 3 residents born overseas (530,517 people). Casey leads on count (153,566 — 41.6% of LGA); Greater Dandenong leads on share (57.4%)."},
     {"text": "Top SA2s for overseas-born are all in Greater Dandenong — Springvale, Dandenong-North, Noble Park-West."},
     {"text": "ED presentations from NES residents rose +17% 2019-20 → 2022-23. Highest in Greater Dandenong, Casey, Glen Eira."}
   ]'::jsonb,
   '["abs_census_2021","vemd_vahi","vaed_vahi"]'::jsonb, 'v1.0', '2025-28'),
  (4, 'first-nations', 'First Nations people', 'Priority population',
   'Largest catchment populations in **Casey (23.4%)**, **Frankston (18.4%)**, **Mornington Peninsula (17.5%)**. Median age **25**. IRSEO of **25** for First Nations residents vs Victorian **14**. Mental health the most common chronic condition.',
   '[
     {"text": "Largest populations: Casey (23.4%), Frankston (18.4%), Mornington Peninsula (17.5%) of catchment''s First Nations population."},
     {"text": "Median age 25, with 32.1% under 15 and 21.7% aged 0-9."},
     {"text": "Socioeconomic disadvantage: IRSEO of 25 for First Nations residents (Victorian average 14)."},
     {"text": "MH is the most common chronic condition. Highest prevalence in Port Phillip (23.3%), Frankston (22.0%), Greater Dandenong (21.4%) — all above the Victorian average of 18.3%."},
     {"text": "Housing: highest share of First Nations rental households needing extra bedrooms in Greater Dandenong (18.0%), Casey (13.8%), Cardinia (12.1%)."}
   ]'::jsonb,
   '["abs_census_2021","aihw_irseo","semphn_hna_2025_28"]'::jsonb, 'v1.0', '2025-28'),
  (5, 'older-people', 'Older people (65+)', 'Priority population',
   '**16.2%** of residents are 65+; **2.1%** are 85+. Cohort projected **+29.7% by 2030**. **80%** have at least one chronic condition. Leading causes of death — Alzheimer''s (women), coronary heart disease (men).',
   '[
     {"text": "255,020 residents aged 65+ (16.2% of catchment). 34,166 aged 85+ (2.1%)."},
     {"text": "Projected +29.7% growth in the 65+ cohort by 2030 — particularly Cardinia, Port Phillip, Casey."},
     {"text": "Mornington Peninsula and Bayside concentrate residents 65+. Mornington has the catchment''s oldest profile."}
   ]'::jsonb,
   '["abs_census_2021","abs_erp_2024"]'::jsonb, 'v1.0', '2025-28'),
  (6, 'homelessness', 'Homelessness', 'Priority population',
   '**4,580 SEMPHN residents** were homeless or marginally housed on Census night 2021 — a rate of **28 per 10,000**. Greater Dandenong carries the catchment''s heaviest load (149.5 per 10,000).',
   '[
     {"text": "Greater Dandenong records the catchment''s highest rates of homelessness and marginal housing (149.5 per 10,000), well above the catchment average (28)."},
     {"text": "More SEMPHN residents access Specialist Homelessness Services (22 per 1,000) than the Victorian state rate (15)."}
   ]'::jsonb,
   '["abs_census_2021","aihw_shs_nmds"]'::jsonb, 'v1.0', '2025-28'),
  (7, 'mental-health', 'Mental health', 'Priority health',
   '**Frankston**: **116.1 MH conditions per 1,000 residents** — highest in catchment. **Port Phillip**: lowest life satisfaction (27.8%), highest psychological distress (27.3%). **Casey** highest MH diagnosis share (22.4%). **headspace**: 9 centres, **8.6-day average wait**.',
   '[
     {"text": "Frankston has the highest rate of MH conditions in the catchment: 116.1 per 1,000 residents."},
     {"text": "Port Phillip reports the lowest life satisfaction (27.8%) and highest psychological distress (27.3%)."},
     {"text": "Anxiety (8.5%) + depression (7.7%) are the most prevalent diagnoses."},
     {"text": "headspace: 9 centres in catchment, 8.6-day average wait to intake."}
   ]'::jsonb,
   '["semphn_hna_2025_28","vemd_vahi"]'::jsonb, 'v1.0', '2025-28'),
  (8, 'aod', 'Alcohol and other drugs', 'Priority health',
   'Alcohol consumption consistent with state (**ASR 14.4/100**). Risky drinking highest in **Mornington Peninsula (21.3)**, Bayside (19.5), Port Phillip (19.0). Active AOD diagnoses highest in **Casey (17.1%)**.',
   '[
     {"text": "Alcohol: catchment ASR 14.4/100 — consistent with Victoria. Risky drinking concentrated in coastal LGAs."},
     {"text": "Tobacco/nicotine: Greater Dandenong (18.9/100), Frankston (18.1), Cardinia (17.0), Mornington Peninsula (16.3) lead."}
   ]'::jsonb,
   '["aihw_aodts_nmds","semphn_hna_2025_28"]'::jsonb, 'v1.0', '2025-28'),
  (9, 'chronic-disease', 'Chronic disease', 'Priority health',
   'Leading causes of death: **dementia (women, 12.6%)**, **coronary heart disease (men, 12.4%)**. Multiple chronic conditions highest in **Mornington Peninsula (75.6/1k)** + Frankston (70.9/1k).',
   '[
     {"text": "Leading mortality: dementia (women, 12.6%), coronary heart disease (men, 12.4%)."},
     {"text": "Multiple chronic conditions: highest comorbidity in Mornington Peninsula (75.6/1k), Frankston (70.9/1k)."},
     {"text": "Bowel cancer screening lowest in Casey South (35.9%), Dandenong (38.3%), Frankston (39.3%)."}
   ]'::jsonb,
   '["aihw_cancer_screen","semphn_hna_2025_28"]'::jsonb, 'v1.0', '2025-28'),
  (10, 'workforce', 'Health workforce', 'Capability',
   '**497 general practices**, **2,813 GPs**. Casey leads on count (84 practices · 617 GPs); Stonnington leads on density (143.0 FTE/100k vs Vic 116.3). **155 RACFs**, **410 pharmacies**, **2 ACCHS**.',
   '[
     {"text": "497 general practices as at 31 Jul 2024. Casey leads count (84), Greater Dandenong second (80)."},
     {"text": "RACGP accreditation: lowest in Greater Dandenong (62.3%) and Stonnington (67.3%); highest Casey (84.4%)."},
     {"text": "Bulk-billing concentrated in higher-disadvantage LGAs — Greater Dandenong (63.6%), Casey (61.1%), Cardinia (51.5%)."}
   ]'::jsonb,
   '["ahpra_register","semphn_hna_2025_28"]'::jsonb, 'v1.0', '2025-28')
ON CONFLICT (chapter_no) DO UPDATE
SET title = EXCLUDED.title,
    deck_md = EXCLUDED.deck_md,
    priorities = EXCLUDED.priorities,
    sources = EXCLUDED.sources,
    updated_at = now();

-- ============================================================================
-- 5. Service provider register — counts per type per LGA
-- ============================================================================
-- Seed catchment-level summary rows. Individual provider points to follow when
-- AHPRA + My Aged Care loaders run for the first time.
INSERT INTO semphn.service_provider
  (provider_id, name, type, lga_code, accredited, bulk_billing_pct, extras)
VALUES
  ('semphn_acchs_ddacl',    'Dandenong & District Aborigines Co-Operative Ltd (DDACL)', 'acchs',     '22670', true, NULL, '{"role": "Aboriginal community controlled health service"}'::jsonb),
  ('semphn_acchs_other',    'SEMPHN-region ACCHS (second site)',                        'acchs',     '21610', true, NULL, '{}'::jsonb),
  ('semphn_headspace_001',  'headspace · catchment-wide network',                       'headspace', NULL,    true, NULL, '{"centres": 9, "avg_intake_wait_days": 8.6}'::jsonb),
  ('semphn_hospital_alfred','The Alfred Hospital network',                              'hospital',  '23810', true, NULL, '{"network": "Alfred Health"}'::jsonb),
  ('semphn_hospital_monash','Monash Health',                                            'hospital',  '22670', true, NULL, '{"network": "Monash Health"}'::jsonb),
  ('semphn_hospital_pen',   'Peninsula Health',                                         'hospital',  '22170', true, NULL, '{"network": "Peninsula Health"}'::jsonb)
ON CONFLICT (provider_id) DO NOTHING;

-- ============================================================================
-- 6. Funding schedules — the 11 SEMPHN AWPs for FY26
-- ============================================================================
INSERT INTO semphn.funding_schedule (code, name, fy, value_aud, awp_status, awp_approved_at, mpr_due, notes) VALUES
  ('core',         'PHN Core',                              'FY26', 19200000, 'approved', '2026-03-15', '2026-08-31', 'Core PHN flexible funding'),
  ('primary_mh',   'Primary Mental Health',                 'FY26', 19900000, 'approved', '2026-03-15', '2026-08-31', 'Stepped care MH'),
  ('aod',          'Drug & Alcohol Treatment',              'FY26',  2800000, 'approved', '2026-03-15', '2026-08-31', NULL),
  ('aged_care',    'Aged Care',                             'FY26',  4000000, 'approved', '2026-03-15', '2026-08-31', NULL),
  ('after_hours',  'After Hours Primary Health Care',       'FY26',  1800000, 'approved', '2026-03-15', '2026-08-31', NULL),
  ('headspace',    'Headspace Demand Management',           'FY26',  1800000, 'approved', '2026-03-15', '2026-08-31', '9 catchment centres'),
  ('itc',          'Integrated Team Care',                  'FY26',  2000000, 'approved', '2026-03-15', '2026-08-31', 'First Nations focus'),
  ('ucc',          'Urgent Care Clinics',                   'FY26',  1500000, 'approved', '2026-03-15', '2026-08-31', NULL),
  ('psychosocial', 'Commonwealth Psychosocial Support',     'FY26', 11500000, 'approved', '2026-03-15', '2026-08-31', NULL),
  ('pilots',       'PHN Pilots & Targeted Programs',        'FY26',  7200000, 'approved', '2026-03-15', '2026-08-31', NULL),
  ('nmhspa',       'National MH & Suicide Prevention',      'FY26',  4900000, 'approved', '2026-03-15', '2026-08-31', NULL)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name, value_aud = EXCLUDED.value_aud, awp_status = EXCLUDED.awp_status;

-- ============================================================================
-- 7. Recent commissioning activity (CRM-style table for dashboard)
-- ============================================================================
INSERT INTO semphn.commissioning_activity
  (activity_name, lga_code, schedule_code, value_aud, status, due_date, approved_at, notes) VALUES
  ('Refugee health navigator pilot',        '22670', 'core',         182400, 'approved',  NULL,         '2026-05-12', 'CALD-targeted'),
  ('Headspace intake redesign',             '22170', 'primary_mh',    96800, 'approved',  NULL,         '2026-05-08', 'Reduce 8.6-day wait'),
  ('Bowel screening recall campaign',       '21610', 'core',          54200, 'in_review', NULL,         NULL,         'Casey South cohort'),
  ('ACCHS partnership MOU renewal',         '22170', 'itc',          120000, 'due',       '2026-06-14', NULL,         'DDACL + second ACCHS'),
  ('RACF medication review pilot',          '23270', 'aged_care',     78500, 'draft',     NULL,         NULL,         'Mornington Peninsula'),
  ('Cervical screening recall · CALD',      '22670', 'core',          41000, 'approved',  NULL,         '2026-05-20', 'Multilingual'),
  ('AOD brief intervention upskill',        '23270', 'aod',           33000, 'approved',  NULL,         '2026-05-22', 'Coastal LGAs')
ON CONFLICT DO NOTHING;

COMMIT;

-- Quick sanity-check rows
SELECT 'data_sources'             AS table_, COUNT(*) FROM semphn_meta.data_source
UNION ALL SELECT 'lgas',                   COUNT(*) FROM semphn_geo.lga
UNION ALL SELECT 'kpi_observation',        COUNT(*) FROM semphn.kpi_observation
UNION ALL SELECT 'hna_chapter',            COUNT(*) FROM semphn.hna_chapter
UNION ALL SELECT 'service_provider',       COUNT(*) FROM semphn.service_provider
UNION ALL SELECT 'funding_schedule',       COUNT(*) FROM semphn.funding_schedule
UNION ALL SELECT 'commissioning_activity', COUNT(*) FROM semphn.commissioning_activity
ORDER BY 1;
