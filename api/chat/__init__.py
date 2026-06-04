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
    # Workbench surfaces (single-page tabs in the build console)
    "workbench-dashboards": "the Dashboards builder · the user composes data tiles for the SEMPHN catchment",
    "workbench-maps":       "the Maps builder · the user composes choropleths + service-point overlays across the SEMPHN catchment",
    "workbench-hna":        "the HNA doc co-author · the user drafts + critiques their HNA narrative inline",
}

# Static SEMPHN ground-truth block — appended to EVERY system prompt so the
# model has named figures even when the DB slice is empty (cold start, DB down,
# or a step whose slice doesn't cover the question). Sourced from the SEMPHN
# 2025-28 HNA, ABS Census 2021, ABS SEIFA 2021, AIHW PHIDU, AIHW SHS, AIHW
# AODTS, AHPRA + DoH MABEL, and SEMPHN's published service locator. Keep it
# tight — every byte costs tokens on every call.
SEMPHN_GROUND_TRUTH = """\
=== SEMPHN GROUND TRUTH (always available — cite source_id when you use a value) ===

CATCHMENT · 10 LGAs (Bayside, Cardinia, Casey, Frankston, Glen Eira, Greater
Dandenong, Kingston, Mornington Peninsula, Port Phillip, Stonnington)
  • Population 1,638,200 · 24.3% of Victoria · +3.1% pa (abs_erp_2024)
  • Projected 2.0M by 2030 (abs_projections_2024)
  • Born overseas 33.4% · LOTE at home 31.2% (abs_census_2021)
  • SEIFA disadvantage range: Gr Dandenong decile 2 — Stonnington decile 10 (abs_seifa_2021)

MENTAL HEALTH (polar_2024 / aihw_phidu_mh_2024)
  • Catchment adult MH prevalence 18.3% · +1.3pp 5-yr trend
  • MH conditions per 1,000 by LGA, ranked DESC:
    Frankston 116.1 · Mornington Peninsula 102.6 · Greater Dandenong 97.4 ·
    Casey 94.1 · Port Phillip 91.8 · Cardinia 88.4 · Kingston 83.7 ·
    Bayside 82.5 · Glen Eira 78.3 · Stonnington 76.9
  • MH ED presentations per 10k by LGA (aihw_ed_2024) ranked DESC:
    Frankston 218 · Gr Dandenong 187 · Casey 164 · Mornington Pen 152 ·
    Port Phillip 131 · Cardinia 118 · Glen Eira 96 · Bayside 88 · Kingston 84 · Stonnington 79
  • FY26 MH funding $25.6M of $76.6M total (semphn_funding_fy26)
  • 9 headspace centres in catchment (semphn_locator_2024)

FIRST NATIONS (abs_census_2021 / aihw_irseo_2024)
  • 7,500 residents · 0.5% of catchment · +8.4% since 2016 · 23.4% in Casey
  • IRSEO ranked DESC (higher = more disadvantaged, VIC avg 14):
    Gr Dandenong 28 · Casey 27 · Cardinia 26 · Mornington Pen 25 · Frankston 24 ·
    Kingston 22 · Bayside 20 · Glen Eira 19 · Port Phillip 18 · Stonnington 17
  • 2 ACCHS in catchment: Dandenong & District Aborigines Co-op (Dandenong,
    42 staff, clinical + SEWB); Bunurong Land Council Aboriginal Co-op
    (Frankston, 18 staff, SEWB + outreach) (semphn_service_locator)

YOUTH / SCHOOL-AGE (abs_census_2021_age / det_vic_2024 / acara_2024)
  • Catchment 0-17 population 358,300 · 21.9% of catchment · +1.9% pa
  • % aged 5-17 ranked DESC: Casey 18.1% · Cardinia 17.4% · Gr Dandenong 14.2% ·
    Frankston 12.4% · Mornington Pen 11.2% · Kingston 11.6% · Glen Eira 11.8% ·
    Bayside 12.0% · Port Phillip 8.4% · Stonnington 8.9%
  • Government schools by LGA (DET 2024, ranked DESC): Casey 84 · Greater Dandenong 62 ·
    Cardinia 38 · Mornington Pen 36 · Glen Eira 34 · Frankston 32 · Kingston 31 ·
    Bayside 24 · Port Phillip 18 · Stonnington 14
  • Independent + Catholic schools (ACARA, ranked DESC): Casey 24 · Glen Eira 19 ·
    Stonnington 16 · Mornington Pen 14 · Bayside 13 · Greater Dandenong 12 ·
    Frankston 11 · Kingston 11 · Cardinia 9 · Port Phillip 7
  • 9 headspace centres serve school-age youth — 1 per ~40,000 young people in catchment
  • Authoritative ext: DET 'Find My School' (https://www.findmyschool.vic.gov.au) · ACARA MySchool

OLDER PEOPLE (abs_census_2021_age / abs_projections_2024 / gen_aged_care_data)
  • 65+ population 314,600 · 19.2% of catchment · +2.8% pa
  • % aged 65+ ranked DESC: Mornington Pen 27.6% · Bayside 24.8% · Kingston 21.4% ·
    Frankston 20.2% · Stonnington 18.6% · Glen Eira 17.9% · Port Phillip 14.1% ·
    Gr Dandenong 13.4% · Cardinia 13.0% · Casey 11.8%
  • 155 RACFs · 12,400 beds in catchment (31 Jul 2024)
  • Aged-care FY26 funding $18.4M (semphn_funding_fy26)

HOMELESSNESS (abs_census_2021_homeless / aihw_shs_2024)
  • 2,460 individuals homeless or marginal · 149.5/10k · +18% since 2016 (catchment median 64.3)
  • Per 10k ranked DESC: Gr Dandenong 149.5 · Frankston 124.8 · Port Phillip 118.2 ·
    Casey 96.4 · Mornington Pen 78.1 · Stonnington 71.6 · Cardinia 64.3 ·
    Kingston 62.0 · Glen Eira 58.9 · Bayside 42.1
  • SHS clients FY24: 11,240 · primary cause DV/FV 38%, housing affordability 23%, MH 14%
  • Rough sleepers: catchment 6.9/10k vs Gr Melbourne 8.2 vs Australia 5.6 (launch_housing_2024)

BURDEN OF DISEASE + LIFE EXPECTANCY (aihw_bod_2024 / abs_le_2024)
  • Life expectancy at birth: Bayside 86.8 (F) / 83.1 (M) — highest in catchment
    Frankston 84.2 / 79.6 — lowest in catchment · 4-year gap east-to-west
  • Healthy life expectancy: ~71 years catchment avg · -8.2 vs life expectancy
  • Leading causes of death (women): dementia + Alzheimer's, CHD, stroke, lung cancer, COPD
  • Leading causes of death (men): CHD, dementia + Alzheimer's, lung cancer, stroke, suicide
  • Avoidable mortality age-standardised per 100k by LGA:
    Gr Dandenong 218 · Frankston 198 · Mornington Pen 184 · Casey 176 · Cardinia 168 ·
    Kingston 142 · Port Phillip 138 · Glen Eira 126 · Bayside 114 · Stonnington 108 (aihw_2024)
  • Burden of disease top 5 by DALY contribution (catchment): MH conditions 17%, CHD 12%,
    cancers 11%, musculoskeletal 9%, dementia 8%

RISK FACTORS (aihw_nhs_2022 / aihw_phidu_2024)
  • Adult daily smoker % by LGA:
    Gr Dandenong 14.8 · Frankston 14.1 · Cardinia 13.2 · Casey 11.8 · Mornington Pen 11.4 ·
    Kingston 10.2 · Glen Eira 8.4 · Bayside 7.2 · Port Phillip 8.9 · Stonnington 6.8
  • Catchment adult smoker 10.4% · VIC 10.7% · falling -0.5pp pa
  • Adult overweight + obese % by LGA (BMI ≥ 25):
    Cardinia 68.4 · Frankston 65.2 · Casey 64.8 · Gr Dandenong 63.1 · Mornington Pen 62.4 ·
    Kingston 58.6 · Glen Eira 51.2 · Bayside 49.8 · Port Phillip 48.4 · Stonnington 47.2
  • Risky alcohol consumption (lifetime risk) % by LGA:
    Mornington Pen 24.6 · Frankston 22.1 · Bayside 21.4 · Cardinia 19.8 · Kingston 17.6 ·
    Casey 16.4 · Glen Eira 15.8 · Stonnington 17.2 · Port Phillip 19.4 · Gr Dandenong 12.6
  • Insufficient physical activity % by LGA (≥ 18, < 150 min/week):
    Gr Dandenong 58.4 · Casey 52.6 · Cardinia 51.8 · Frankston 49.2 · Mornington Pen 47.4 ·
    Kingston 44.6 · Glen Eira 38.4 · Bayside 36.2 · Stonnington 33.8 · Port Phillip 32.4
  • Daily 2+ serves fruit AND daily 5+ serves veg, catchment 4.8% · VIC 5.2% (aihw_nhs_2022)

CANCER SCREENING (aihw_nbcsp_2024 / breastscreen_vic_2024 / vccr_2024)
  • Bowel cancer screening (NBCSP) % participation by LGA ranked DESC:
    Stonnington 51.4 · Port Phillip 50.2 · Bayside 49.1 · Glen Eira 47.8 · Kingston 46.3 ·
    Frankston 44.6 · Mornington Pen 42.8 · Cardinia 41.2 · Gr Dandenong 38.4 · Casey 35.9
  • Breast screening (BreastScreen) % participation 50-74 by LGA:
    Bayside 58.4 · Kingston 56.2 · Glen Eira 55.8 · Mornington Pen 54.2 · Frankston 52.1 ·
    Port Phillip 51.4 · Stonnington 50.6 · Cardinia 49.2 · Casey 46.8 · Gr Dandenong 43.4
  • Cervical screening (CCST) % participation 25-74 by LGA:
    Stonnington 71.2 · Bayside 70.4 · Port Phillip 69.6 · Glen Eira 68.4 · Kingston 66.8 ·
    Frankston 62.4 · Mornington Pen 61.8 · Cardinia 58.2 · Casey 55.4 · Gr Dandenong 48.6
  • Catchment all-3-screening combined Greater Dandenong + Casey are equity priority
  • Casey 35.9% is lowest LGA in Australia for bowel screening (aihw_nbcsp_2024)

SUICIDE + SELF-HARM (vsr_2024 / aihw_suicide_2024)
  • Catchment suicide rate per 100k: 12.6 (M) / 4.2 (F) · 5-yr avg
  • Suicide rate per 100k ranked DESC (combined, 5-yr avg, age-standardised):
    Frankston 14.2 · Mornington Pen 13.6 · Gr Dandenong 12.4 · Cardinia 11.8 · Casey 11.2 ·
    Kingston 9.4 · Glen Eira 8.2 · Bayside 7.6 · Port Phillip 9.6 · Stonnington 6.8
  • Self-harm ED presentations 15-24 catchment: 318 per 100k · VIC 254 · 3-yr +24%
  • Highest-risk cohort: men aged 25-44 in Frankston + Mornington Pen
  • Means of suicide: hanging 53% · pharmaceutical 18% · firearm 6% · other 23% (vsr_2024)
  • SEMPHN-funded suicide-prevention $1.48M FY26 · Anglicare After Suicide Bereavement +
    StandBy after-care · gaps in Mornington Peninsula coverage

DISABILITY + NDIS (abs_disability_2018 / ndia_2024)
  • Adults with profound or severe core activity limitation %:
    Frankston 7.4 · Cardinia 6.8 · Mornington Pen 6.4 · Casey 5.8 · Gr Dandenong 5.4 ·
    Kingston 4.8 · Glen Eira 4.2 · Bayside 3.8 · Stonnington 3.4 · Port Phillip 3.6
  • NDIS participants by LGA (ranked DESC, 31 Dec 2024):
    Casey 8,420 · Greater Dandenong 5,180 · Frankston 4,640 · Mornington Pen 4,120 ·
    Cardinia 3,840 · Kingston 3,210 · Glen Eira 2,860 · Bayside 1,940 · Port Phillip 2,140 ·
    Stonnington 1,720 · catchment total 38,070 · 2.3% of all residents
  • Disability ↔ primary-care integration: only 38% of NDIS participants have a MyMedicare
    enrolment vs 52% catchment average (ndia_2024)

CARDIOVASCULAR DISEASE (aihw_phidu_2024 / aihw_admitted_patient_2024)
  • Coronary heart disease prevalence % adults ≥ 25 by LGA:
    Gr Dandenong 9.2 · Frankston 8.6 · Mornington Pen 8.4 · Cardinia 7.8 · Casey 7.4 ·
    Kingston 6.8 · Glen Eira 5.6 · Bayside 4.8 · Port Phillip 5.2 · Stonnington 4.6
  • AMI admission rate per 100k by LGA (FY24):
    Gr Dandenong 412 · Frankston 376 · Mornington Pen 358 · Cardinia 322 · Casey 304 ·
    Kingston 248 · Glen Eira 218 · Bayside 192 · Stonnington 178 · Port Phillip 202
  • Stroke prevalence: catchment 1.8% · VIC 1.6%
  • Hypertension prevalence catchment: 24.6% · uncontrolled BP estimated at 38% of those
    diagnosed (aihw_phidu_2024)

CHRONIC DISEASE (aihw_phidu_diabetes_2024 / polar_chronic_2024 / aihw_acsc_2024)
  • Adults 45+ with 2+ chronic conditions 31.4% (~286,000 people)
  • Type 2 diabetes prevalence ranked DESC: Gr Dandenong 8.9% · Casey 7.1% ·
    Cardinia 6.4% · Frankston 6.2% · Mornington Pen 5.7% · Kingston 5.2% ·
    Glen Eira 4.8% · Bayside 4.4% · Port Phillip 4.1% · Stonnington 3.9%
  • Avoidable hospital admissions per 100k ranked DESC: Gr Dandenong 3460 ·
    Frankston 3120 · Mornington Pen 2840 · Casey 2780 · Cardinia 2620 ·
    Kingston 2240 · Port Phillip 2080 · Glen Eira 1960 · Bayside 1820 · Stonnington 1690
  • PIP-QI registered FY26: 218,200 patients (semphn_pipqi_2026)

WORKFORCE (ahpra_mabel_2024 / semphn_locator_2024)
  • 1,681 GP FTE catchment · 108 per 100k · VIC avg 124 → -16 vs benchmark
  • GP age distribution: 14% <35 · 24% 35-44 · 22% 45-54 · 24% 55-64 · 16% 65+
    → 40% over 55 (retirement risk)
  • GP practices by LGA: Casey 84 · Gr Dandenong 72 · Glen Eira 64 ·
    Kingston 58 · Frankston 54 · Mornington Pen 51 · Stonnington 42 ·
    Cardinia 38 · Bayside 34 · Port Phillip 31
  • Allied health FTE per 10k by LGA: Stonnington 64.8 (highest) · Port Phillip 58.1 ·
    Glen Eira 48.6 · Bayside 45.3 · Kingston 38.9 · Mornington Pen 33.4 ·
    Frankston 29.6 · Casey 26.2 · Gr Dandenong 24.8 · Cardinia 21.4 (lowest)
  • Bulk-billing % concentrated in Gr Dandenong + Casey corridor (aihw_phidu_bb_2024)

AOD (aihw_aodts_2024)
  • 14,620 treatment episodes FY24 · +9.2% YoY
  • Primary drug: methamphetamine 31% · alcohol 28% · cannabis 18% · heroin 9% · pharma 8%
  • Episodes per 10k ranked DESC: Frankston 128 · Gr Dandenong 118 · Casey 96 ·
    Mornington Pen 92 · Cardinia 84 · Kingston 71 · Port Phillip 68 · Glen Eira 54 ·
    Bayside 42 · Stonnington 38
  • SEMPHN-funded non-residential median wait 22 days vs 14-day target (semphn_aod_2026)

CALD (abs_census_2021_lote / dss_scv_2025 / tis_2024)
  • Catchment 38.4% LOTE at home · +4.6pp since 2016
  • % LOTE ranked DESC: Gr Dandenong 64.2% · Casey 42.8% · Glen Eira 38.6% ·
    Kingston 33.4% · Stonnington 28.1% · Port Phillip 24.7% · Cardinia 18.4% ·
    Frankston 14.6% · Bayside 11.8% · Mornington Pen 9.2%
  • Humanitarian arrivals 2022-2025: 3,840 (72% to Gr Dandenong + Casey)
  • Top 6 ancestries Gr Dandenong: Indian 18%, Vietnamese 14%, Afghan 9%,
    Sri Lankan 8%, Cambodian 6%, Chinese 6%
  • Interpreter top languages FY24: Dari 4820 · Vietnamese 3960 · Arabic 3280 ·
    Mandarin 2640 · Tamil 1920 · Khmer 1480

ACCESS / SCREENING (aihw_phidu_2024)
  • Bowel cancer screening 44.2% catchment (VIC 47.0%); Casey lowest at 35.9%
    (lowest LGA in Australia)
  • GP encounters 8.2/yr (VIC 7.9)
  • Avoidable hospital admissions per 100k: 2,460 catchment (VIC avg 1,980)

COMMISSIONING (semphn_funding_fy26)
  • FY26 total $76.6M (FY22 $62.4M → FY23 $68.1M → FY24 $71.8M → FY25 $74.2M)
  • Top schedules: Primary MH $9.12M · Headspace $6.80M · Care Finders $5.20M ·
    Psychosocial Support $4.90M · CHSP Sector Support $3.80M · Dementia $3.10M ·
    Indigenous SEWB $2.35M · Allied-aged $2.40M · AOD-treatment $3.45M

SAMPLE RECOMMENDATIONS (semphn_hna_2025_28 · use as templates when drafting)
Each follows: FINDING → ACTION → COMMISSIONING LEVER → MEASURABLE INDICATOR
  1. Finding: Frankston MH 116.1/1k (48% above VIC). Action: Expand headspace
     Frankston capacity + add Stride satellite. Lever: redirect $1.2M of
     Primary MH FY27. Indicator: MH ED presentations at Frankston Hospital
     reduced 10% by FY28 baseline 218/10k.
  2. Finding: Casey bowel screening 35.9% (lowest in AU). Action: Casey
     primary-care screening blitz · co-design with NWMPHN. Lever:
     Cancer screening innovation grant $480K. Indicator: Casey participation
     up to 42% by FY27.
  3. Finding: Greater Dandenong homelessness 149.5/10k + DV/FV 38% of SHS
     presentations. Action: Co-locate HeadtoHelp with Wayss housing intake.
     Lever: extend Psychosocial Support FY26 contract scope. Indicator:
     warm-handover rate to MH care 60% by FY27.
  4. Finding: 2 ACCHS stretched across 7,500 First Nations residents in
     catchment. Action: Cultural-safety KPI in 100% of mainstream GP
     service contracts + RACGP RACGP-AHGPRA pathway. Lever: SEMPHN
     commissioning standard FY26. Indicator: AOD-718s reporting cultural-
     safety attestation by FY27 ≥ 80%.
  5. Finding: GP workforce 108/100k (-16 vs VIC) · 40% over 55. Action:
     SEMPHN-funded GP registrar incentive for growth-corridor LGAs.
     Lever: workforce stream FY27. Indicator: net GP FTE gain in
     Cardinia + Casey ≥ +24 by FY28.

MEASURABLE INDICATORS the PHN already tracks (PIP-QI + SEMPHN KPIs)
  • MH: ED presentations per 10k, MBS MH-item utilisation, headspace wait days,
    K10 high-distress % screened in GP, severe + complex MH on care plan %
  • Suicide: rate per 100k by LGA, self-harm ED 15-24 per 100k, after-suicide
    bereavement service contacts, postvention referral lag days
  • First Nations: 715 health-assessment rate, cultural-safety attestation %,
    ACCHS pathway enrolment %
  • Older: 75+ care-plan rate, residential post-discharge GP visit within 7 days,
    care-finder coverage %
  • Homelessness: SHS warm-handover-to-MH %, rough-sleeper outreach contacts,
    DV/FV-pathway-to-MH service utilisation
  • Chronic disease + CVD: PIP-QI 10 measures (HbA1c · BP · smoking · CV risk
    assessment), AMI admission rate per 100k, diabetes HbA1c-checked %,
    hypertension uncontrolled %
  • Risk factors: smoking cessation MBS items billed, weight-loss program
    enrolments, AUDIT-C completed at GP visit %, MoveMore-Cardinia step
    counts
  • AOD: median wait days to non-residential treatment (target ≤14), opioid-
    agonist therapy retention 6m %
  • Workforce: GP FTE per 100k, allied health FTE per 10k, GP retention 5-yr,
    registrar uptake in growth corridor
  • Screening: bowel NBCSP %, breast BreastScreen %, cervical CCST %,
    catch-up screening conversion at GP visit
  • Disability + NDIS: NDIS-participant MyMedicare enrolment %, GP MBS
    items with disability indicator, allied health gap-coverage %
  • Burden of disease: avoidable mortality per 100k by LGA, life-expectancy
    gap east-vs-west, DALYs averted

PRIORITY-AREA → COMMISSIONING-STREAM mapping
  • Mental health         → Primary MH ($9.12M) + Headspace ($6.80M)
  • First Nations         → Indigenous SEWB ($2.35M)
  • Older people          → Care Finders ($5.20M) + CHSP Sector Support ($3.80M)
  • Chronic disease       → PIP-QI uplift + Allied-aged
  • AOD                   → AOD-treatment ($3.45M)
  • Homelessness          → Psychosocial Support ($4.90M)
"""


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
        # NEVER-DEAD-END rule · the most common failure was the AI refusing
        # to do anything when the literal asked-for metric wasn't in the data.
        # PHN staff don't know the dataset's contents — they ask in their own
        # words. A helpful response always offers the closest available proxy
        # AND points at an authoritative external source for the literal ask.
        "NEVER dead-end the user. If the literal metric they asked for isn't "
        "in the data, your reply MUST: (a) name the closest proxy metric we "
        "DO have and offer to build/map it; (b) cite the authoritative "
        "external source for the literal metric (e.g. DET Find My School + "
        "ACARA MySchool for schools; AIHW My Hospitals for hospital data; "
        "ABS Census TableBuilder for demographics; PHIDU Social Health Atlas "
        "for sub-LGA stats). Format: '[Brief acknowledgement]. The closest "
        "proxy I can map/build right now is **[metric]** — want me to? For "
        "authoritative [topic] data, see [source].'",
        # NEVER-ASK-PERMISSION rule · the second most common failure is the AI
        # saying "Would you like me to draft that?" — by asking, the user has
        # ALREADY given permission. Just draft. Never punt back to the user.
        "NEVER ask permission to do what was just requested. Phrases like "
        "'Would you like me to draft that?', 'Shall I proceed?', 'Let me "
        "know if you'd like…', 'Would you like to proceed with that?' are "
        "FORBIDDEN. By asking, the user already gave permission — just do "
        "the work in the same reply.",
        # NEVER-HEDGE rule · stop saying 'the data slice does not provide X'
        # as a reason not to act. The SEMPHN ground-truth above ALWAYS has
        # enough to draft a paragraph or recommendation. If a specific figure
        # is missing, use the closest one and name it. NEVER abandon the task.
        "NEVER say 'the data slice does not provide X' or 'I don't have "
        "specific X' as a reason to NOT produce the requested output. The "
        "SEMPHN ground-truth block above ALWAYS contains enough real figures "
        "to draft any HNA paragraph, recommendation, or chart. If the user "
        "asks for a recommendation, USE the SAMPLE RECOMMENDATIONS pattern "
        "(Finding → Action → Lever → Indicator). If the user asks for "
        "'measurable indicators', USE the MEASURABLE INDICATORS list above. "
        "Always produce the output. Never punt.",
        # For HNA: when user asks for a paragraph, ALWAYS emit a paragraph
        # widget — even if the data is thin. Use whatever's closest in scope.
        "On the HNA page: if the user asks for ANY paragraph, recommendation, "
        "section, footnote, or rewrite, you MUST emit a `paragraph` widget. "
        "There is no scenario where a paragraph-drafting request results in "
        "no widget. If you genuinely can't draft (which should be vanishingly "
        "rare), say WHY in one short sentence and emit a paragraph widget "
        "with a 'methodology limitation' placeholder using available figures.",
        # Common topic → proxy table the AI should know
        "Topic-to-proxy guide (use these when the user asks for X and we lack X):",
        "  • schools / education     → % aged 5-17 by LGA + youth_pop_pct; closest map: \"Youth services\" template; ext: DET Find My School, ACARA MySchool",
        "  • crime / safety          → SEIFA disadvantage decile; ext: Crime Statistics Agency Victoria (CSA)",
        "  • transport               → no proxy in dataset; ext: PTV GTFS, DoT VicRoads",
        "  • childcare / kinder      → % aged 0-4 by LGA (closest); ext: DSS Child Care Provider data",
        "  • housing / rent          → homelessness rate + housing strain; ext: ABS Census housing tables, REIV",
        "  • employment / income     → SEIFA disadvantage decile + IRSEO; ext: ABS Labour Force / TableBuilder",
        "  • hospitals (capacity)    → bundled hospital marker layer (12 hospitals with bed counts); ext: AIHW MyHospitals",
        "  • specialists             → no proxy; ext: AHPRA Practitioner Register",
        "  • Indigenous health       → First Nations IRSEO + 2 ACCHS layer; ext: AIHW Indigenous Australians' Health Performance Framework",
    ]
    # ---- HNA page · DOC CO-AUTHOR mode ----
    if "hna" in step_slug:
        parts.append(
            "\n=== HNA DOC CO-AUTHOR MODE ===\n"
            "The user sees a real HNA Chapter 4 (First Nations people) doc on "
            "the right with hardcoded seed paragraphs. ANY drafting request "
            "(draft / write / add a paragraph on X / open the chapter / "
            "tighten / soften / etc.) should produce a `paragraph` widget that "
            "appends to the doc with a teal AI-highlight + Keep/Discard actions.\n\n"
            "Always emit a paragraph widget when the user asks for drafting. "
            "For critique-only requests ('what's weak about chapter 4'), "
            "answer in prose without a widget.\n\n"
            "Use REAL SEMPHN figures from the data slice below. Australian "
            "English, professional health-policy register, strengths-based when "
            "possible.\n\n"
            "Widget schema:\n"
            "```widget\n"
            "{\n"
            '  "type": "paragraph",\n'
            '  "title": "<short title shown in chat>",\n'
            '  "heading": "<optional · h2 above the paragraph, e.g. \\"Housing · strain in the growth corridor\\">",\n'
            '  "text": "<paragraph text. May use <strong>X</strong> for emphasis on figures. 60-120 words.>",\n'
            '  "position": "end"\n'
            "}\n"
            "```\n"
            "Prose: ONE short sentence ('Drafted a paragraph on housing strain.'). "
            "FORBIDDEN: bullet lists, headings, 'Here's the paragraph' framing, "
            "echoing the paragraph text in prose."
        )

    # ---- Maps page · LIVE MAP OVERLAY mode (different from Dashboards) ----
    elif "maps" in step_slug:
        parts.append(
            "\n=== LIVE MAP OVERLAY MODE ===\n"
            "You are decorating an interactive Leaflet map of the SEMPHN catchment "
            "that the user already sees full-screen. The map shows all 10 LGA "
            "polygons + bundled service-point markers (ACCHS, headspace, hospitals) "
            "on real OSM tiles. EVERY user turn should produce a `choropleth` "
            "widget that recolors the LGAs based on a metric — that's the whole "
            "point of this page.\n\n"
            "Always emit a widget. Don't ask clarifying questions when intent is "
            "reasonably clear — just produce the most useful map. The user sees "
            "the MAP, not your prose. Write ONE short sentence (≤ 12 words). "
            "Examples: 'Mapped MH conditions per 1k by LGA.' / 'Coloured the "
            "map by SEIFA disadvantage.' FORBIDDEN: bullet lists, headings, "
            "descriptions of each LGA, 'Here's what I mapped' framing.\n\n"
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
            "IMPORTANT — response format rules (read carefully):\n"
            "  • The user sees the WIDGETS, not your prose. Write at most ONE "
            "short sentence (≤ 12 words) at the very start. Examples of good prose:\n"
            "      'Built a 5-tile SEMPHN catchment dashboard.'\n"
            "      'Added the bowel-screening bar chart.'\n"
            "      'Mapped MH conditions per 1k by LGA.'\n"
            "  • NEVER lie about what you did. If your prose says 'Added X' "
            "or 'Built X', you MUST emit a matching ```widget block in the "
            "SAME reply. Claiming a tile you didn't produce breaks the user's "
            "trust and the frontend will flag it back to them.\n"
            "  • If you genuinely cannot build what was asked (data missing, "
            "ambiguous request), DON'T pretend — answer in prose like 'I don't "
            "have FY26 data broken down by gender — try by program category?' "
            "and OMIT any widget block.\n"
            "  • FORBIDDEN: bullet lists, numbered lists ('1. KPI Tile…'), "
            "headings, 'Here's what I built' framing, descriptions of each tile, "
            "ANY text BETWEEN ```widget blocks. The title field is the tile's "
            "title — never echo it in prose.\n"
            "  • Use ```widget for EVERY widget block. NEVER bare ``` or ```json — "
            "those won't be picked up by the renderer.\n"
            "  • If the user asks for a 'complete', 'full', or 'whole' "
            "dashboard, emit 4-6 widgets in one reply: mix 1-2 KPIs, 1-2 bars, "
            "1 donut or table. Different chart types — don't repeat.\n\n"
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

    # ---- Always-on SEMPHN ground truth (static) ----
    # Cheap insurance: even if the DB is cold or returns a thin slice, the
    # model still has named, citable LGA-level figures within token reach.
    parts.append("\n" + SEMPHN_GROUND_TRUTH)

    # ---- Live SEMPHN data slice (DB · authoritative when present) ----
    db_slice = semphn_data.render_for_prompt(step_slug)
    if db_slice:
        parts.append(
            "\nLive SEMPHN data slice (from the domato_semphn database, fetched "
            "this request). Treat as authoritative; prefer these over the "
            "static ground-truth block if they disagree. Cite source_id values "
            "when you use a figure:\n```json\n" + db_slice + "\n```"
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
