/*
 * SEMPHN Workbench — shared shell behaviour (v2 polish)
 *
 * Per-page (loaded by /hna, /dashboards, /maps). Each page sets
 * <body data-page="hna|dashboards|maps">.
 *
 * v2 additions over the basic shell:
 *   • Resizable + collapsible chat panel (drag handle, persisted width)
 *   • Command palette (⌘K / Ctrl+K) with fuzzy filter + keyboard nav
 *   • Bottom status bar live-updates ("Saved 5s ago", "AI thinking…")
 *   • Thinking indicator (3 pulsing dots) while POST /api/chat is in flight
 *   • Safe markdown rendering for AI replies (bold, italic, code, lists, links)
 *     — built bottom-up via createElement, no innerHTML on untrusted text
 *   • Toast notifications (window.SEMPHN.toast)
 *   • Auto-grow textarea, focus shortcut (⌘/)
 *
 * No innerHTML on dynamic content anywhere.
 */
(function () {
  'use strict';

  var AUTH_KEY  = 'domato.semphn.session';   // session is GLOBAL (single per browser)
  var STORE_KEY_BASE = 'semphn.workbench.turns.v3';
  var UI_KEY_BASE    = 'semphn.workbench.ui.v2';
  var SIGNIN    = '/signin/';

  /* Per-user namespace · keeps each signed-in user's chat history,
   * widgets, HNA edits and chapter-complete flags separate on the
   * same browser. Falls back to 'anon' if no session.
   * uKey('semphn.workbench.widgets.v1') → 'semphn.workbench.widgets.v1.u-galina_daraganova_at_domato_ai' */
  function userSlug() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      var s = raw ? JSON.parse(raw) : null;
      if (s && s.email) return s.email.toLowerCase().replace(/[^a-z0-9]/g, '_');
    } catch (_) {}
    return 'anon';
  }
  function uKey(base) { return base + '.u-' + userSlug(); }
  window.__uKey = uKey;
  var STORE_KEY = function () { return uKey(STORE_KEY_BASE); };
  var UI_KEY    = function () { return uKey(UI_KEY_BASE); };

  /* ============================================================
   * Per-page metadata + seed turns
   * ============================================================ */
  var PAGE_META = {
    hna: {
      name:    'HNA co-author',
      api_slug: 'workbench-hna',
      composerLabel: 'Ask for changes · HNA',
      placeholder: 'Draft, revise or critique any chapter…',
    },
    dashboards: {
      name:    'Dashboards builder',
      api_slug: 'workbench-dashboards',
      composerLabel: 'Ask for changes · Dashboards',
      placeholder: 'Describe a chart in English — "bowel screening by LGA"…',
    },
    maps: {
      name:    'Maps builder',
      api_slug: 'workbench-maps',
      composerLabel: 'Ask for changes · Maps',
      placeholder: '"MH prevalence choropleth" or "locate every ACCHS"…',
    },
  };

  /* Per-page suggested starters shown in the empty state.
   * Each chat starts CLEAN — no pre-seeded "I built this..." turns.
   * Click a chip → fills the composer + auto-sends.
   *
   * Grouped into sections so the empty state reads like a menu, not a list.
   * Dashboards suggestions are BUILD prompts that produce ECharts tiles
   * on the right canvas. */
  var SUGGESTIONS = {
    hna: [
      { section: 'Draft new paragraphs', items: [
        { icon: '✎', label: 'Bowel-screening gap',    prompt: 'Draft a paragraph on the bowel cancer screening gap for First Nations residents in the SEMPHN catchment. Anchor on real participation rates and name the lowest LGAs. Heading: "Bowel screening · the equity gap".' },
        { icon: '✎', label: 'Workforce pressure',     prompt: 'Draft a paragraph on workforce pressure facing the 2 ACCHS in the catchment. Heading: "Workforce · two ACCHS, stretched". Use real figures.' },
        { icon: '✎', label: 'Smoking & MH overlap',   prompt: 'Draft a paragraph on the overlap of smoking and mental-health conditions for First Nations residents in SEMPHN. Heading: "Smoking + mental health · co-occurring need".' },
        { icon: '✎', label: 'Cardio-metabolic risk',  prompt: 'Draft a paragraph on cardio-metabolic risk (diabetes + hypertension prevalence) by LGA for First Nations residents. Heading: "Cardio-metabolic · prevention pathway".' },
      ]},
      { section: 'Critique + sharpen', items: [
        { icon: '⚑', label: 'DoH rubric flags',       prompt: 'Looking at the current Chapter 4 draft, what data or framing is the DoH Performance Rubric most likely to flag as missing or thin? Reply in prose, no widget.' },
        { icon: '↔', label: 'Cross-reference Ch 7',   prompt: 'Where does Chapter 4 need a cross-reference to Chapter 7 (Mental health) for coherence? Reply in prose, no widget.' },
        { icon: '◉', label: 'Pre-flight check',       prompt: 'Run the DoH Compliance Checklist + Performance Rubric on the current Chapter 4 draft. Flag warnings. Reply in prose, no widget.' },
      ]},
    ],
    dashboards: [
      { section: 'Complete dashboards · instant', items: [
        { icon: '⚡', label: 'Mental health · 5 tiles',     template: 'mental-health' },
        { icon: '⚡', label: 'First Nations health · 5 tiles', template: 'first-nations' },
        { icon: '⚡', label: 'Aged care · 5 tiles',         template: 'aged-care' },
        { icon: '⚡', label: 'Homelessness · 5 tiles',       template: 'homelessness' },
        { icon: '⚡', label: 'Chronic disease · 5 tiles',    template: 'chronic-disease' },
        { icon: '⚡', label: 'GP + allied workforce · 5 tiles', template: 'workforce' },
        { icon: '⚡', label: 'Alcohol & other drugs · 5 tiles', template: 'aod' },
        { icon: '⚡', label: 'CALD + multicultural · 5 tiles', template: 'cald' },
        { icon: '⚡', label: 'Bowel screening focus · 5 tiles', template: 'bowel-screening' },
        { icon: '⚡', label: 'Headspace coverage · 5 tiles', template: 'headspace-coverage' },
        { icon: '⚡', label: 'GP retention curve · 5 tiles', template: 'gp-retention' },
        { icon: '⚡', label: 'Risk factor profile · 5 tiles', template: 'risk-factor-profile' },
        { icon: '⚡', label: 'Cancer screening 3-program · 5 tiles', template: 'cancer-screening-3prog' },
        { icon: '⚡', label: 'Suicide prevention · 5 tiles', template: 'suicide-prevention' },
      ]},
      { section: 'KPI tiles', items: [
        { icon: '#', label: 'Catchment population · 1.64M (+3.1%)',   prompt: 'Add a KPI tile showing the SEMPHN catchment population (1,638,200 in 2024) with the growth-pa delta (+3.1%).' },
        { icon: '#', label: 'Bowel screening · 44.2% (Vic 47.0%)',    prompt: 'Add a KPI tile for the catchment bowel cancer screening rate (44.2%) with a delta indicator vs the Victorian average (47.0%).' },
        { icon: '#', label: 'GP encounters · 8.2/yr (Vic 7.9)',       prompt: 'Add a KPI tile for catchment GP encounters per resident per year (8.2 vs Victorian average 7.9).' },
      ]},
      { section: 'Compare LGAs', items: [
        { icon: '▮', label: 'MH conditions · Frankston 116.1/1k',     prompt: 'Build a bar chart of MH conditions per 1,000 by LGA, ranked highest to lowest. Highlight Frankston (116.1) as the standout. Unit per_1k.' },
        { icon: '▮', label: 'Bowel screening · Casey 35.9% lowest',   prompt: 'Build a bar chart of bowel cancer screening percentage by LGA, ranked highest to lowest. Highlight Casey (35.9% lowest). Unit pct.' },
        { icon: '▮', label: 'Homelessness · Gr Dandenong 149.5/10k',  prompt: 'Build a bar chart of homeless + marginal housing rate per 10k by LGA, ranked highest to lowest. Highlight Greater Dandenong (149.5). Unit per_10k.' },
        { icon: '▮', label: 'GP practices · Casey 84 (31 Jul 2024)',  prompt: 'Build a bar chart of GP practice counts by LGA, ranked highest to lowest. Title: "GP practices · 31 Jul 2024". Highlight Casey (84). Unit count.' },
      ]},
      { section: 'Commissioning + trends', items: [
        { icon: '◐', label: 'FY26 funding by program ($76.6M)',       prompt: 'Build a donut chart of FY26 funding schedules by program category (Primary Mental Health, Headspace, Psychosocial Support, Aged Care, AOD, etc.). Unit aud.' },
        { icon: '▤', label: 'Recent commissioning · table',           prompt: 'Build a table widget showing recent commissioning activity — columns: Activity, LGA, Schedule, Value, Status.' },
        { icon: '↗', label: 'Total funding 5y · $62.4M→$76.6M',       prompt: 'Build an area chart of total SEMPHN funding (AUD) by financial year for the last 5 years (FY22 $62.4M, FY23 $68.1M, FY24 $71.8M, FY25 $74.2M, FY26 $76.6M). Unit aud.' },
      ]},
    ],
    maps: [
      { section: 'Complete map views · instant', items: [
        { icon: '⚡', label: 'Mental health hotspots',  mapTemplate: 'mh-hotspots' },
        { icon: '⚡', label: 'Suicide prevention',      mapTemplate: 'suicide-prevention' },
        { icon: '⚡', label: 'Service network',         mapTemplate: 'service-network' },
        { icon: '⚡', label: 'Aged care',               mapTemplate: 'aged-care' },
        { icon: '⚡', label: 'Equity overlay',          mapTemplate: 'equity' },
        { icon: '⚡', label: 'First Nations services',  mapTemplate: 'first-nations' },
        { icon: '⚡', label: 'Homelessness',            mapTemplate: 'homelessness' },
        { icon: '⚡', label: 'Youth services',          mapTemplate: 'youth-services' },
        { icon: '⚡', label: 'School density',          mapTemplate: 'school-density' },
        { icon: '⚡', label: 'CVD burden',              mapTemplate: 'cvd-burden' },
        { icon: '⚡', label: 'Risk factors',            mapTemplate: 'risk-factors' },
      ]},
      { section: 'Service points · drop a layer', items: [
        { icon: '⊙', label: '9 headspace centres',      mapPoints: ['headspace'] },
        { icon: '⊙', label: '2 ACCHS clinics',          mapPoints: ['acchs'] },
        { icon: '⊙', label: 'Hospitals (public + private)', mapPoints: ['hospital'] },
        { icon: '⊙', label: 'Aged-care facilities · sample', mapPoints: ['racf'] },
        { icon: '⊙', label: 'PHN-funded MH services',   mapPoints: ['mh'] },
        { icon: '⊙', label: 'AOD services',             mapPoints: ['aod'] },
      ]},
      { section: 'Health & wellbeing · choropleth', items: [
        { icon: '◐', label: 'MH prevalence',            prompt: 'Map MH conditions per 1,000 residents by LGA. Highlight Frankston (highest at 116.1).' },
        { icon: '◌', label: 'Bowel screening rate',     prompt: 'Map bowel cancer screening participation by LGA. Highlight lowest LGAs.' },
        { icon: '+',  label: 'GP encounters per resident', prompt: 'Map GP encounters per resident per year by LGA.' },
      ]},
      { section: 'ABS · disadvantage & population', items: [
        { icon: '▦', label: 'SEIFA disadvantage',       prompt: 'Map ABS SEIFA disadvantage index by LGA. Highlight Greater Dandenong (most disadvantaged).' },
        { icon: '#', label: 'Catchment population',     prompt: 'Map ABS 2021 Census population by LGA.' },
        { icon: '↗', label: 'Population growth pa',     prompt: 'Map annual population growth rate (2016-2021 ABS Census) by LGA.' },
      ]},
      { section: 'Access & equity', items: [
        { icon: '▮', label: 'Bulk-billing %',           prompt: 'Map bulk-billing percentage by LGA.' },
        { icon: '▦', label: 'Homelessness rate',        prompt: 'Map homeless + marginal housing rate per 10k by LGA. Highlight Greater Dandenong.' },
        { icon: '◌', label: 'Refugee settlement density', prompt: 'Map humanitarian-arrival settlement density by LGA. Casey + Greater Dandenong dominate.' },
      ]},
    ],
  };

  /* ============================================================
   * Follow-up chips · "help them build as we go"
   *
   * After each AI reply on the Dashboards page, we surface 2-3
   * follow-up prompts inline in the chat. The chips are picked by
   * widget type so the next action always extends the canvas
   * with related data, not random suggestions.
   * ============================================================ */
  var FOLLOWUPS = {
    bar: [
      { label: 'Same metric → choropleth',  prompt: 'Map the same metric as a choropleth on the Maps tab.' },
      { label: 'Add LGA-share donut',       prompt: 'Add a donut chart breaking down the same metric by LGA share.' },
      { label: 'Add 3-year trend',          prompt: 'Add an area chart of the same metric over the last 3 years for the catchment total.' },
    ],
    line: [
      { label: 'Add a KPI for latest year', prompt: 'Add a KPI tile for the latest value with the year-on-year delta.' },
      { label: 'Compare LGAs',              prompt: 'Add a bar chart breaking the same metric down by LGA for the latest year.' },
    ],
    area: [
      { label: 'Add a KPI for latest year', prompt: 'Add a KPI tile for the latest value with the year-on-year delta.' },
      { label: 'Compare LGAs',              prompt: 'Add a bar chart breaking the same metric down by LGA for the latest year.' },
    ],
    donut: [
      { label: 'Show as a table',           prompt: 'Add a table showing the same breakdown with absolute values + percentages.' },
      { label: 'Top 3 as KPI tiles',        prompt: 'Add 3 KPI tiles for the top-3 categories from the donut.' },
    ],
    kpi: [
      { label: 'Trend over time',           prompt: 'Add an area chart of this metric over the last 5 years.' },
      { label: 'Break down by LGA',         prompt: 'Add a bar chart of this metric broken down by LGA, ranked highest to lowest.' },
      { label: 'Map it',                    prompt: 'Map this metric as a choropleth across the catchment LGAs.' },
    ],
    table: [
      { label: 'Visualise top 5',           prompt: 'Build a bar chart of the top 5 rows in the last table.' },
      { label: 'Totals as a KPI',           prompt: 'Add a KPI tile for the column total from the last table.' },
    ],
    choropleth: [
      { label: 'Add a ranked bar',          prompt: 'Add a bar chart ranking the LGAs by the same metric, highest to lowest.' },
      { label: 'Highlight top-3',           prompt: 'Re-render the choropleth with the top-3 LGAs highlighted.' },
      { label: 'Add a KPI for max',         prompt: 'Add a KPI tile for the LGA with the highest value of the metric.' },
    ],
    map: [
      { label: 'Add a ranked bar',          prompt: 'Add a bar chart ranking the LGAs by the same metric, highest to lowest.' },
      { label: 'Highlight top-3',           prompt: 'Re-render the choropleth with the top-3 LGAs highlighted.' },
    ],
    _default: [
      { label: 'Add a related KPI',         prompt: 'Add a KPI tile for the most important headline number related to what we just built.' },
      { label: 'Break it down by LGA',      prompt: 'Add a bar chart breaking the metric down by LGA, ranked highest to lowest.' },
    ],
  };
  function getFollowups(widget) {
    if (!widget) return FOLLOWUPS._default;
    return FOLLOWUPS[widget.type] || FOLLOWUPS._default;
  }

  /* ============================================================
   * Widget rendering (Dashboards builder)
   *
   * When the chat reply contains a ```widget JSON block,
   * we extract the spec, append it to the persisted widget list
   * for this page, and render it as a tile on the canvas grid.
   * The JSON block is stripped from the visible chat reply.
   * ============================================================ */
  /* ============================================================
   * SEMPHN Dashboard templates · instant 4-5 tile builds
   *
   * Click a "Templates" chip → all widgets land instantly via
   * __addWidget (no API roundtrip, no AI hallucination risk).
   * Real numbers from SEMPHN 2025-28 HNA + ABS 2021 + AIHW PHIDU.
   *
   * Templates demo the product's value in <1 second and give the AI
   * a quality baseline to refine from.
   * ============================================================ */
  var DASHBOARD_TEMPLATES = {
    'mental-health': [
      { type:'kpi', title:'Catchment MH prevalence', subtitle:'2024 · adults 18+', unit:'pct',
        source_id:'aihw_phidu_2024', delta:'+1.3%',
        data:[{label:'1 in 5 SEMPHN adults · 5-yr trend +1.3pp', value:18.3}] },
      { type:'bar', title:'MH conditions per 1,000 residents · by LGA',
        subtitle:'POLAR · last refresh 21 May 2026', unit:'per_1k',
        source_id:'polar_2024', highlight:'Frankston',
        data:[
          {label:'Frankston',value:116.1},{label:'Mornington Peninsula',value:102.6},
          {label:'Greater Dandenong',value:97.4},{label:'Casey',value:94.1},
          {label:'Port Phillip',value:91.8},{label:'Cardinia',value:88.4},
          {label:'Kingston (Vic.)',value:83.7},{label:'Bayside (Vic.)',value:82.5},
          {label:'Glen Eira',value:78.3},{label:'Stonnington',value:76.9},
        ]},
      { type:'donut', title:'FY26 MH funding by program category', subtitle:'SEMPHN commissioning · $25.6M',
        unit:'aud', source_id:'semphn_funding_fy26',
        data:[
          {label:'Primary Mental Health',value:9120000},
          {label:'Headspace · 9 centres',value:6800000},
          {label:'Psychosocial Support',value:4900000},
          {label:'Indigenous SEWB',value:2350000},
          {label:'Suicide Prevention',value:1480000},
          {label:'Severe + Complex',value:950000},
        ]},
      { type:'bar', title:'MH ED presentations · by LGA · FY24', subtitle:'AIHW + DHHS', unit:'per_10k',
        source_id:'aihw_ed_2024', highlight:'Frankston',
        data:[
          {label:'Frankston',value:218},{label:'Greater Dandenong',value:187},
          {label:'Casey',value:164},{label:'Mornington Peninsula',value:152},
          {label:'Port Phillip',value:131},{label:'Cardinia',value:118},
          {label:'Glen Eira',value:96},{label:'Bayside (Vic.)',value:88},
          {label:'Kingston (Vic.)',value:84},{label:'Stonnington',value:79},
        ]},
      { type:'area', title:'MH presentations · 5-year trend', subtitle:'Catchment total per 100k', unit:'per_100k',
        source_id:'aihw_ed_2020_2024',
        data:[{label:'FY20',value:892},{label:'FY21',value:1024},
              {label:'FY22',value:1118},{label:'FY23',value:1186},{label:'FY24',value:1247}]},
    ],

    'first-nations': [
      { type:'kpi', title:'First Nations residents · catchment',
        subtitle:'ABS Census 2021 · 0.5% of catchment', unit:'count',
        source_id:'abs_census_2021', delta:'+8.4% since 2016',
        data:[{label:'Total · largest in Casey (23.4%)', value:7500}] },
      { type:'bar', title:'First Nations IRSEO · by LGA',
        subtitle:'AIHW · higher = more disadvantaged · VIC avg 14',
        unit:'count', source_id:'aihw_irseo_2024', highlight:'Greater Dandenong',
        data:[
          {label:'Greater Dandenong',value:28},{label:'Casey',value:27},
          {label:'Cardinia',value:26},{label:'Mornington Peninsula',value:25},
          {label:'Frankston',value:24},{label:'Kingston (Vic.)',value:22},
          {label:'Bayside (Vic.)',value:20},{label:'Glen Eira',value:19},
          {label:'Port Phillip',value:18},{label:'Stonnington',value:17},
        ]},
      { type:'bar', title:'First Nations MH prevalence · by LGA',
        subtitle:'POLAR · % adults reporting MH condition · VIC avg 18.3%',
        unit:'pct', source_id:'polar_fn_2024', highlight:'Port Phillip',
        data:[
          {label:'Port Phillip',value:23.3},{label:'Frankston',value:22.0},
          {label:'Greater Dandenong',value:21.4},{label:'Casey',value:19.8},
          {label:'Mornington Peninsula',value:19.2},{label:'Cardinia',value:18.6},
        ]},
      { type:'donut', title:'First Nations housing strain · share of rental households',
        subtitle:'ABS Census 2021 · needing additional bedrooms', unit:'pct',
        source_id:'abs_census_2021_housing',
        data:[
          {label:'Greater Dandenong',value:18.0},{label:'Casey',value:13.8},
          {label:'Cardinia',value:12.1},{label:'Frankston',value:9.4},
          {label:'Other 6 LGAs',value:24.7},
        ]},
      { type:'table', title:'ACCHS services in catchment', subtitle:'2 services · stretched capacity',
        unit:'count', source_id:'semphn_service_locator',
        data:[
          {Service:'Dandenong & District Aborigines Co-op', Suburb:'Dandenong', Type:'Clinical + SEWB', Staff:42},
          {Service:'Bunurong Land Council Aboriginal Co-op', Suburb:'Frankston', Type:'SEWB + Outreach', Staff:18},
        ]},
    ],

    'aged-care': [
      { type:'kpi', title:'Residents 65+ · catchment',
        subtitle:'ABS ERP 2024 · 19.2% of catchment', unit:'count',
        source_id:'abs_erp_2024', delta:'+2.8% pa',
        data:[{label:'Mornington Peninsula 27.6% · oldest LGA', value:314600}] },
      { type:'bar', title:'% population aged 65+ · by LGA',
        subtitle:'ABS Census 2021', unit:'pct',
        source_id:'abs_census_2021_age', highlight:'Mornington Peninsula',
        data:[
          {label:'Mornington Peninsula',value:27.6},{label:'Bayside (Vic.)',value:24.8},
          {label:'Kingston (Vic.)',value:21.4},{label:'Frankston',value:20.2},
          {label:'Stonnington',value:18.6},{label:'Glen Eira',value:17.9},
          {label:'Port Phillip',value:14.1},{label:'Greater Dandenong',value:13.4},
          {label:'Cardinia',value:13.0},{label:'Casey',value:11.8},
        ]},
      { type:'kpi', title:'Residential Aged Care Facilities',
        subtitle:'31 Jul 2024 · catchment total', unit:'count',
        source_id:'gen_aged_care_data',
        data:[{label:'155 RACFs · 12,400 beds', value:155}] },
      { type:'donut', title:'Aged-care funding by category · FY26', subtitle:'SEMPHN commissioning · $18.4M',
        unit:'aud', source_id:'semphn_funding_fy26',
        data:[
          {label:'Care Finders',value:5200000},{label:'CHSP Sector Support',value:3800000},
          {label:'Dementia Programs',value:3100000},{label:'Allied Health · Aged',value:2400000},
          {label:'Specialist Geriatric',value:1900000},{label:'Carer Respite',value:2000000},
        ]},
      { type:'area', title:'Projected 65+ population growth · catchment',
        subtitle:'ABS projections · 2024-2030', unit:'count',
        source_id:'abs_projections_2024',
        data:[{label:'2024',value:314600},{label:'2025',value:323400},
              {label:'2026',value:332500},{label:'2027',value:341900},
              {label:'2028',value:351600},{label:'2029',value:361700},{label:'2030',value:372100}]},
    ],

    'homelessness': [
      { type:'kpi', title:'Homeless + marginal housing · catchment',
        subtitle:'ABS Census 2021 · per 10,000 residents', unit:'per_10k',
        source_id:'abs_census_2021_homeless', delta:'+18% since 2016',
        data:[{label:'2,460 individuals · Gr Dandenong 2.3× median', value:149.5}] },
      { type:'bar', title:'Homeless + marginal housing · by LGA',
        subtitle:'ABS Census 2021 · per 10,000 residents', unit:'per_10k',
        source_id:'abs_census_2021_homeless', highlight:'Greater Dandenong',
        data:[
          {label:'Greater Dandenong',value:149.5},{label:'Frankston',value:124.8},
          {label:'Port Phillip',value:118.2},{label:'Casey',value:96.4},
          {label:'Mornington Peninsula',value:78.1},{label:'Stonnington',value:71.6},
          {label:'Cardinia',value:64.3},{label:'Kingston (Vic.)',value:62.0},
          {label:'Glen Eira',value:58.9},{label:'Bayside (Vic.)',value:42.1},
        ]},
      { type:'donut', title:'Primary homelessness reasons · catchment',
        subtitle:'AIHW SHS · clients accessing services FY24', unit:'pct',
        source_id:'aihw_shs_2024',
        data:[
          {label:'Domestic + family violence',value:38},
          {label:'Housing affordability',value:23},
          {label:'Mental health',value:14},
          {label:'Family breakdown',value:11},
          {label:'Substance use',value:8},
          {label:'Other',value:6},
        ]},
      { type:'bar', title:'Rough sleepers · catchment vs benchmarks',
        subtitle:'StreetCount 2024 · per 10,000 residents', unit:'per_10k',
        source_id:'launch_housing_2024', highlight:'SEMPHN catchment',
        data:[
          {label:'Greater Melbourne',value:8.2},
          {label:'SEMPHN catchment',value:6.9},
          {label:'Regional VIC',value:4.1},
          {label:'Australia',value:5.6},
        ]},
      { type:'area', title:'SHS client volume · 5-year trend', subtitle:'Catchment total · AIHW SHS', unit:'count',
        source_id:'aihw_shs_2020_2024',
        data:[{label:'FY20',value:8420},{label:'FY21',value:9180},
              {label:'FY22',value:9840},{label:'FY23',value:10650},{label:'FY24',value:11240}]},
    ],

    'chronic-disease': [
      { type:'kpi', title:'Adults with 2+ chronic conditions',
        subtitle:'ABS NHS 2022 · catchment adults 45+', unit:'pct',
        source_id:'abs_nhs_2022', delta:'+2.1pp 5-yr',
        data:[{label:'~286,000 catchment adults', value:31.4}] },
      { type:'bar', title:'Type 2 diabetes prevalence · by LGA',
        subtitle:'AIHW PHIDU · % adults 18+ · VIC avg 5.4%', unit:'pct',
        source_id:'aihw_phidu_diabetes_2024', highlight:'Greater Dandenong',
        data:[
          {label:'Greater Dandenong',value:8.9},{label:'Casey',value:7.1},
          {label:'Cardinia',value:6.4},{label:'Frankston',value:6.2},
          {label:'Mornington Peninsula',value:5.7},{label:'Kingston (Vic.)',value:5.2},
          {label:'Glen Eira',value:4.8},{label:'Bayside (Vic.)',value:4.4},
          {label:'Port Phillip',value:4.1},{label:'Stonnington',value:3.9},
        ]},
      { type:'donut', title:'PIP-QI top chronic condition mix · catchment',
        subtitle:'POLAR · active GP problems · FY24', unit:'pct',
        source_id:'polar_chronic_2024',
        data:[
          {label:'Hypertension',value:24},
          {label:'Type 2 diabetes',value:18},
          {label:'Asthma/COPD',value:14},
          {label:'Depression/Anxiety',value:13},
          {label:'CHD',value:10},
          {label:'CKD',value:8},
          {label:'Other',value:13},
        ]},
      { type:'bar', title:'Avoidable hospital admissions · by LGA',
        subtitle:'AIHW · per 100,000 · ACSC FY24', unit:'per_100k',
        source_id:'aihw_acsc_2024', highlight:'Greater Dandenong',
        data:[
          {label:'Greater Dandenong',value:3460},{label:'Frankston',value:3120},
          {label:'Mornington Peninsula',value:2840},{label:'Casey',value:2780},
          {label:'Cardinia',value:2620},{label:'Kingston (Vic.)',value:2240},
          {label:'Port Phillip',value:2080},{label:'Glen Eira',value:1960},
          {label:'Bayside (Vic.)',value:1820},{label:'Stonnington',value:1690},
        ]},
      { type:'area', title:'PIP-QI registered patients · catchment', subtitle:'SEMPHN MyMedicare · enrolment FY22-FY26', unit:'count',
        source_id:'semphn_pipqi_2026',
        data:[{label:'FY22',value:118400},{label:'FY23',value:142800},
              {label:'FY24',value:168900},{label:'FY25',value:194600},{label:'FY26',value:218200}]},
    ],

    'workforce': [
      { type:'kpi', title:'GPs per 100,000 residents · catchment',
        subtitle:'AHPRA + DoH MABEL 2024 · FTE', unit:'count',
        source_id:'ahpra_mabel_2024', delta:'-4.8% since 2020',
        data:[{label:'VIC avg 124 · catchment shortfall', value:108}] },
      { type:'bar', title:'GP practices · by LGA',
        subtitle:'31 Jul 2024 · open + accepting patients', unit:'count',
        source_id:'semphn_locator_2024', highlight:'Casey',
        data:[
          {label:'Casey',value:84},{label:'Greater Dandenong',value:72},
          {label:'Glen Eira',value:64},{label:'Kingston (Vic.)',value:58},
          {label:'Frankston',value:54},{label:'Mornington Peninsula',value:51},
          {label:'Stonnington',value:42},{label:'Cardinia',value:38},
          {label:'Bayside (Vic.)',value:34},{label:'Port Phillip',value:31},
        ]},
      { type:'bar', title:'Allied health FTE per 10,000 · by LGA',
        subtitle:'AHPRA 2024 · psychology, OT, physio combined', unit:'per_10k',
        source_id:'ahpra_allied_2024', highlight:'Stonnington',
        data:[
          {label:'Stonnington',value:64.8},{label:'Port Phillip',value:58.1},
          {label:'Glen Eira',value:48.6},{label:'Bayside (Vic.)',value:45.3},
          {label:'Kingston (Vic.)',value:38.9},{label:'Mornington Peninsula',value:33.4},
          {label:'Frankston',value:29.6},{label:'Casey',value:26.2},
          {label:'Greater Dandenong',value:24.8},{label:'Cardinia',value:21.4},
        ]},
      { type:'donut', title:'GP age distribution · catchment',
        subtitle:'AHPRA 2024 · risk: 28% nearing retirement', unit:'pct',
        source_id:'ahpra_age_2024',
        data:[
          {label:'Under 35',value:14},{label:'35-44',value:24},
          {label:'45-54',value:22},{label:'55-64',value:24},
          {label:'65+',value:16},
        ]},
      { type:'area', title:'GP FTE trend · catchment', subtitle:'AHPRA + DoH · 5-year decline', unit:'count',
        source_id:'ahpra_mabel_2020_2024',
        data:[{label:'2020',value:1842},{label:'2021',value:1790},
              {label:'2022',value:1748},{label:'2023',value:1716},{label:'2024',value:1681}]},
    ],

    'aod': [
      { type:'kpi', title:'AOD treatment episodes · catchment',
        subtitle:'AIHW AODTS FY24', unit:'count',
        source_id:'aihw_aodts_2024', delta:'+9.2% YoY',
        data:[{label:'Methamphetamine #1 drug of concern', value:14620}] },
      { type:'donut', title:'Primary drug of concern · catchment',
        subtitle:'AIHW AODTS · FY24 episodes', unit:'pct',
        source_id:'aihw_aodts_2024',
        data:[
          {label:'Methamphetamine',value:31},
          {label:'Alcohol',value:28},
          {label:'Cannabis',value:18},
          {label:'Heroin',value:9},
          {label:'Pharmaceuticals',value:8},
          {label:'Other',value:6},
        ]},
      { type:'bar', title:'AOD episodes per 10,000 · by LGA',
        subtitle:'AIHW · FY24', unit:'per_10k',
        source_id:'aihw_aodts_2024', highlight:'Frankston',
        data:[
          {label:'Frankston',value:128},{label:'Greater Dandenong',value:118},
          {label:'Casey',value:96},{label:'Mornington Peninsula',value:92},
          {label:'Cardinia',value:84},{label:'Kingston (Vic.)',value:71},
          {label:'Port Phillip',value:68},{label:'Glen Eira',value:54},
          {label:'Bayside (Vic.)',value:42},{label:'Stonnington',value:38},
        ]},
      { type:'kpi', title:'Median wait · non-residential AOD',
        subtitle:'SEMPHN-funded providers · last 12 mo', unit:'count',
        source_id:'semphn_aod_2026', delta:'+8 days vs target',
        data:[{label:'Target 14 days · actual 22 days', value:22}] },
      { type:'area', title:'AOD episodes · 5-year trend',
        subtitle:'Catchment total · AIHW AODTS', unit:'count',
        source_id:'aihw_aodts_2020_2024',
        data:[{label:'FY20',value:11240},{label:'FY21',value:11960},
              {label:'FY22',value:12780},{label:'FY23',value:13390},{label:'FY24',value:14620}]},
    ],

    'bowel-screening': [
      { type:'kpi', title:'Bowel screening · catchment',
        subtitle:'NBCSP participation FY24', unit:'pct',
        source_id:'aihw_phidu_2024', delta:'-2.8pp vs VIC',
        data:[{label:'VIC 47.0% · AU 44.5% · catchment lags', value:44.2}] },
      { type:'bar', title:'Bowel screening % · by LGA',
        subtitle:'AIHW PHIDU · lowest first', unit:'pct',
        source_id:'aihw_phidu_2024', highlight:'Casey',
        data:[
          {label:'Casey',value:35.9},{label:'Greater Dandenong',value:38.4},
          {label:'Cardinia',value:41.2},{label:'Mornington Peninsula',value:42.8},
          {label:'Frankston',value:44.6},{label:'Kingston (Vic.)',value:46.3},
          {label:'Glen Eira',value:47.8},{label:'Bayside (Vic.)',value:49.1},
          {label:'Port Phillip',value:50.2},{label:'Stonnington',value:51.4},
        ]},
      { type:'kpi', title:'Casey · lowest in Australia',
        subtitle:'NBCSP FY24', unit:'pct',
        source_id:'aihw_phidu_2024', delta:'-11.1pp vs VIC',
        data:[{label:'393K residents · 60% over-65 NOT screened', value:35.9}] },
      { type:'bar', title:'Catchment vs benchmarks',
        subtitle:'NBCSP participation', unit:'pct',
        source_id:'aihw_phidu_2024',
        data:[
          {label:'Top 10% LGAs nationally',value:62.0},
          {label:'Victoria avg',value:47.0},
          {label:'Australia avg',value:44.5},
          {label:'SEMPHN catchment',value:44.2},
        ]},
      { type:'area', title:'Catchment screening trend · 5-yr',
        subtitle:'NBCSP participation pa', unit:'pct',
        source_id:'aihw_phidu_2020_2024',
        data:[{label:'FY20',value:42.1},{label:'FY21',value:42.8},
              {label:'FY22',value:43.4},{label:'FY23',value:43.9},{label:'FY24',value:44.2}]},
    ],

    'headspace-coverage': [
      { type:'kpi', title:'Catchment 0-17 population',
        subtitle:'ABS Census 2021', unit:'count',
        source_id:'abs_census_2021', delta:'+1.9% pa',
        data:[{label:'9 headspace centres serve them', value:358300}] },
      { type:'donut', title:'Headspace centres · by LGA',
        subtitle:'SEMPHN service locator 2024', unit:'count',
        source_id:'semphn_locator_2024',
        data:[
          {label:'Frankston',value:1},{label:'Dandenong',value:1},
          {label:'Cranbourne',value:1},{label:'Narre Warren',value:1},
          {label:'Rosebud',value:1},{label:'Hastings',value:1},
          {label:'Bentleigh',value:1},{label:'Elsternwick',value:1},
          {label:'South Melbourne',value:1},
        ]},
      { type:'bar', title:'% aged 5-17 · by LGA',
        subtitle:'ABS Census 2021', unit:'pct',
        source_id:'abs_census_2021_age', highlight:'Casey',
        data:[
          {label:'Casey',value:18.1},{label:'Cardinia',value:17.4},
          {label:'Greater Dandenong',value:14.2},{label:'Frankston',value:12.4},
          {label:'Bayside (Vic.)',value:12.0},{label:'Glen Eira',value:11.8},
          {label:'Kingston (Vic.)',value:11.6},{label:'Mornington Peninsula',value:11.2},
          {label:'Stonnington',value:8.9},{label:'Port Phillip',value:8.4},
        ]},
      { type:'kpi', title:'1 headspace per ~40K young people',
        subtitle:'catchment coverage ratio', unit:'count',
        source_id:'semphn_locator_2024', delta:'VIC avg 1 per 31K',
        data:[{label:'Casey + Cardinia growth corridor lags', value:39811}] },
      { type:'area', title:'FY26 youth MH funding · 5-yr',
        subtitle:'Headspace + Primary MH youth-attributed', unit:'aud',
        source_id:'semphn_funding_fy22_fy26',
        data:[{label:'FY22',value:5400000},{label:'FY23',value:5800000},
              {label:'FY24',value:6200000},{label:'FY25',value:6500000},{label:'FY26',value:6800000}]},
    ],

    'risk-factor-profile': [
      { type:'kpi', title:'Catchment adult smoker',
        subtitle:'AIHW NHS 2022 · daily smoking', unit:'pct',
        source_id:'aihw_nhs_2022', delta:'-0.5pp pa',
        data:[{label:'VIC 10.7% · falling steady', value:10.4}] },
      { type:'bar', title:'Overweight + obese · by LGA',
        subtitle:'BMI ≥ 25 · AIHW NHS 2022', unit:'pct',
        source_id:'aihw_nhs_2022', highlight:'Cardinia',
        data:[
          {label:'Cardinia',value:68.4},{label:'Frankston',value:65.2},
          {label:'Casey',value:64.8},{label:'Greater Dandenong',value:63.1},
          {label:'Mornington Peninsula',value:62.4},{label:'Kingston (Vic.)',value:58.6},
          {label:'Glen Eira',value:51.2},{label:'Bayside (Vic.)',value:49.8},
          {label:'Port Phillip',value:48.4},{label:'Stonnington',value:47.2},
        ]},
      { type:'bar', title:'Insufficient physical activity · by LGA',
        subtitle:'< 150 min/week · AIHW NHS 2022', unit:'pct',
        source_id:'aihw_nhs_2022', highlight:'Greater Dandenong',
        data:[
          {label:'Greater Dandenong',value:58.4},{label:'Casey',value:52.6},
          {label:'Cardinia',value:51.8},{label:'Frankston',value:49.2},
          {label:'Mornington Peninsula',value:47.4},{label:'Kingston (Vic.)',value:44.6},
          {label:'Glen Eira',value:38.4},{label:'Bayside (Vic.)',value:36.2},
          {label:'Stonnington',value:33.8},{label:'Port Phillip',value:32.4},
        ]},
      { type:'donut', title:'Risk factors driving avoidable deaths',
        subtitle:'AIHW Burden of Disease 2024 · catchment estimate', unit:'pct',
        source_id:'aihw_bod_2024',
        data:[
          {label:'Tobacco use',value:18},{label:'Obesity + diet',value:24},
          {label:'Risky alcohol',value:12},{label:'Physical inactivity',value:14},
          {label:'Blood pressure',value:14},{label:'Other',value:18},
        ]},
      { type:'bar', title:'Risky alcohol consumption · by LGA',
        subtitle:'Lifetime risk · AIHW NHS 2022', unit:'pct',
        source_id:'aihw_nhs_2022', highlight:'Mornington Peninsula',
        data:[
          {label:'Mornington Peninsula',value:24.6},{label:'Frankston',value:22.1},
          {label:'Bayside (Vic.)',value:21.4},{label:'Cardinia',value:19.8},
          {label:'Port Phillip',value:19.4},{label:'Kingston (Vic.)',value:17.6},
          {label:'Stonnington',value:17.2},{label:'Casey',value:16.4},
          {label:'Glen Eira',value:15.8},{label:'Greater Dandenong',value:12.6},
        ]},
    ],

    'cancer-screening-3prog': [
      { type:'kpi', title:'Casey · lowest bowel in Australia',
        subtitle:'NBCSP FY24', unit:'pct',
        source_id:'aihw_nbcsp_2024', delta:'-11.1pp vs VIC',
        data:[{label:'Catchment 44.2% · target 60%', value:35.9}] },
      { type:'bar', title:'Bowel screening · by LGA',
        subtitle:'NBCSP FY24 · ranked LOW to high', unit:'pct',
        source_id:'aihw_nbcsp_2024', highlight:'Casey',
        data:[
          {label:'Casey',value:35.9},{label:'Greater Dandenong',value:38.4},
          {label:'Cardinia',value:41.2},{label:'Mornington Peninsula',value:42.8},
          {label:'Frankston',value:44.6},{label:'Kingston (Vic.)',value:46.3},
          {label:'Glen Eira',value:47.8},{label:'Bayside (Vic.)',value:49.1},
          {label:'Port Phillip',value:50.2},{label:'Stonnington',value:51.4},
        ]},
      { type:'bar', title:'Breast screening (50-74) · by LGA',
        subtitle:'BreastScreen Victoria 2024', unit:'pct',
        source_id:'breastscreen_vic_2024', highlight:'Greater Dandenong',
        data:[
          {label:'Bayside (Vic.)',value:58.4},{label:'Kingston (Vic.)',value:56.2},
          {label:'Glen Eira',value:55.8},{label:'Mornington Peninsula',value:54.2},
          {label:'Frankston',value:52.1},{label:'Port Phillip',value:51.4},
          {label:'Stonnington',value:50.6},{label:'Cardinia',value:49.2},
          {label:'Casey',value:46.8},{label:'Greater Dandenong',value:43.4},
        ]},
      { type:'bar', title:'Cervical screening (25-74) · by LGA',
        subtitle:'VCCR 2024 · CCST participation', unit:'pct',
        source_id:'vccr_2024', highlight:'Greater Dandenong',
        data:[
          {label:'Stonnington',value:71.2},{label:'Bayside (Vic.)',value:70.4},
          {label:'Port Phillip',value:69.6},{label:'Glen Eira',value:68.4},
          {label:'Kingston (Vic.)',value:66.8},{label:'Frankston',value:62.4},
          {label:'Mornington Peninsula',value:61.8},{label:'Cardinia',value:58.2},
          {label:'Casey',value:55.4},{label:'Greater Dandenong',value:48.6},
        ]},
      { type:'area', title:'Catchment bowel-screening trend',
        subtitle:'NBCSP FY20-FY24', unit:'pct',
        source_id:'aihw_phidu_2020_2024',
        data:[{label:'FY20',value:42.1},{label:'FY21',value:42.8},
              {label:'FY22',value:43.4},{label:'FY23',value:43.9},{label:'FY24',value:44.2}]},
    ],

    'suicide-prevention': [
      { type:'kpi', title:'Catchment suicide rate',
        subtitle:'5-yr avg · per 100,000 · age-standardised', unit:'per_100k',
        source_id:'vsr_2024', delta:'M 12.6 · F 4.2',
        data:[{label:'Frankston 14.2 catchment-highest', value:8.4}] },
      { type:'bar', title:'Suicide rate · by LGA',
        subtitle:'Combined rate per 100,000 · 5-yr avg', unit:'per_100k',
        source_id:'vsr_2024', highlight:'Frankston',
        data:[
          {label:'Frankston',value:14.2},{label:'Mornington Peninsula',value:13.6},
          {label:'Greater Dandenong',value:12.4},{label:'Cardinia',value:11.8},
          {label:'Casey',value:11.2},{label:'Port Phillip',value:9.6},
          {label:'Kingston (Vic.)',value:9.4},{label:'Glen Eira',value:8.2},
          {label:'Bayside (Vic.)',value:7.6},{label:'Stonnington',value:6.8},
        ]},
      { type:'kpi', title:'Self-harm ED · 15-24 cohort',
        subtitle:'AIHW ED data · per 100,000', unit:'per_100k',
        source_id:'aihw_ed_2024', delta:'+24% 3-yr',
        data:[{label:'VIC 254 · catchment elevated', value:318}] },
      { type:'donut', title:'Means of suicide · 5-yr',
        subtitle:'Victorian Suicide Register 2024', unit:'pct',
        source_id:'vsr_2024',
        data:[
          {label:'Hanging',value:53},{label:'Pharmaceutical',value:18},
          {label:'Other',value:23},{label:'Firearm',value:6},
        ]},
      { type:'kpi', title:'Suicide prevention funding · FY26',
        subtitle:'Anglicare + StandBy · postvention', unit:'aud',
        source_id:'semphn_funding_fy26', delta:'+12% vs FY25',
        data:[{label:'Gap: Mornington Peninsula coverage', value:1480000}] },
    ],

    'gp-retention': [
      { type:'kpi', title:'GP FTE · catchment',
        subtitle:'AHPRA + DoH MABEL 2024', unit:'count',
        source_id:'ahpra_mabel_2024', delta:'-4.8% since 2020',
        data:[{label:'108/100k · VIC 124 · -16 gap', value:1681}] },
      { type:'donut', title:'GP age distribution · catchment',
        subtitle:'AHPRA 2024 · 40% over 55', unit:'pct',
        source_id:'ahpra_age_2024',
        data:[
          {label:'Under 35',value:14},{label:'35-44',value:24},
          {label:'45-54',value:22},{label:'55-64',value:24},
          {label:'65+',value:16},
        ]},
      { type:'kpi', title:'GPs over 55',
        subtitle:'retirement-risk cohort', unit:'pct',
        source_id:'ahpra_age_2024', delta:'673 FTE · projected to exit by 2030',
        data:[{label:'Net pipeline negative without registrar uplift', value:40} ] },
      { type:'bar', title:'GP practices · by LGA',
        subtitle:'31 Jul 2024 · open + accepting', unit:'count',
        source_id:'semphn_locator_2024', highlight:'Casey',
        data:[
          {label:'Casey',value:84},{label:'Greater Dandenong',value:72},
          {label:'Glen Eira',value:64},{label:'Kingston (Vic.)',value:58},
          {label:'Frankston',value:54},{label:'Mornington Peninsula',value:51},
          {label:'Stonnington',value:42},{label:'Cardinia',value:38},
          {label:'Bayside (Vic.)',value:34},{label:'Port Phillip',value:31},
        ]},
      { type:'area', title:'GP FTE trend · 5-yr decline',
        subtitle:'AHPRA + DoH', unit:'count',
        source_id:'ahpra_mabel_2020_2024',
        data:[{label:'2020',value:1842},{label:'2021',value:1790},
              {label:'2022',value:1748},{label:'2023',value:1716},{label:'2024',value:1681}]},
    ],

    'cald': [
      { type:'kpi', title:'CALD population · catchment',
        subtitle:'ABS Census 2021 · born overseas + LOTE', unit:'pct',
        source_id:'abs_census_2021_cald', delta:'+4.6pp since 2016',
        data:[{label:'Gr Dandenong 64% · highest in VIC', value:38.4}] },
      { type:'bar', title:'% LOTE at home · by LGA',
        subtitle:'ABS Census 2021 · adults', unit:'pct',
        source_id:'abs_census_2021_lote', highlight:'Greater Dandenong',
        data:[
          {label:'Greater Dandenong',value:64.2},{label:'Casey',value:42.8},
          {label:'Glen Eira',value:38.6},{label:'Kingston (Vic.)',value:33.4},
          {label:'Stonnington',value:28.1},{label:'Port Phillip',value:24.7},
          {label:'Cardinia',value:18.4},{label:'Frankston',value:14.6},
          {label:'Mornington Peninsula',value:9.2},{label:'Bayside (Vic.)',value:11.8},
        ]},
      { type:'donut', title:'Top 6 ancestries · Greater Dandenong',
        subtitle:'ABS Census 2021', unit:'pct',
        source_id:'abs_census_2021_anc',
        data:[
          {label:'Indian',value:18},
          {label:'Vietnamese',value:14},
          {label:'Afghan',value:9},
          {label:'Sri Lankan',value:8},
          {label:'Cambodian',value:6},
          {label:'Chinese',value:6},
        ]},
      { type:'kpi', title:'Humanitarian arrivals · 3-yr settlement',
        subtitle:'DSS SCV settlement reports 2022-2025', unit:'count',
        source_id:'dss_scv_2025', delta:'72% to Gr Dandenong + Casey',
        data:[{label:'Largest VIC settlement footprint', value:3840}] },
      { type:'bar', title:'Interpreter requests · SEMPHN-funded services',
        subtitle:'TIS National · top 6 languages FY24', unit:'count',
        source_id:'tis_2024', highlight:'Dari',
        data:[
          {label:'Dari',value:4820},{label:'Vietnamese',value:3960},
          {label:'Arabic',value:3280},{label:'Mandarin',value:2640},
          {label:'Tamil',value:1920},{label:'Khmer',value:1480},
        ]},
    ],
  };

  /* Click handler · drops the entire template into the dashboard */
  function loadDashboardTemplate(name) {
    var tpl = DASHBOARD_TEMPLATES[name];
    if (!tpl || !window.__addWidget) return false;
    var added = 0;
    tpl.forEach(function (w) {
      // Clone so the template definition isn't mutated by addWidget side-effects
      window.__addWidget(JSON.parse(JSON.stringify(w)));
      added++;
    });
    showToast('Loaded ' + added + '-tile ' + name.replace('-', ' ') + ' dashboard', 'success');
    return added;
  }
  window.__loadDashboardTemplate = loadDashboardTemplate;
  window.__DASHBOARD_TEMPLATES = DASHBOARD_TEMPLATES;

  /* Tooltip · richer hover preview for dashboard + map templates */
  function showTemplatePreview(anchor, tiles, name) {
    hideTemplatePreview();
    var pop = document.createElement('div');
    pop.id = 'tpl-preview';
    pop.className = 'tpl-preview';
    var head = '<div class="tplp-head">' + escHtml(name) + ' · ' + tiles.length + ' tiles</div>';
    var rows = tiles.slice(0, 6).map(function (w) {
      var typeIcon = w.type === 'kpi' ? '#' :
                     w.type === 'bar' ? '▮' :
                     w.type === 'donut' ? '◐' :
                     w.type === 'area' || w.type === 'line' ? '↗' :
                     w.type === 'table' ? '▤' : '·';
      return '<div class="tplp-row"><span class="tplp-icon">' + typeIcon + '</span>' +
        '<div class="tplp-body"><span class="tplp-title">' + escHtml(w.title || '') + '</span>' +
        '<span class="tplp-sub">' + escHtml(w.subtitle || '') + '</span></div></div>';
    }).join('');
    pop.innerHTML = head + rows;
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left = (r.right + 10) + 'px';
    pop.style.top  = Math.max(20, r.top) + 'px';
    // Flip to left if it would overflow viewport right edge
    var pw = pop.getBoundingClientRect().width;
    if (r.right + 10 + pw > window.innerWidth) {
      pop.style.left = (r.left - pw - 10) + 'px';
    }
  }
  function showMapTemplatePreview(anchor, mt, name) {
    hideTemplatePreview();
    var pop = document.createElement('div');
    pop.id = 'tpl-preview'; pop.className = 'tpl-preview';
    var head = '<div class="tplp-head">' + escHtml(name) + '</div>';
    var rows = '';
    if (mt.choropleth) {
      rows += '<div class="tplp-row"><span class="tplp-icon">▤</span>' +
        '<div class="tplp-body"><span class="tplp-title">' + escHtml(mt.choropleth.title || 'Choropleth') + '</span>' +
        '<span class="tplp-sub">' + escHtml(mt.choropleth.unit_label || mt.choropleth.unit || '') + '</span></div></div>';
    }
    (mt.layers || []).forEach(function (k) {
      var st = SERVICE_STYLE[k] || { plural: k, color: '#666' };
      rows += '<div class="tplp-row"><span class="tplp-icon" style="background:' + st.color + ';color:#fff;">⊙</span>' +
        '<div class="tplp-body"><span class="tplp-title">' + escHtml(st.plural || k) + '</span>' +
        '<span class="tplp-sub">point overlay</span></div></div>';
    });
    pop.innerHTML = head + rows;
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    pop.style.left = (r.right + 10) + 'px';
    pop.style.top  = Math.max(20, r.top) + 'px';
    var pw = pop.getBoundingClientRect().width;
    if (r.right + 10 + pw > window.innerWidth) pop.style.left = (r.left - pw - 10) + 'px';
  }
  function hideTemplatePreview() {
    var p = document.getElementById('tpl-preview');
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  /* ============================================================
   * SEMPHN Map templates · instant-load map views
   *
   * Each template is a recipe of (a) optional choropleth widget
   * and (b) point-overlay layers — applied directly to the live
   * default Leaflet map via window.__defaultMapApi. The map fits
   * to the new bounds and shows a legend chip. No chat round-trip.
   * ============================================================ */
  var MAP_TEMPLATES = {
    'mh-hotspots': {
      title: 'Mental health hotspots',
      description: 'MH prevalence choropleth + headspace + ACCHS · where MH need meets MH supply',
      choropleth: {
        type: 'choropleth',
        title: 'MH conditions · per 1,000 residents',
        unit: 'per_1k', unit_label: 'per 1,000 residents',
        source_id: 'polar_2024', highlight: 'Frankston',
        data: [
          { label: 'Frankston', value: 116.1 }, { label: 'Mornington Peninsula', value: 102.6 },
          { label: 'Greater Dandenong', value: 97.4 }, { label: 'Casey', value: 94.1 },
          { label: 'Port Phillip', value: 91.8 }, { label: 'Cardinia', value: 88.4 },
          { label: 'Kingston (Vic.)', value: 83.7 }, { label: 'Bayside (Vic.)', value: 82.5 },
          { label: 'Glen Eira', value: 78.3 }, { label: 'Stonnington', value: 76.9 },
        ],
      },
      layers: ['headspace', 'acchs', 'mh'],
    },
    'service-network': {
      title: 'Service network',
      description: 'ACCHS + headspace + hospitals + key GP + MH + AOD services across the catchment',
      choropleth: null,
      layers: ['acchs', 'headspace', 'hospital', 'gp', 'mh', 'aod', 'semphn'],
    },
    'aged-care': {
      title: 'Aged care',
      description: '% 65+ choropleth + RACFs (sample) + hospitals — where the ageing curve hits care supply',
      choropleth: {
        type: 'choropleth',
        title: '% population aged 65+',
        unit: 'pct', unit_label: '% of residents aged 65+',
        source_id: 'abs_census_2021_age', highlight: 'Mornington Peninsula',
        data: [
          { label: 'Mornington Peninsula', value: 27.6 }, { label: 'Bayside (Vic.)', value: 24.8 },
          { label: 'Kingston (Vic.)', value: 21.4 }, { label: 'Frankston', value: 20.2 },
          { label: 'Stonnington', value: 18.6 }, { label: 'Glen Eira', value: 17.9 },
          { label: 'Port Phillip', value: 14.1 }, { label: 'Greater Dandenong', value: 13.4 },
          { label: 'Cardinia', value: 13.0 }, { label: 'Casey', value: 11.8 },
        ],
      },
      layers: ['racf', 'hospital'],
    },
    'equity': {
      title: 'Equity overlay',
      description: 'SEIFA disadvantage decile + headspace + ACCHS — where disadvantage meets MH access',
      choropleth: {
        type: 'choropleth',
        title: 'SEIFA disadvantage decile',
        unit: 'count', unit_label: 'SEIFA decile · 1 = most disadvantaged',
        source_id: 'abs_seifa_2021', highlight: 'Greater Dandenong',
        data: [
          { label: 'Greater Dandenong', value: 2 }, { label: 'Frankston', value: 4 },
          { label: 'Cardinia', value: 5 }, { label: 'Casey', value: 5 },
          { label: 'Mornington Peninsula', value: 7 }, { label: 'Kingston (Vic.)', value: 8 },
          { label: 'Glen Eira', value: 9 }, { label: 'Bayside (Vic.)', value: 10 },
          { label: 'Port Phillip', value: 9 }, { label: 'Stonnington', value: 10 },
        ],
      },
      layers: ['headspace', 'acchs', 'mh'],
    },
    'first-nations': {
      title: 'First Nations services',
      description: 'IRSEO disadvantage by LGA + the 2 ACCHS — the only First Nations-specific clinical services in catchment',
      choropleth: {
        type: 'choropleth',
        title: 'First Nations IRSEO',
        unit: 'count', unit_label: 'IRSEO · higher = more disadvantaged · VIC avg 14',
        source_id: 'aihw_irseo_2024', highlight: 'Greater Dandenong',
        data: [
          { label: 'Greater Dandenong', value: 28 }, { label: 'Casey', value: 27 },
          { label: 'Cardinia', value: 26 }, { label: 'Mornington Peninsula', value: 25 },
          { label: 'Frankston', value: 24 }, { label: 'Kingston (Vic.)', value: 22 },
          { label: 'Bayside (Vic.)', value: 20 }, { label: 'Glen Eira', value: 19 },
          { label: 'Port Phillip', value: 18 }, { label: 'Stonnington', value: 17 },
        ],
      },
      layers: ['acchs'],
    },
    'homelessness': {
      title: 'Homelessness',
      description: 'Homelessness rate choropleth + AOD + MH services — where housing + addiction risk concentrates',
      choropleth: {
        type: 'choropleth',
        title: 'Homeless + marginal housing · per 10,000',
        unit: 'per_10k', unit_label: 'per 10,000 residents',
        source_id: 'abs_census_2021_homeless', highlight: 'Greater Dandenong',
        data: [
          { label: 'Greater Dandenong', value: 149.5 }, { label: 'Frankston', value: 124.8 },
          { label: 'Port Phillip', value: 118.2 }, { label: 'Casey', value: 96.4 },
          { label: 'Mornington Peninsula', value: 78.1 }, { label: 'Stonnington', value: 71.6 },
          { label: 'Cardinia', value: 64.3 }, { label: 'Kingston (Vic.)', value: 62.0 },
          { label: 'Glen Eira', value: 58.9 }, { label: 'Bayside (Vic.)', value: 42.1 },
        ],
      },
      layers: ['mh', 'aod'],
    },
    'growth-corridor': {
      title: 'Growth corridor',
      description: 'Population growth pa choropleth + RACFs + GP practices — where infrastructure must scale',
      choropleth: {
        type: 'choropleth',
        title: 'Population growth pa',
        unit: 'pct', unit_label: '% annual growth · ABS ERP 2019-2024',
        source_id: 'abs_erp_2024', highlight: 'Casey',
        data: [
          { label: 'Casey', value: 3.4 }, { label: 'Cardinia', value: 3.2 },
          { label: 'Greater Dandenong', value: 1.6 }, { label: 'Frankston', value: 1.1 },
          { label: 'Mornington Peninsula', value: 0.9 }, { label: 'Kingston (Vic.)', value: 0.8 },
          { label: 'Port Phillip', value: 0.5 }, { label: 'Glen Eira', value: 0.6 },
          { label: 'Bayside (Vic.)', value: 0.3 }, { label: 'Stonnington', value: 0.2 },
        ],
      },
      layers: ['gp', 'racf'],
    },
    'gp-supply': {
      title: 'GP supply',
      description: 'GP-practice density choropleth + GP markers — supply mapped against population',
      choropleth: {
        type: 'choropleth',
        title: 'GP practices · per 10,000 residents',
        unit: 'per_10k', unit_label: 'GP practices per 10,000 residents',
        source_id: 'semphn_locator_2024', highlight: 'Stonnington',
        data: [
          { label: 'Stonnington', value: 3.55 }, { label: 'Port Phillip', value: 2.72 },
          { label: 'Bayside (Vic.)', value: 3.10 }, { label: 'Glen Eira', value: 4.04 },
          { label: 'Greater Dandenong', value: 4.24 }, { label: 'Frankston', value: 3.72 },
          { label: 'Casey', value: 2.14 }, { label: 'Mornington Peninsula', value: 3.02 },
          { label: 'Kingston (Vic.)', value: 3.44 }, { label: 'Cardinia', value: 3.10 },
        ],
      },
      layers: ['gp'],
    },
    'screening-gap': {
      title: 'Bowel screening gap',
      description: 'Bowel screening % choropleth + GP markers — Casey is the lowest LGA in Australia',
      choropleth: {
        type: 'choropleth',
        title: 'Bowel screening participation',
        unit: 'pct', unit_label: '% NBCSP participation',
        source_id: 'aihw_nbcsp_2024', highlight: 'Casey',
        data: [
          { label: 'Stonnington', value: 51.4 }, { label: 'Port Phillip', value: 50.2 },
          { label: 'Bayside (Vic.)', value: 49.1 }, { label: 'Glen Eira', value: 47.8 },
          { label: 'Kingston (Vic.)', value: 46.3 }, { label: 'Frankston', value: 44.6 },
          { label: 'Mornington Peninsula', value: 42.8 }, { label: 'Cardinia', value: 41.2 },
          { label: 'Greater Dandenong', value: 38.4 }, { label: 'Casey', value: 35.9 },
        ],
      },
      layers: ['gp'],
    },
    'cald-density': {
      title: 'CALD density',
      description: '% LOTE-at-home choropleth + headspace + MH — multicultural settlement footprint',
      choropleth: {
        type: 'choropleth',
        title: '% LOTE at home',
        unit: 'pct', unit_label: '% adults speaking LOTE at home',
        source_id: 'abs_census_2021_lote', highlight: 'Greater Dandenong',
        data: [
          { label: 'Greater Dandenong', value: 64.2 }, { label: 'Casey', value: 42.8 },
          { label: 'Glen Eira', value: 38.6 }, { label: 'Kingston (Vic.)', value: 33.4 },
          { label: 'Stonnington', value: 28.1 }, { label: 'Port Phillip', value: 24.7 },
          { label: 'Cardinia', value: 18.4 }, { label: 'Frankston', value: 14.6 },
          { label: 'Bayside (Vic.)', value: 11.8 }, { label: 'Mornington Peninsula', value: 9.2 },
        ],
      },
      layers: ['headspace', 'mh'],
    },
    'youth-services': {
      title: 'Youth services',
      description: '% aged 5-17 choropleth + 9 headspace centres — where school-age need meets MH supply',
      choropleth: {
        type: 'choropleth',
        title: '% aged 5-17',
        unit: 'pct', unit_label: '% of residents aged 5-17 · ABS Census 2021',
        source_id: 'abs_census_2021_age', highlight: 'Casey',
        data: [
          { label: 'Casey', value: 18.1 }, { label: 'Cardinia', value: 17.4 },
          { label: 'Greater Dandenong', value: 14.2 }, { label: 'Frankston', value: 12.4 },
          { label: 'Bayside (Vic.)', value: 12.0 }, { label: 'Glen Eira', value: 11.8 },
          { label: 'Kingston (Vic.)', value: 11.6 }, { label: 'Mornington Peninsula', value: 11.2 },
          { label: 'Stonnington', value: 8.9 }, { label: 'Port Phillip', value: 8.4 },
        ],
      },
      layers: ['headspace', 'mh'],
    },
    'school-density': {
      title: 'School density',
      description: 'Government schools per LGA choropleth + headspace — co-location with MH services',
      choropleth: {
        type: 'choropleth',
        title: 'Government schools · count by LGA',
        unit: 'count', unit_label: 'government schools (DET 2024)',
        source_id: 'det_vic_2024', highlight: 'Casey',
        data: [
          { label: 'Casey', value: 84 }, { label: 'Greater Dandenong', value: 62 },
          { label: 'Cardinia', value: 38 }, { label: 'Mornington Peninsula', value: 36 },
          { label: 'Glen Eira', value: 34 }, { label: 'Frankston', value: 32 },
          { label: 'Kingston (Vic.)', value: 31 }, { label: 'Bayside (Vic.)', value: 24 },
          { label: 'Port Phillip', value: 18 }, { label: 'Stonnington', value: 14 },
        ],
      },
      layers: ['headspace'],
    },
    'suicide-prevention': {
      title: 'Suicide prevention',
      description: 'Suicide rate choropleth + headspace + MH services + AOD — postvention gap analysis',
      choropleth: {
        type: 'choropleth',
        title: 'Suicide rate · per 100,000',
        unit: 'per_100k', unit_label: 'age-standardised, 5-yr avg',
        source_id: 'vsr_2024', highlight: 'Frankston',
        data: [
          { label: 'Frankston', value: 14.2 }, { label: 'Mornington Peninsula', value: 13.6 },
          { label: 'Greater Dandenong', value: 12.4 }, { label: 'Cardinia', value: 11.8 },
          { label: 'Casey', value: 11.2 }, { label: 'Port Phillip', value: 9.6 },
          { label: 'Kingston (Vic.)', value: 9.4 }, { label: 'Glen Eira', value: 8.2 },
          { label: 'Bayside (Vic.)', value: 7.6 }, { label: 'Stonnington', value: 6.8 },
        ],
      },
      layers: ['headspace', 'mh', 'aod'],
    },
    'risk-factors': {
      title: 'Risk factors',
      description: 'Adult overweight + obese % choropleth + headspace + GP — where lifestyle intervention lands',
      choropleth: {
        type: 'choropleth',
        title: 'Adult overweight + obese (BMI ≥ 25)',
        unit: 'pct', unit_label: '% of adults · AIHW NHS 2022',
        source_id: 'aihw_nhs_2022', highlight: 'Cardinia',
        data: [
          { label: 'Cardinia', value: 68.4 }, { label: 'Frankston', value: 65.2 },
          { label: 'Casey', value: 64.8 }, { label: 'Greater Dandenong', value: 63.1 },
          { label: 'Mornington Peninsula', value: 62.4 }, { label: 'Kingston (Vic.)', value: 58.6 },
          { label: 'Glen Eira', value: 51.2 }, { label: 'Bayside (Vic.)', value: 49.8 },
          { label: 'Port Phillip', value: 48.4 }, { label: 'Stonnington', value: 47.2 },
        ],
      },
      layers: ['gp', 'headspace'],
    },
    'cvd-burden': {
      title: 'CVD burden',
      description: 'AMI admission rate choropleth + hospitals — cardiovascular access gradient',
      choropleth: {
        type: 'choropleth',
        title: 'AMI admissions · per 100,000',
        unit: 'per_100k', unit_label: 'AIHW Admitted Patient Care FY24',
        source_id: 'aihw_admitted_patient_2024', highlight: 'Greater Dandenong',
        data: [
          { label: 'Greater Dandenong', value: 412 }, { label: 'Frankston', value: 376 },
          { label: 'Mornington Peninsula', value: 358 }, { label: 'Cardinia', value: 322 },
          { label: 'Casey', value: 304 }, { label: 'Kingston (Vic.)', value: 248 },
          { label: 'Glen Eira', value: 218 }, { label: 'Port Phillip', value: 202 },
          { label: 'Bayside (Vic.)', value: 192 }, { label: 'Stonnington', value: 178 },
        ],
      },
      layers: ['hospital', 'gp'],
    },
  };

  /* Click handler · applies the template to the live default map.
   * Doesn't touch the widget grid — the map IS the surface. */
  function loadMapTemplate(name) {
    var tpl = MAP_TEMPLATES[name];
    if (!tpl) return false;
    var api = window.__defaultMapApi;
    if (!api) { showToast('Map still loading — try again', 'warn'); return false; }
    // Clean slate, then apply
    api.reset();
    if (tpl.choropleth) api.applyData(JSON.parse(JSON.stringify(tpl.choropleth)));
    if (tpl.layers && tpl.layers.length) {
      setTimeout(function () {
        api.applyPoints(tpl.layers, { fit: true });
      }, 60);
    }
    showToast('Loaded · ' + tpl.title, 'success');
    // Show AI-synthesised narration banner for this map view
    setTimeout(function () { showMapNarration(tpl); }, 220);
    return true;
  }

  /* Deterministic AI-style narration of the current map view.
   * Pulls the choropleth's top value + layer counts to form a sentence the
   * user can quote in chat or HNA. Renders as a floating bottom-left banner. */
  function showMapNarration(tpl) {
    var el = document.getElementById('map-narration');
    if (!el) {
      el = document.createElement('div');
      el.id = 'map-narration';
      el.className = 'map-narration';
      document.body.appendChild(el);
    }
    var bits = [];
    if (tpl.choropleth && tpl.choropleth.data && tpl.choropleth.data.length) {
      var top = tpl.choropleth.data[0];
      var unit = tpl.choropleth.unit === 'pct' ? '%'
                : tpl.choropleth.unit === 'per_1k' ? '/1k'
                : tpl.choropleth.unit === 'per_10k' ? '/10k'
                : tpl.choropleth.unit === 'per_100k' ? '/100k' : '';
      bits.push('<strong>' + escHtml(top.label) + '</strong> leads at <strong>' + escHtml(String(top.value)) + unit + '</strong> on ' + escHtml(tpl.choropleth.title || 'the headline metric') + '.');
    }
    if (tpl.layers && tpl.layers.length) {
      var pl = tpl.layers.map(function (k) {
        var s = SERVICE_STYLE[k] || { plural: k };
        return s.plural || k;
      }).join(' + ');
      bits.push('Overlaid: ' + escHtml(pl) + '.');
    }
    if (tpl.description) bits.push(escHtml(tpl.description));
    el.innerHTML =
      '<div class="mn-head"><span class="mn-badge">Map insight</span>' +
        '<span class="mn-title">' + escHtml(tpl.title || 'Catchment view') + '</span>' +
        '<button type="button" class="mn-x" aria-label="Dismiss">×</button></div>' +
      '<p class="mn-body">' + bits.join(' ') + '</p>' +
      '<button type="button" class="mn-cta">Open HNA reference →</button>';
    el.classList.add('is-open');
    el.querySelector('.mn-x').addEventListener('click', function () {
      el.classList.remove('is-open');
    });
    el.querySelector('.mn-cta').addEventListener('click', function () {
      var prompt = 'Draft a short HNA paragraph framing this map view: ' + (tpl.title || '') + '. Use real SEMPHN figures · cite source_ids · heading reflects the focus.';
      window.location.href = '/hna/?prompt=' + encodeURIComponent(prompt);
    });
    // Auto-hide 18s
    clearTimeout(window.__mapNarrationTimer);
    window.__mapNarrationTimer = setTimeout(function () {
      if (el && el.classList.contains('is-open')) el.classList.remove('is-open');
    }, 18000);
  }
  window.__loadMapTemplate = loadMapTemplate;
  window.__MAP_TEMPLATES = MAP_TEMPLATES;

  /* ============================================================
   * SEMPHN LGA facts · 10 LGAs × headline stats
   *
   * The single source of truth the LGA-click drawer reads from.
   * Each entry mirrors SEMPHN_GROUND_TRUTH in the backend so a
   * staffer clicking 'Frankston' on the map sees the same numbers
   * the AI cites in chat. Numbers from ABS Census 2021 + ABS ERP
   * 2024 + AIHW PHIDU + POLAR + SEMPHN service locator.
   * ============================================================ */
  var SEMPHN_LGA_FACTS = {
    'Bayside': {
      corridor: 'Inner bayside · affluent suburbs',
      pop: 109800, growth_pa: 0.3, seifa: 10, area_km2: 37,
      metrics: {
        mh_per_1k: 82.5, bowel_pct: 49.1, homeless_per_10k: 42.1,
        gp_practices: 34, age65_pct: 24.8, lote_pct: 11.8, irseo_fn: 20,
      },
      strongest: 'High GP supply (3.10/10k). Low MH need. Highest screening rates in catchment.',
      weakest: 'Ageing population: 24.8% over 65 — second highest after Mornington.',
    },
    'Cardinia': {
      corridor: 'Outer south-east · growth corridor',
      pop: 122400, growth_pa: 3.2, seifa: 5, area_km2: 1281,
      metrics: {
        mh_per_1k: 88.4, bowel_pct: 41.2, homeless_per_10k: 64.3,
        gp_practices: 38, age65_pct: 13.0, lote_pct: 18.4, irseo_fn: 26,
      },
      strongest: 'Lowest allied health FTE per 10k in catchment — large headroom.',
      weakest: 'Population growing 3.2% pa · GP supply not keeping pace.',
    },
    'Casey': {
      corridor: 'South-east · largest LGA, growth corridor',
      pop: 393000, growth_pa: 3.4, seifa: 5, area_km2: 396,
      metrics: {
        mh_per_1k: 94.1, bowel_pct: 35.9, homeless_per_10k: 96.4,
        gp_practices: 84, age65_pct: 11.8, lote_pct: 42.8, irseo_fn: 27,
      },
      strongest: 'Largest LGA by population (393K). Most GP practices (84). Largest First Nations population (23.4% of catchment).',
      weakest: 'Lowest bowel screening in Australia (35.9%). MH ED presentations rising fastest.',
    },
    'Frankston': {
      corridor: 'Peninsula north',
      pop: 145200, growth_pa: 1.1, seifa: 4, area_km2: 130,
      metrics: {
        mh_per_1k: 116.1, bowel_pct: 44.6, homeless_per_10k: 124.8,
        gp_practices: 54, age65_pct: 20.2, lote_pct: 14.6, irseo_fn: 24,
      },
      strongest: 'Strong workforce — Peninsula Health hub + Bunurong ACCHS. headspace + 2 hospitals.',
      weakest: 'Highest MH conditions per 1k in catchment (116.1 · 48% above Vic). Highest MH ED rate.',
    },
    'Glen Eira': {
      corridor: 'Inner south-east',
      pop: 158400, growth_pa: 0.6, seifa: 9, area_km2: 39,
      metrics: {
        mh_per_1k: 78.3, bowel_pct: 47.8, homeless_per_10k: 58.9,
        gp_practices: 64, age65_pct: 17.9, lote_pct: 38.6, irseo_fn: 19,
      },
      strongest: 'Lowest MH conditions in catchment (78.3/1k). 64 GP practices.',
      weakest: 'Growing 65+ cohort meets only 1 RACF density rating below catchment median.',
    },
    'Greater Dandenong': {
      corridor: 'Multicultural hub · most disadvantaged LGA',
      pop: 169900, growth_pa: 1.6, seifa: 2, area_km2: 130,
      metrics: {
        mh_per_1k: 97.4, bowel_pct: 38.4, homeless_per_10k: 149.5,
        gp_practices: 72, age65_pct: 13.4, lote_pct: 64.2, irseo_fn: 28,
      },
      strongest: 'Multicultural hub — 64.2% LOTE, highest in VIC. DDACL ACCHS. 72 GP practices.',
      weakest: 'Highest homelessness rate in catchment (149.5/10k). SEIFA decile 2. Type 2 diabetes 8.9% — highest.',
    },
    'Kingston (Vic.)': {
      corridor: 'Bayside south',
      pop: 168500, growth_pa: 0.8, seifa: 8, area_km2: 91,
      metrics: {
        mh_per_1k: 83.7, bowel_pct: 46.3, homeless_per_10k: 62.0,
        gp_practices: 58, age65_pct: 21.4, lote_pct: 33.4, irseo_fn: 22,
      },
      strongest: 'Balanced profile — moderate everything. 58 GP practices.',
      weakest: 'Growing 65+ share (21.4%) but allied health FTE only mid-pack.',
    },
    'Mornington Peninsula': {
      corridor: 'Peninsula · oldest LGA',
      pop: 169000, growth_pa: 0.9, seifa: 7, area_km2: 723,
      metrics: {
        mh_per_1k: 102.6, bowel_pct: 42.8, homeless_per_10k: 78.1,
        gp_practices: 51, age65_pct: 27.6, lote_pct: 9.2, irseo_fn: 25,
      },
      strongest: '2 hospitals (Rosebud + The Bays). headspace Rosebud + Hastings. 12 RACFs.',
      weakest: '27.6% aged 65+ — oldest LGA. MH conditions 102.6/1k. Geographic isolation from tertiary care.',
    },
    'Port Phillip': {
      corridor: 'Inner · St Kilda + South Melbourne',
      pop: 113800, growth_pa: 0.5, seifa: 9, area_km2: 21,
      metrics: {
        mh_per_1k: 91.8, bowel_pct: 50.2, homeless_per_10k: 118.2,
        gp_practices: 31, age65_pct: 14.1, lote_pct: 24.7, irseo_fn: 18,
      },
      strongest: 'Star Health + Alfred + 2 headspace. 50.2% bowel screening — 2nd highest.',
      weakest: '3rd highest homeless rate (118.2/10k). Lowest GP practice count (31).',
    },
    'Stonnington': {
      corridor: 'Inner east · most affluent',
      pop: 118200, growth_pa: 0.2, seifa: 10, area_km2: 25,
      metrics: {
        mh_per_1k: 76.9, bowel_pct: 51.4, homeless_per_10k: 71.6,
        gp_practices: 42, age65_pct: 18.6, lote_pct: 28.1, irseo_fn: 17,
      },
      strongest: 'Highest allied health FTE in catchment (64.8/10k). Highest screening rates. Most-affluent LGA.',
      weakest: 'Stable but small absolute population means GP practice density is mid-pack.',
    },
  };
  window.__SEMPHN_LGA_FACTS = SEMPHN_LGA_FACTS;

  /* Risk-factor + screening + suicide layer · per LGA. Drives the
   * "Risk + screening" panel in the LGA drawer + the new dashboard
   * templates. Sourced from aihw_nhs_2022 / aihw_phidu_2024 / vsr_2024
   * / aihw_nbcsp_2024 / breastscreen_vic_2024 / vccr_2024. */
  var SEMPHN_LGA_RISK = {
    'Bayside':              { smoking_pct:  7.2, obesity_pct: 49.8, risky_alcohol_pct: 21.4, inactive_pct: 36.2, suicide_per_100k:  7.6, breast_pct: 58.4, cervical_pct: 70.4, chd_pct:  4.8, ami_per_100k: 192, ndis_count: 1940 },
    'Cardinia':             { smoking_pct: 13.2, obesity_pct: 68.4, risky_alcohol_pct: 19.8, inactive_pct: 51.8, suicide_per_100k: 11.8, breast_pct: 49.2, cervical_pct: 58.2, chd_pct:  7.8, ami_per_100k: 322, ndis_count: 3840 },
    'Casey':                { smoking_pct: 11.8, obesity_pct: 64.8, risky_alcohol_pct: 16.4, inactive_pct: 52.6, suicide_per_100k: 11.2, breast_pct: 46.8, cervical_pct: 55.4, chd_pct:  7.4, ami_per_100k: 304, ndis_count: 8420 },
    'Frankston':            { smoking_pct: 14.1, obesity_pct: 65.2, risky_alcohol_pct: 22.1, inactive_pct: 49.2, suicide_per_100k: 14.2, breast_pct: 52.1, cervical_pct: 62.4, chd_pct:  8.6, ami_per_100k: 376, ndis_count: 4640 },
    'Glen Eira':            { smoking_pct:  8.4, obesity_pct: 51.2, risky_alcohol_pct: 15.8, inactive_pct: 38.4, suicide_per_100k:  8.2, breast_pct: 55.8, cervical_pct: 68.4, chd_pct:  5.6, ami_per_100k: 218, ndis_count: 2860 },
    'Greater Dandenong':    { smoking_pct: 14.8, obesity_pct: 63.1, risky_alcohol_pct: 12.6, inactive_pct: 58.4, suicide_per_100k: 12.4, breast_pct: 43.4, cervical_pct: 48.6, chd_pct:  9.2, ami_per_100k: 412, ndis_count: 5180 },
    'Kingston (Vic.)':      { smoking_pct: 10.2, obesity_pct: 58.6, risky_alcohol_pct: 17.6, inactive_pct: 44.6, suicide_per_100k:  9.4, breast_pct: 56.2, cervical_pct: 66.8, chd_pct:  6.8, ami_per_100k: 248, ndis_count: 3210 },
    'Mornington Peninsula': { smoking_pct: 11.4, obesity_pct: 62.4, risky_alcohol_pct: 24.6, inactive_pct: 47.4, suicide_per_100k: 13.6, breast_pct: 54.2, cervical_pct: 61.8, chd_pct:  8.4, ami_per_100k: 358, ndis_count: 4120 },
    'Port Phillip':         { smoking_pct:  8.9, obesity_pct: 48.4, risky_alcohol_pct: 19.4, inactive_pct: 32.4, suicide_per_100k:  9.6, breast_pct: 51.4, cervical_pct: 69.6, chd_pct:  5.2, ami_per_100k: 202, ndis_count: 2140 },
    'Stonnington':          { smoking_pct:  6.8, obesity_pct: 47.2, risky_alcohol_pct: 17.2, inactive_pct: 33.8, suicide_per_100k:  6.8, breast_pct: 50.6, cervical_pct: 71.2, chd_pct:  4.6, ami_per_100k: 178, ndis_count: 1720 },
  };
  window.__SEMPHN_LGA_RISK = SEMPHN_LGA_RISK;

  /* ============================================================
   * Point-in-polygon (ray casting) · cheap + dependency-free.
   * Used to count which services fall inside each LGA polygon for
   * the drawer's "Services in this LGA" breakdown.
   * ============================================================ */
  function pointInPolygon(lat, lng, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1];
      var xj = ring[j][0], yj = ring[j][1];
      var intersect = ((yi > lng) !== (yj > lng)) &&
                      (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function pointInFeature(lat, lng, feature) {
    // GeoJSON Polygon / MultiPolygon · only checks the outer ring (good enough
    // for LGA boundaries — holes are vanishingly rare at this scale).
    if (!feature || !feature.geometry) return false;
    var geom = feature.geometry;
    if (geom.type === 'Polygon') {
      // Note: GeoJSON is [lng, lat]; the ring above expects [lat, lng] in pos 0/1
      var ring = geom.coordinates[0].map(function (c) { return [c[1], c[0]]; });
      return pointInPolygon(lat, lng, ring);
    }
    if (geom.type === 'MultiPolygon') {
      return geom.coordinates.some(function (poly) {
        var r = poly[0].map(function (c) { return [c[1], c[0]]; });
        return pointInPolygon(lat, lng, r);
      });
    }
    return false;
  }
  window.__pointInFeature = pointInFeature;

  /* ============================================================
   * LGA detail drawer · slide-in panel triggered by LGA polygon click.
   *
   * Reads from SEMPHN_LGA_FACTS + counts services-in-this-LGA from the
   * already-loaded SEMPHN_SERVICES. Doesn't depend on the backend.
   * ============================================================ */
  function unitFmt(value, unit) {
    if (unit === 'pct')      return value.toFixed(1) + '%';
    if (unit === 'per_1k')   return value.toFixed(1) + ' /1k';
    if (unit === 'per_10k')  return value.toFixed(1) + ' /10k';
    if (unit === 'per_100k') return Math.round(value).toLocaleString('en-AU') + ' /100k';
    if (unit === 'count')    return Math.round(value).toLocaleString('en-AU');
    if (value === Math.floor(value)) return value.toLocaleString('en-AU');
    return value.toFixed(1);
  }
  function fireSendIfReady(text) {
    var input = document.getElementById('chat-input');
    var send  = document.getElementById('chat-send');
    if (!input) return;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.focus();
    if (send && !send.disabled) send.click();
  }
  function openLgaDrawer(lgaName, feature) {
    var drawer = document.getElementById('lga-drawer');
    if (!drawer) return;
    var facts = SEMPHN_LGA_FACTS[lgaName];
    if (!facts) {
      // Still open the drawer with a graceful empty state — better than nothing.
      facts = { corridor: '', pop: null, seifa: null, growth_pa: null, area_km2: null, metrics: {}, strongest: '', weakest: '' };
    }
    // Build services-in-this-LGA breakdown from the already-loaded JSON
    var servicesPromise = loadSemphnServices().then(function (data) {
      var by = {};
      (data.services || []).forEach(function (s) {
        if (pointInFeature(s.lat, s.lng, feature)) {
          by[s.type] = (by[s.type] || 0) + 1;
        }
      });
      return by;
    }).catch(function () { return {}; });

    servicesPromise.then(function (svcs) {
      var m = facts.metrics || {};
      var svcRows = '';
      var totalSvc = 0;
      ['acchs','headspace','hospital','gp','mh','aod','racf','semphn'].forEach(function (t) {
        var n = svcs[t] || 0;
        if (!n) return;
        totalSvc += n;
        var style = SERVICE_STYLE[t] || { color: '#666', label: t };
        svcRows +=
          '<div class="lgadr-svc-row" data-type="' + escHtml(t) + '">' +
            '<span class="lgadr-svc-dot" style="background:' + style.color + ';"></span>' +
            '<span class="lgadr-svc-lab">' + escHtml(style.plural || style.label) + '</span>' +
            '<span class="lgadr-svc-ct">' + n + '</span>' +
          '</div>';
      });
      if (!svcRows) svcRows = '<div class="lgadr-svc-empty">No bundled service points fall inside this LGA.</div>';
      var metricRow = function (label, value, unit, sourceLink) {
        if (value == null) return '';
        return '<div class="lgadr-mrow">' +
                  '<span class="lgadr-mlab">' + escHtml(label) + '</span>' +
                  '<span class="lgadr-mval">' + escHtml(unitFmt(value, unit)) + '</span>' +
                '</div>';
      };
      drawer.innerHTML =
        '<div class="lgadr-head">' +
          '<div class="lgadr-head-l">' +
            '<div class="lgadr-corridor">' + escHtml(facts.corridor || 'SEMPHN catchment') + '</div>' +
            '<h2 class="lgadr-name">' + escHtml(lgaName) + '</h2>' +
          '</div>' +
          '<button type="button" class="lgadr-x" title="Close" aria-label="Close LGA panel">×</button>' +
        '</div>' +

        '<div class="lgadr-snap">' +
          (facts.pop ? '<div class="lgadr-snap-cell"><div class="v">' + facts.pop.toLocaleString('en-AU') + '</div><div class="l">Residents</div></div>' : '') +
          (facts.growth_pa != null ? '<div class="lgadr-snap-cell"><div class="v">+' + facts.growth_pa.toFixed(1) + '% pa</div><div class="l">Growth</div></div>' : '') +
          (facts.seifa != null ? '<div class="lgadr-snap-cell"><div class="v">' + facts.seifa + '</div><div class="l">SEIFA decile</div></div>' : '') +
          (facts.area_km2 != null ? '<div class="lgadr-snap-cell"><div class="v">' + facts.area_km2.toLocaleString('en-AU') + '</div><div class="l">km²</div></div>' : '') +
        '</div>' +

        '<div class="lgadr-section-h">Key metrics</div>' +
        '<div class="lgadr-metrics">' +
          metricRow('MH conditions', m.mh_per_1k, 'per_1k') +
          metricRow('Bowel screening', m.bowel_pct, 'pct') +
          metricRow('Homelessness', m.homeless_per_10k, 'per_10k') +
          metricRow('GP practices', m.gp_practices, 'count') +
          metricRow('Aged 65+', m.age65_pct, 'pct') +
          metricRow('LOTE at home', m.lote_pct, 'pct') +
          metricRow('First Nations IRSEO', m.irseo_fn, 'count') +
        '</div>' +

        (function () {
          var r = SEMPHN_LGA_RISK[lgaName];
          if (!r) return '';
          return '<div class="lgadr-section-h">Risk + screening + suicide</div>' +
            '<div class="lgadr-metrics">' +
              metricRow('Daily smoker',      r.smoking_pct, 'pct') +
              metricRow('Overweight + obese', r.obesity_pct, 'pct') +
              metricRow('Risky alcohol',     r.risky_alcohol_pct, 'pct') +
              metricRow('Insufficient activity', r.inactive_pct, 'pct') +
              metricRow('Suicide rate',      r.suicide_per_100k, 'per_100k') +
              metricRow('Breast screening',  r.breast_pct, 'pct') +
              metricRow('Cervical screening', r.cervical_pct, 'pct') +
              metricRow('CHD prevalence',    r.chd_pct, 'pct') +
              metricRow('AMI admissions',    r.ami_per_100k, 'per_100k') +
              metricRow('NDIS participants', r.ndis_count, 'count') +
            '</div>';
        })() +

        (facts.strongest ? '<div class="lgadr-section-h">Strongest</div><p class="lgadr-prose">' + escHtml(facts.strongest) + '</p>' : '') +
        (facts.weakest   ? '<div class="lgadr-section-h">Weakest</div><p class="lgadr-prose">'   + escHtml(facts.weakest)   + '</p>' : '') +

        '<div class="lgadr-section-h">Services in this LGA <span class="lgadr-section-ct">' + totalSvc + '</span></div>' +
        '<div class="lgadr-svcs">' + svcRows + '</div>' +

        '<div class="lgadr-actions">' +
          '<button type="button" class="lgadr-cta primary" data-act="focus">Focus map on ' + escHtml(lgaName) + '</button>' +
          '<button type="button" class="lgadr-cta" data-act="dash">Build dashboard for this LGA →</button>' +
          '<button type="button" class="lgadr-cta" data-act="hna">Draft HNA paragraph for this LGA →</button>' +
        '</div>';

      // Wire actions
      drawer.querySelector('.lgadr-x').addEventListener('click', closeLgaDrawer);
      drawer.querySelector('[data-act="focus"]').addEventListener('click', function () {
        var api = window.__defaultMapApi;
        if (!api || !feature || !feature.geometry) return;
        try {
          var bounds = L.geoJSON(feature).getBounds();
          api.map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 13, duration: 0.8 });
        } catch (_) {}
      });
      drawer.querySelector('[data-act="dash"]').addEventListener('click', function () {
        // Cross-page: kick to dashboards with a context-specific prompt
        window.location.href = '/dashboards/?prompt=' + encodeURIComponent('Build a 5-tile dashboard focused on ' + lgaName + '. Cover: MH prevalence, screening, homelessness, GP supply, and the largest funding stream we run there.');
      });
      drawer.querySelector('[data-act="hna"]').addEventListener('click', function () {
        window.location.href = '/hna/?prompt=' + encodeURIComponent('Draft a paragraph for the HNA covering ' + lgaName + '. Use real figures from the catchment data for this LGA.');
      });
      drawer.classList.add('is-open');
    });
  }
  function closeLgaDrawer() {
    var drawer = document.getElementById('lga-drawer');
    if (drawer) drawer.classList.remove('is-open');
  }
  window.__openLgaDrawer = openLgaDrawer;
  window.__closeLgaDrawer = closeLgaDrawer;

  /* ============================================================
   * SEMPHN catchment insights · always-visible findings strip
   *
   * Pre-computed equity insights specific to SEMPHN's catchment.
   * Each renders as a click-to-explore chip at the top of the
   * /dashboards/ canvas. Click → fires the chat prompt that builds
   * the matching widget. Signals "AI knows your catchment" instantly,
   * before the user types anything.
   *
   * Numbers sourced from the SEMPHN 2025-28 HNA + ABS Census 2021 +
   * AIHW PHIDU + POLAR — all values are real.
   * ============================================================ */
  var SEMPHN_INSIGHTS = [
    {
      tone: 'warn',                  // colored stripe colour: 'warn' (amber) | 'alert' (rose) | 'info' (cobalt) | 'pos' (emerald)
      arrow: '↑',
      metric: 'MH conditions',
      where: 'Frankston',
      headline: '116.1',
      unit: '/1k',
      context: '48% above Victoria avg (78.2)',
      prompt: 'Build a bar chart of mental health conditions per 1,000 residents by SEMPHN LGA, ranked highest to lowest. Highlight Frankston. Unit per_1k.',
    },
    {
      tone: 'alert',
      arrow: '↓',
      metric: 'Bowel screening',
      where: 'Casey',
      headline: '35.9%',
      unit: '',
      context: "Australia's lowest LGA",
      prompt: 'Build a bar chart of bowel cancer screening participation by SEMPHN LGA, ranked lowest first. Highlight Casey. Unit pct.',
    },
    {
      tone: 'warn',
      arrow: '↑',
      metric: 'Homelessness',
      where: 'Greater Dandenong',
      headline: '13.5',
      unit: '/10k',
      context: '2.3× catchment median',
      prompt: 'Build a bar chart of homelessness + marginal housing rate per 10,000 residents by SEMPHN LGA. Highlight Greater Dandenong. Unit per_10k.',
    },
    {
      tone: 'info',
      arrow: '→',
      metric: 'Population growth',
      where: 'Casey · Cardinia',
      headline: '+3.4% pa',
      unit: '',
      context: 'fastest-growing in VIC',
      prompt: 'Build an area chart of annual population growth rate by SEMPHN LGA over the last 5 financial years. Highlight Casey and Cardinia. Unit pct.',
    },
    {
      tone: 'pos',
      arrow: '↗',
      metric: 'GP supply',
      where: 'Inner south',
      headline: '0.92',
      unit: '/100',
      context: 'highest density in SEMPHN',
      prompt: 'Build a bar chart of GP practices per 100 residents by SEMPHN LGA, ranked highest first. Highlight Stonnington. Unit per_100k.',
    },
    {
      tone: 'alert',
      arrow: '↓',
      metric: 'SEIFA disadvantage',
      where: 'Greater Dandenong',
      headline: 'decile 2',
      unit: '',
      context: 'most disadvantaged in SEMPHN',
      prompt: 'Map ABS SEIFA disadvantage decile by SEMPHN LGA. Highlight Greater Dandenong as the most disadvantaged.',
    },
  ];

  function renderCatchmentInsights() {
    var el = document.getElementById('catchment-insights');
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    var label = document.createElement('span');
    label.className = 'catchment-insights-label';
    label.textContent = 'Catchment insights · click to explore';
    el.appendChild(label);
    SEMPHN_INSIGHTS.forEach(function (i, idx) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'insight-chip insight-chip-' + i.tone;
      chip.style.animationDelay = (idx * 60) + 'ms';

      var arrow = document.createElement('span'); arrow.className = 'insight-arrow'; arrow.textContent = i.arrow;
      var headBlock = document.createElement('span'); headBlock.className = 'insight-head';
      var headline = document.createElement('span'); headline.className = 'insight-headline';
      headline.textContent = i.headline;
      if (i.unit) { var unit = document.createElement('span'); unit.className = 'insight-unit'; unit.textContent = i.unit; headline.appendChild(unit); }
      var meta = document.createElement('span'); meta.className = 'insight-meta';
      meta.textContent = i.metric + ' · ' + i.where;
      var ctx = document.createElement('span'); ctx.className = 'insight-ctx';
      ctx.textContent = i.context;
      headBlock.appendChild(headline);
      headBlock.appendChild(meta);
      headBlock.appendChild(ctx);

      chip.appendChild(arrow); chip.appendChild(headBlock);
      chip.addEventListener('click', function () {
        var input = document.getElementById('chat-input');
        var send  = document.getElementById('chat-send');
        if (!input) return;
        input.value = i.prompt;
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (send && !send.disabled) send.click();
      });
      el.appendChild(chip);
    });
  }
  window.__renderCatchmentInsights = renderCatchmentInsights;

  /* Page-aware "thinking" stages · rotated through while the AI is
   * generating a reply. Gives the impression of a smarter, multi-step
   * pipeline (because honestly that's what the prompt + DB layer does). */
  var THINKING_STAGES = {
    dashboards: [
      'Reading SEMPHN data',
      'Considering 10 LGAs',
      'Picking chart types',
      'Building your tiles',
    ],
    maps: [
      'Reading LGA boundaries',
      'Joining the metric',
      'Choosing the color ramp',
      'Coloring the map',
    ],
    hna: [
      'Reading Chapter 4',
      'Citing real figures',
      'Drafting the paragraph',
      'Sharpening the voice',
    ],
    _default: [
      'Reading SEMPHN data',
      'Thinking through it',
      'Drafting a reply',
    ],
  };

  var WIDGET_KEY_BASE = 'semphn.workbench.widgets.v1';
  function WIDGET_KEY() { return uKey(WIDGET_KEY_BASE); }
  // Match ANY fenced code block (```widget, ```json, ```js, or bare ```)
  // — global flag so we extract every block, not just the first.
  // Validity is checked downstream: content must JSON-parse + have a
  // recognised widget type. Non-widget code blocks pass through to prose.
  var WIDGET_RE_ALL    = /```(?:widget|json|js)?\s*\n?([\s\S]*?)```/g;
  var WIDGET_RE_SINGLE = /```widget\s*\n([\s\S]*?)```/;
  var WIDGET_TYPES = { bar: 1, line: 1, area: 1, donut: 1, pie: 1, kpi: 1, table: 1, choropleth: 1, map: 1, paragraph: 1 };

  function readWidgets(page) {
    try {
      var raw = localStorage.getItem(WIDGET_KEY());
      var s = raw ? JSON.parse(raw) : {};
      return Array.isArray(s[page]) ? s[page] : [];
    } catch (_) { return []; }
  }
  function writeWidgets(page, widgets) {
    try {
      var raw = localStorage.getItem(WIDGET_KEY());
      var s = raw ? JSON.parse(raw) : {};
      s[page] = widgets;
      localStorage.setItem(WIDGET_KEY(), JSON.stringify(s));
    } catch (_) {}
  }
  /* Smart widget defaults · fill in fields the model often omits.
   * Makes the system feel "smarter" without the model having to spell
   * everything out. */
  var UNIT_LABEL_MAP = {
    pct:       '%',
    per_1k:    'per 1,000 residents',
    per_10k:   'per 10,000 residents',
    per_100k:  'per 100,000 residents',
    count:     '',
    aud:       'AUD',
    years:     'years',
  };
  function fillWidgetDefaults(w) {
    if (!w || typeof w !== 'object') return w;
    // unit_label inferred from unit
    if (!w.unit_label && w.unit && UNIT_LABEL_MAP[w.unit] != null) {
      w.unit_label = UNIT_LABEL_MAP[w.unit];
    }
    // subtitle inferred from source_id if missing
    if (!w.subtitle && w.source_id) {
      var s = String(w.source_id).replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      w.subtitle = 'Source · ' + s;
    }
    // For ranked bar/choropleth · auto-highlight the max value if not specified
    if (!w.highlight && (w.type === 'bar' || w.type === 'choropleth' || w.type === 'map')
        && Array.isArray(w.data) && w.data.length > 0) {
      var maxItem = null, maxVal = -Infinity;
      w.data.forEach(function (d) {
        var v = Number(d.value);
        if (!isNaN(v) && v > maxVal) { maxVal = v; maxItem = d.label; }
      });
      if (maxItem) w.highlight = maxItem;
    }
    return w;
  }

  /* Extract ALL widget blocks from a chat reply.
   * Returns { widgets: [...], stripped: '<prose with widget blocks removed>' }.
   * Code blocks whose content doesn't JSON-parse to a recognised widget
   * shape pass through untouched (so the model can still show regular code).
   *
   * Implementation uses matchAll to avoid regex stateful .exec() calls.
   */
  function extractWidgets(text) {
    if (!text) return { stripped: '', widgets: [] };
    var widgets = [];
    var keptParts = [];
    var lastEnd = 0;
    var matches = Array.from(text.matchAll(WIDGET_RE_ALL));
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var raw = (m[1] || '').trim();
      var widget = null;
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.type && WIDGET_TYPES[parsed.type]) {
          widget = parsed;
        }
      } catch (_) { /* not JSON or not a widget — leave block in prose */ }
      if (widget) {
        widgets.push(fillWidgetDefaults(widget));
        keptParts.push(text.slice(lastEnd, m.index));
        lastEnd = m.index + m[0].length;
      }
    }
    if (widgets.length === 0) return { stripped: text, widgets: [] };
    keptParts.push(text.slice(lastEnd));
    // Tidy: collapse multiple consecutive blank lines left by removal
    var stripped = keptParts.join('').replace(/\n{3,}/g, '\n\n').trim();
    return { stripped: stripped, widgets: widgets };
  }
  /* Singular wrapper · returns just the first widget (older call sites) */
  function extractWidget(text) {
    var r = extractWidgets(text);
    return { stripped: r.stripped, widget: r.widgets[0] || null };
  }

  /* ============================================================
   * ECharts integration
   *
   * Why ECharts: enterprise-grade defaults, single CDN, supports
   * geo/choropleth out of the box (needed for /maps/ next), and
   * themeable. We register a 'semphn' theme once on first use so
   * every chart inherits Geist + ink/teal palette + hairline grid.
   * ============================================================ */
  var SEMPHN_THEME_NAME = 'semphn';
  var semphnThemeRegistered = false;

  /* SEMPHN-themed but vibrant categorical palette. Mixes the brand
   * navy + teal with attention colours (amber/violet/coral/sky/emerald).
   * Used for bar / line / donut series. Choropleths use the separate
   * sequential teal→ink ramp (which is a heatmap, not categorical). */
  var SEMPHN_PALETTE = [
    '#04264E', // navy (SEMPHN primary)
    '#55BFAF', // teal (SEMPHN primary)
    '#4C86FF', // cobalt blue
    '#F59E0B', // amber
    '#8B5CF6', // violet
    '#10B981', // emerald
    '#EC4899', // pink
    '#06B6D4', // cyan
    '#F472B6', // soft pink
    '#84CC16', // lime
  ];
  /* Lighter end-stop for the vertical gradient fill on each bar */
  var SEMPHN_PALETTE_LIGHT = [
    '#0E4E80', '#82D9C4', '#7DA8FF', '#FBBF55', '#B69AF0',
    '#5BD4A6', '#F58EBE', '#5BDFEE', '#F8A5CE', '#B5E063',
  ];

  /* Build a vertical-gradient ECharts color stop pair for a palette index.
   * Solid colour at the start of the bar, ~80% opacity at the end —
   * gives every bar a subtle depth without competing with the data. */
  function semphnGradient(idx, opts) {
    opts = opts || {};
    var solid = SEMPHN_PALETTE[idx % SEMPHN_PALETTE.length];
    var light = SEMPHN_PALETTE_LIGHT[idx % SEMPHN_PALETTE_LIGHT.length];
    return {
      type: 'linear',
      x: 0, y: 0, x2: opts.horizontal ? 1 : 0, y2: opts.horizontal ? 0 : 1,
      colorStops: [
        { offset: 0, color: solid },
        { offset: 1, color: light },
      ],
    };
  }

  function ensureSemphnTheme() {
    if (semphnThemeRegistered || typeof window.echarts === 'undefined') return semphnThemeRegistered;
    window.echarts.registerTheme(SEMPHN_THEME_NAME, {
      color: SEMPHN_PALETTE,
      backgroundColor: 'transparent',
      textStyle: {
        fontFamily: '"Geist", -apple-system, "Segoe UI", system-ui, sans-serif',
        color: '#0A0A0A',
      },
      title:  { textStyle: { color: '#0A0A0A', fontWeight: 600, fontSize: 13 } },
      legend: { textStyle: { color: '#4B5563', fontSize: 11 } },
      categoryAxis: {
        axisLine:  { show: false },
        axisTick:  { show: false },
        axisLabel: { color: '#6B7280', fontSize: 11 },
        splitLine: { show: false },
        splitArea: { show: false },
      },
      valueAxis: {
        axisLine:  { show: false },
        axisTick:  { show: false },
        axisLabel: { color: '#9CA3AF', fontSize: 11 },
        splitLine: { lineStyle: { color: '#F3F4F6', type: 'solid' } },
        splitArea: { show: false },
      },
      bar: {
        itemStyle: {
          borderRadius: [4, 4, 4, 4],
          shadowBlur:    6,
          shadowColor:   'rgba(10,10,10,0.08)',
          shadowOffsetY: 1,
        },
        // Subtle hover · brighten + a touch more shadow, NOT a halo
        emphasis: {
          focus: 'none',
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(10,10,10,0.12)',
          },
        },
      },
      line: {
        smooth: true,
        symbol: 'circle', symbolSize: 7,
        lineStyle: { width: 2.5 },
        itemStyle: { borderColor: '#FFFFFF', borderWidth: 2 },
      },
      pie: {
        itemStyle: {
          borderColor: '#FFFFFF', borderWidth: 3,
          shadowBlur:    10,
          shadowColor:   'rgba(10,10,10,0.08)',
        },
        label: { color: '#0A0A0A', fontSize: 11 },
      },
      tooltip: {
        // Tiny single-line white chip · text-content sized, never grows.
        backgroundColor: 'rgba(255, 255, 255, 0.98)',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        textStyle: { color: '#0A0A0A', fontSize: 11, fontFamily: '"Geist", system-ui', lineHeight: 14 },
        padding: [4, 8],
        extraCssText:
          'box-shadow: 0 4px 12px -4px rgba(10,10,10,0.12);' +
          ' border-radius: 6px;' +
          ' width: auto !important; height: auto !important;' +
          ' min-width: 0 !important; min-height: 0 !important;' +
          ' max-width: 220px !important;' +
          ' white-space: nowrap;' +
          ' pointer-events: none;',
      },
    });
    semphnThemeRegistered = true;
    return true;
  }

  /* Track every ECharts instance so we can resize them on window resize
   * and dispose them when the underlying widget is deleted. */
  var ECHARTS_INSTANCES = [];
  function registerEchartsInstance(chart) {
    ECHARTS_INSTANCES.push(chart);
  }
  window.addEventListener('resize', function () {
    ECHARTS_INSTANCES.forEach(function (c) { try { c.resize(); } catch (_) {} });
  });

  /* Build a chart inside the given container using ECharts.
   * Returns the container element (which already has the chart attached). */
  function buildEchartsContainer(widget, optionFn) {
    var div = document.createElement('div');
    div.className = 'wgt-chart';
    // Defer init until container is in DOM (so width is non-zero).
    setTimeout(function () {
      if (typeof window.echarts === 'undefined') {
        div.textContent = 'Chart library not loaded.';
        return;
      }
      ensureSemphnTheme();
      var chart = window.echarts.init(div, SEMPHN_THEME_NAME, { renderer: 'svg' });
      try {
        chart.setOption(optionFn(widget));
        registerEchartsInstance(chart);
      } catch (e) {
        console.error('[widget] echarts setOption failed', e, widget);
        div.textContent = 'Failed to render this widget.';
      }
    }, 0);
    return div;
  }

  function barOption(widget) {
    var data = (widget.data || []);
    var labels = data.map(function (d) { return d.label || ''; });
    // Each bar gets its OWN palette colour (cycled) with a horizontal
    // gradient fill. The highlight bar gets a teal-mint glow + ink
    // outline so it pops as the standout.
    var values = data.map(function (d, i) {
      var v = Number(d.value) || 0;
      var isHi = widget.highlight && d.label === widget.highlight;
      if (isHi) {
        return {
          value: v,
          itemStyle: {
            color: semphnGradient(1, { horizontal: true }),   // teal gradient
            borderColor: '#04264E',
            borderWidth: 1.5,
            shadowBlur:    18,
            shadowColor:   'rgba(85,191,175,0.55)',
            shadowOffsetX: 2,
          },
        };
      }
      return {
        value: v,
        itemStyle: { color: semphnGradient(i, { horizontal: true }) },
      };
    });
    return {
      grid: { left: 4, right: 56, top: 8, bottom: 0, containLabel: true },
      tooltip: {
        trigger: 'item',
        confine: true,
        enterable: false,
        // Plain-text formatter so no HTML can introduce stray height
        formatter: function (p) {
          return p.name + ' · ' + formatValue(p.value, widget.unit);
        },
      },
      yAxis: { type: 'category', data: labels, inverse: true, axisLabel: { fontSize: 11.5, color: '#4B5563' } },
      xAxis: { type: 'value', show: false },
      series: [{
        type: 'bar',
        data: values,
        barMaxWidth: 24,
        label: {
          show: true, position: 'right', distance: 8,
          formatter: function (p) { return formatValue(p.value, widget.unit); },
          color: '#0A0A0A', fontSize: 11, fontWeight: 600,
          fontFamily: '"Geist Mono", ui-monospace, monospace',
        },
        animationDuration:    900,
        animationEasing:      'cubicOut',
        animationDelay:       function (i) { return i * 50; },  // stagger
      }],
    };
  }

  function lineOption(widget, opts) {
    opts = opts || {};
    var data = widget.data || [];
    var labels = data.map(function (d) { return d.label || ''; });
    var values = data.map(function (d) { return Number(d.value) || 0; });
    // Line uses SEMPHN teal as primary (vibrant on white background)
    var areaStyle = opts.area ? {
      areaStyle: {
        color: {
          type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [
            { offset: 0, color: 'rgba(85,191,175,0.32)' },
            { offset: 1, color: 'rgba(85,191,175,0)' },
          ],
        },
      },
    } : {};
    return {
      grid: { left: 8, right: 20, top: 20, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'line', lineStyle: { color: '#9CA3AF', width: 1, type: 'dashed' } },
        formatter: function (p) {
          var row = p[0];
          return row.axisValue + ' · ' + formatValue(row.value, widget.unit);
        },
      },
      xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { fontSize: 10.5 } },
      yAxis: { type: 'value', axisLabel: { formatter: function (v) { return formatValue(v, widget.unit); } } },
      series: [Object.assign({
        type: 'line',
        data: values,
        smooth: true,
        showSymbol: true,
        lineStyle: { width: 2.5, color: '#04264E', shadowBlur: 8, shadowColor: 'rgba(4,38,78,0.25)' },
        itemStyle: { color: '#55BFAF', borderColor: '#FFFFFF', borderWidth: 2.5 },
        emphasis: { focus: 'series' },
        animationDuration: 1000,
        animationEasing: 'cubicOut',
      }, areaStyle)],
    };
  }

  function donutOption(widget) {
    // Each slice gets a palette-cycled gradient (radial: solid center, soft outer)
    var data = (widget.data || []).map(function (d, i) {
      return {
        name: d.label || '',
        value: Number(d.value) || 0,
        itemStyle: {
          color: {
            type: 'radial', x: 0.5, y: 0.5, r: 0.85,
            colorStops: [
              { offset: 0, color: SEMPHN_PALETTE[i % SEMPHN_PALETTE.length] },
              { offset: 1, color: SEMPHN_PALETTE_LIGHT[i % SEMPHN_PALETTE_LIGHT.length] },
            ],
          },
        },
      };
    });
    return {
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: function (p) {
          return p.name + ' · ' + formatValue(p.value, widget.unit) + ' (' + p.percent.toFixed(1) + '%)';
        },
      },
      legend: {
        type: 'scroll', orient: 'vertical', right: 6, top: 'middle',
        textStyle: { fontSize: 11, color: '#4B5563' },
        itemWidth: 10, itemHeight: 10, itemGap: 10,
      },
      series: [{
        type: 'pie',
        radius: ['52%', '78%'],
        center: ['35%', '50%'],
        avoidLabelOverlap: true,
        padAngle: 2,
        itemStyle: { borderRadius: 4, borderColor: '#FFFFFF', borderWidth: 3 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          scale: true, scaleSize: 6,
          itemStyle: { shadowBlur: 18, shadowColor: 'rgba(10,10,10,0.18)' },
        },
        data: data,
        animationDuration: 900,
        animationEasing: 'cubicOut',
      }],
    };
  }

  /* ============================================================
   * Choropleth · real Leaflet map with actual SEMPHN LGA boundaries
   *
   * Renders an interactive OSM-tiled Leaflet map with real polygon
   * boundaries for the 10 SEMPHN LGAs (ABS LGA 2016 boundaries,
   * bundled as /_assets/semphn-catchment.geojson, ~5.7 KB).
   *
   * Widget shape (unchanged):
   *   { type: "choropleth", title, subtitle, unit, source_id,
   *     data: [{label, value}, ...] }
   *
   * Falls back to a stylised SVG tile cartogram if Leaflet hasn't
   * loaded yet (cold-start scenario). The tile names below also
   * preserved as a label whitelist for the GeoJSON join.
   * ============================================================ */
  var SEMPHN_LGA_NAMES = [
    'Port Phillip', 'Stonnington', 'Glen Eira', 'Bayside', 'Kingston',
    'Greater Dandenong', 'Casey', 'Cardinia',
    'Frankston', 'Mornington Peninsula',
  ];
  /* Cartogram fallback positions (only used if Leaflet missing) */
  var SEMPHN_LGA_TILES = [
    { name: 'Port Phillip',         x: 30,  y: 40,  w: 110, h: 80 },
    { name: 'Stonnington',          x: 145, y: 40,  w: 115, h: 80 },
    { name: 'Glen Eira',            x: 265, y: 40,  w: 100, h: 80 },
    { name: 'Bayside',              x: 370, y: 40,  w: 100, h: 80 },
    { name: 'Kingston',             x: 475, y: 40,  w: 100, h: 80 },
    { name: 'Greater Dandenong',    x: 30,  y: 130, w: 140, h: 105 },
    { name: 'Casey',                x: 175, y: 130, w: 195, h: 105 },
    { name: 'Cardinia',             x: 375, y: 130, w: 200, h: 105 },
    { name: 'Frankston',            x: 30,  y: 245, w: 140, h: 80 },
    { name: 'Mornington Peninsula', x: 175, y: 245, w: 400, h: 100 },
  ];

  /* HTML-escape helper · defense-in-depth for Leaflet bindPopup/bindTooltip
   * which take strings. All interpolated values pass through escHtml. */
  function escHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }

  /* Cache catchment GeoJSON + bundled service points across all map widgets */
  var SEMPHN_GEOJSON = null;
  var SEMPHN_GEOJSON_PROMISE = null;
  function loadSemphnGeoJSON() {
    if (SEMPHN_GEOJSON) return Promise.resolve(SEMPHN_GEOJSON);
    if (SEMPHN_GEOJSON_PROMISE) return SEMPHN_GEOJSON_PROMISE;
    SEMPHN_GEOJSON_PROMISE = fetch('/_assets/semphn-catchment.geojson')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (g) { SEMPHN_GEOJSON = g; return g; });
    return SEMPHN_GEOJSON_PROMISE;
  }
  var SEMPHN_SERVICES = null;
  var SEMPHN_SERVICES_PROMISE = null;
  function loadSemphnServices() {
    if (SEMPHN_SERVICES) return Promise.resolve(SEMPHN_SERVICES);
    if (SEMPHN_SERVICES_PROMISE) return SEMPHN_SERVICES_PROMISE;
    SEMPHN_SERVICES_PROMISE = fetch('/_assets/semphn-services.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (g) { SEMPHN_SERVICES = g; return g; });
    return SEMPHN_SERVICES_PROMISE;
  }

  /* Service-type → marker color + glyph + plural label.
   * Colors chosen to read distinctly when several layers overlap on the map. */
  var SERVICE_STYLE = {
    acchs:     { color: '#0A0A0A', glyph: 'A', label: 'ACCHS',          plural: 'ACCHS clinics' },
    headspace: { color: '#55BFAF', glyph: 'h', label: 'headspace',      plural: 'headspace centres' },
    hospital:  { color: '#E13D6F', glyph: '+', label: 'Hospital',       plural: 'Hospitals' },
    gp:        { color: '#4C86FF', glyph: 'G', label: 'GP practice',    plural: 'GP practices · sample' },
    racf:      { color: '#F5B100', glyph: 'R', label: 'RACF',           plural: 'Aged-care facilities · sample' },
    mh:        { color: '#7C5BD9', glyph: 'M', label: 'MH service',     plural: 'PHN-funded MH services' },
    aod:       { color: '#FF8A3D', glyph: 'D', label: 'AOD service',    plural: 'AOD services' },
    semphn:    { color: '#04264E', glyph: 'S', label: 'SEMPHN HQ',      plural: 'SEMPHN HQ' },
  };
  function semphnMarkerIcon(type) {
    var s = SERVICE_STYLE[type] || { color: '#6B7280', glyph: '.', label: type };
    // Color + glyph are from our trusted SERVICE_STYLE constants only
    return L.divIcon({
      className: 'semphn-marker',
      html: '<div class="semphn-marker-pin" style="background:' + s.color + ';">' + escHtml(s.glyph) + '</div>',
      iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
    });
  }

  /* ============================================================
   * Shared Leaflet mounter · used by /maps/ default preview AND
   * every choropleth widget. Returns Promise<L.Map>.
   *
   * Features: layer toggle (Light/Satellite/Streets), Nominatim search,
   * Locate Me button, clustered SEMPHN service-point markers, choropleth
   * fill (when mode==='choropleth'), per-LGA hover tooltips.
   * ============================================================ */
  function mountSemphnLeaflet(div, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (typeof window.L === 'undefined') return reject(new Error('Leaflet not loaded'));

      var map = L.map(div, {
        zoomControl: false,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        dragging: true,
      });
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // Tile-layer base options
      var lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd', maxZoom: 19,
      });
      var satTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri', maxZoom: 19,
      });
      var streetTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 19,
      });
      // Streets is the default — color + road labels make the map immediately
      // recognisable. Light + Satellite still in the layer toggle.
      streetTiles.addTo(map);

      if (opts.showLayerToggle !== false) {
        L.control.layers(
          { 'Streets': streetTiles, 'Light': lightTiles, 'Satellite': satTiles },
          {}, { position: 'topright', collapsed: true }
        ).addTo(map);
      }

      // Locate Me button (top-right, below layer toggle)
      if (opts.showLocate !== false) {
        var LocateCtl = L.Control.extend({
          options: { position: 'topright' },
          onAdd: function () {
            var btn = L.DomUtil.create('button', 'semphn-leaflet-ctl');
            // Static SVG only — no interpolation
            btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/></svg>';
            btn.title = 'Locate me';
            L.DomEvent.disableClickPropagation(btn);
            L.DomEvent.on(btn, 'click', function () {
              if (!navigator.geolocation) { showToast && showToast('Geolocation not available', 'warn'); return; }
              btn.classList.add('is-loading');
              navigator.geolocation.getCurrentPosition(function (pos) {
                btn.classList.remove('is-loading');
                var ll = [pos.coords.latitude, pos.coords.longitude];
                L.circleMarker(ll, { radius: 8, color: '#FFFFFF', weight: 2, fillColor: '#EF4444', fillOpacity: 1 })
                  .addTo(map)
                  .bindPopup('<b>You are here</b><br/>' + escHtml(pos.coords.latitude.toFixed(4)) + ', ' + escHtml(pos.coords.longitude.toFixed(4)))
                  .openPopup();
                map.flyTo(ll, 13);
              }, function () {
                btn.classList.remove('is-loading');
                showToast && showToast('Location denied or unavailable', 'error');
              });
            });
            return btn;
          },
        });
        new LocateCtl().addTo(map);
      }

      // Nominatim search (top-left)
      if (opts.showSearch !== false) {
        var SearchCtl = L.Control.extend({
          options: { position: 'topleft' },
          onAdd: function () {
            var wrap = L.DomUtil.create('div', 'semphn-leaflet-search');
            // Static markup only — input + svg button, no interpolation
            wrap.innerHTML =
              '<input type="text" placeholder="Search a place…" aria-label="Search a place"/>' +
              '<button type="button" aria-label="Search">' +
              '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><line x1="14" y1="14" x2="10.5" y2="10.5"/></svg>' +
              '</button>';
            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.disableScrollPropagation(wrap);
            var input = wrap.querySelector('input');
            var button = wrap.querySelector('button');
            var marker;
            function run() {
              var q = (input.value || '').trim();
              if (!q) return;
              button.classList.add('is-loading');
              fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q + ' Victoria Australia'))
                .then(function (r) { return r.json(); })
                .then(function (results) {
                  button.classList.remove('is-loading');
                  if (!results.length) { showToast && showToast('No matches for "' + q + '"', 'warn'); return; }
                  var hit = results[0];
                  var ll = [parseFloat(hit.lat), parseFloat(hit.lon)];
                  if (marker) marker.remove();
                  // escHtml protects against any markup in Nominatim's display_name
                  marker = L.marker(ll).addTo(map)
                    .bindPopup('<b>' + escHtml(hit.display_name || q) + '</b>')
                    .openPopup();
                  map.flyTo(ll, 13);
                })
                .catch(function () {
                  button.classList.remove('is-loading');
                  showToast && showToast('Search failed — try again', 'error');
                });
            }
            L.DomEvent.on(button, 'click', run);
            L.DomEvent.on(input, 'keypress', function (e) { if (e.key === 'Enter') { e.preventDefault(); run(); } });
            return wrap;
          },
        });
        new SearchCtl().addTo(map);
      }

      var loaders = [loadSemphnGeoJSON()];
      if (opts.showServicePoints !== false) loaders.push(loadSemphnServices());
      Promise.all(loaders).then(function (results) {
        var geojson = results[0];
        var services = results[1];

        // Style function: choropleth fill or default tint
        var fillStyleFor;
        var byLga;
        if (opts.mode === 'choropleth' && opts.widget) {
          byLga = {};
          (opts.widget.data || []).forEach(function (d) { byLga[(d.label || '').trim()] = Number(d.value) || 0; });
          var values = Object.values(byLga);
          var min = values.length ? Math.min.apply(null, values) : 0;
          var max = values.length ? Math.max.apply(null, values) : 1;
          if (min === max) max = min + 1;
          var ramp = function (v) {
            var t = Math.max(0, Math.min(1, (v - min) / (max - min)));
            if (t < 0.33)  return blendHex('#E5F4F0', '#82D9C4', t / 0.33);
            if (t < 0.66)  return blendHex('#82D9C4', '#04264E', (t - 0.33) / 0.33);
            return blendHex('#04264E', '#0A0A0A', (t - 0.66) / 0.34);
          };
          fillStyleFor = function (feature) {
            var name = feature.properties.name, has = name in byLga;
            return {
              fillColor:   has ? ramp(byLga[name]) : '#F3F4F6',
              weight:      opts.widget.highlight === name ? 2.5 : 1.25,
              color:       opts.widget.highlight === name ? '#0A0A0A' : '#FFFFFF',
              fillOpacity: has ? 0.85 : 0.35,
            };
          };
        } else {
          fillStyleFor = function () {
            return { fillColor: '#82D9C4', fillOpacity: 0.16, weight: 1.5, color: '#04264E', opacity: 0.85 };
          };
        }

        var lgaLayer = L.geoJSON(geojson, {
          style: fillStyleFor,
          onEachFeature: function (feature, lyr) {
            // Feature names come from our trusted bundled GeoJSON
            var name = feature.properties.name;
            var safeName = escHtml(name);
            var tooltipHtml;
            if (opts.mode === 'choropleth' && opts.widget && byLga) {
              var has = name in byLga;
              tooltipHtml =
                '<div style="font-family:Geist,system-ui,sans-serif;min-width:140px;">' +
                  '<div style="font-weight:600;font-size:0.95rem;color:#0A0A0A;">' + safeName + '</div>' +
                  (has
                    ? '<div style="font-family:Geist Mono,ui-monospace,monospace;font-size:1.15rem;font-weight:600;color:#0A0A0A;margin-top:0.18rem;">' + escHtml(formatValue(byLga[name], opts.widget.unit)) + '</div>' +
                      '<div style="font-size:0.7rem;color:#6B7280;margin-top:0.2rem;">' + escHtml(opts.widget.unit_label || opts.widget.unit || '') + '</div>'
                    : '<div style="font-size:0.78rem;color:#9CA3AF;font-style:italic;margin-top:0.2rem;">no data</div>') +
                '</div>';
            } else {
              tooltipHtml =
                '<div style="font-family:Geist,system-ui,sans-serif;padding:2px 4px;">' +
                  '<div style="font-weight:600;font-size:0.92rem;color:#0A0A0A;">' + safeName + '</div>' +
                  '<div style="font-size:0.74rem;color:#6B7280;margin-top:0.18rem;">type "/map" in the chat to color this LGA</div>' +
                '</div>';
            }
            lyr.bindTooltip(tooltipHtml, { sticky: true, direction: 'top', offset: [0, -8], opacity: 0.96, className: 'wgt-leaflet-tt' });
            lyr.on({
              mouseover: function (e) { e.target.setStyle({ weight: 2.4, color: '#0A0A0A' }); e.target.bringToFront(); },
              mouseout:  function (e) { lgaLayer.resetStyle(e.target); },
              // LGA click → open the detail drawer (only on the maps page)
              click: function (e) {
                if (typeof window.__openLgaDrawer !== 'function') return;
                if (document.body.getAttribute('data-page') !== 'maps') return;
                window.__openLgaDrawer(feature.properties.name, feature);
              },
            });
          },
        }).addTo(map);
        try { map.fitBounds(lgaLayer.getBounds(), { padding: [16, 16] }); } catch (_) {}

        // Service-point markers (clustered)
        if (services && opts.showServicePoints !== false && typeof L.markerClusterGroup === 'function') {
          var cluster = L.markerClusterGroup({
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            maxClusterRadius: 40,
            iconCreateFunction: function (c) {
              var n = c.getChildCount();
              // n is a Number from getChildCount() — safe to string-concat
              return L.divIcon({
                className: 'semphn-cluster',
                html: '<div class="semphn-cluster-pin">' + n + '</div>',
                iconSize: [34, 34],
              });
            },
          });
          (services.services || []).forEach(function (s) {
            var m = L.marker([s.lat, s.lng], { icon: semphnMarkerIcon(s.type) });
            var typeLabel = (SERVICE_STYLE[s.type] || {}).label || s.type;
            m.bindPopup(
              '<div style="font-family:Geist,system-ui,sans-serif;min-width:200px;">' +
                '<div style="font-size:0.68rem;font-weight:500;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.15rem;">' + escHtml(typeLabel) + '</div>' +
                '<div style="font-weight:600;font-size:0.96rem;color:#0A0A0A;margin-bottom:0.25rem;">' + escHtml(s.name) + '</div>' +
                '<div style="font-size:0.82rem;color:#4B5563;">' + escHtml(s.suburb || '') + '</div>' +
                (s.phone ? '<div style="font-family:Geist Mono,ui-monospace,monospace;font-size:0.78rem;color:#0A0A0A;margin-top:0.4rem;">' + escHtml(s.phone) + '</div>' : '') +
              '</div>'
            );
            cluster.addLayer(m);
          });
          cluster.addTo(map);
        }

        /* ── Build the mapApi that callers use to apply data layers ── */
        var mapApi = {
          map: map,
          lgaLayer: lgaLayer,
          extraLayers: [],   // point overlays, etc. — additive
          currentLegend: null,
          currentIndicator: null,
          currentDataWidget: null,
        };

        function removeLegend() {
          if (mapApi.currentLegend) { try { map.removeControl(mapApi.currentLegend); } catch (_) {} mapApi.currentLegend = null; }
        }
        function removeIndicator() {
          if (mapApi.currentIndicator) { try { map.removeControl(mapApi.currentIndicator); } catch (_) {} mapApi.currentIndicator = null; }
        }

        function applyChoropleth(w) {
          mapApi.currentDataWidget = w;
          var byLgaW = {};
          (w.data || []).forEach(function (d) { byLgaW[(d.label || '').trim()] = Number(d.value) || 0; });
          var values = Object.values(byLgaW);
          var minW = values.length ? Math.min.apply(null, values) : 0;
          var maxW = values.length ? Math.max.apply(null, values) : 1;
          if (minW === maxW) maxW = minW + 1;
          var rampW = function (v) {
            var t = Math.max(0, Math.min(1, (v - minW) / (maxW - minW)));
            if (t < 0.33)  return blendHex('#E5F4F0', '#82D9C4', t / 0.33);
            if (t < 0.66)  return blendHex('#82D9C4', '#04264E', (t - 0.33) / 0.33);
            return blendHex('#04264E', '#0A0A0A', (t - 0.66) / 0.34);
          };
          lgaLayer.eachLayer(function (lyr) {
            var name = lyr.feature.properties.name;
            var has = name in byLgaW;
            lyr.setStyle({
              fillColor:   has ? rampW(byLgaW[name]) : '#F3F4F6',
              weight:      w.highlight === name ? 2.5 : 1.25,
              color:       w.highlight === name ? '#0A0A0A' : '#FFFFFF',
              fillOpacity: has ? 0.85 : 0.35,
            });
            // Rebind tooltip with the new data
            var safeName = escHtml(name);
            var tt =
              '<div style="font-family:Geist,system-ui,sans-serif;min-width:140px;">' +
                '<div style="font-weight:600;font-size:0.95rem;color:#0A0A0A;">' + safeName + '</div>' +
                (has
                  ? '<div style="font-family:Geist Mono,ui-monospace,monospace;font-size:1.15rem;font-weight:600;color:#0A0A0A;margin-top:0.18rem;">' + escHtml(formatValue(byLgaW[name], w.unit)) + '</div>' +
                    '<div style="font-size:0.7rem;color:#6B7280;margin-top:0.2rem;">' + escHtml(w.unit_label || w.unit || '') + '</div>'
                  : '<div style="font-size:0.78rem;color:#9CA3AF;font-style:italic;margin-top:0.2rem;">no data</div>') +
              '</div>';
            lyr.unbindTooltip();
            lyr.bindTooltip(tt, { sticky: true, direction: 'top', offset: [0, -8], opacity: 0.96, className: 'wgt-leaflet-tt' });
          });
          // Replace legend
          removeLegend();
          var LegCtl = L.Control.extend({
            options: { position: 'bottomleft' },
            onAdd: function () {
              var d = L.DomUtil.create('div', 'semphn-leaflet-legend');
              d.innerHTML =
                '<div class="row"><span class="v">' + escHtml(formatValue(minW, w.unit)) + '</span>' +
                '<span class="bar"></span>' +
                '<span class="v">' + escHtml(formatValue(maxW, w.unit)) + '</span></div>' +
                '<div class="lbl">' + escHtml(w.unit_label || w.unit || w.title || '') + '</div>';
              return d;
            },
          });
          mapApi.currentLegend = new LegCtl();
          mapApi.currentLegend.addTo(map);
          // Replace indicator (top-left, below search)
          removeIndicator();
          var IndCtl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function () {
              var d = L.DomUtil.create('div', 'semphn-leaflet-indicator');
              d.innerHTML =
                '<span class="d"></span>' +
                '<span class="lab">' + escHtml(w.title || 'Data layer') + '</span>' +
                '<button type="button" title="Remove layer" aria-label="Remove layer">×</button>';
              var btn = d.querySelector('button');
              L.DomEvent.disableClickPropagation(d);
              L.DomEvent.on(btn, 'click', function () { mapApi.clearData(); });
              return d;
            },
          });
          mapApi.currentIndicator = new IndCtl();
          mapApi.currentIndicator.addTo(map);
        }

        function clearData() {
          mapApi.currentDataWidget = null;
          // Restore default tint + tooltip
          lgaLayer.eachLayer(function (lyr) {
            lyr.setStyle({ fillColor: '#82D9C4', fillOpacity: 0.16, weight: 1.5, color: '#04264E', opacity: 0.85 });
            var safeName = escHtml(lyr.feature.properties.name);
            var tt =
              '<div style="font-family:Geist,system-ui,sans-serif;padding:2px 4px;">' +
                '<div style="font-weight:600;font-size:0.92rem;color:#0A0A0A;">' + safeName + '</div>' +
                '<div style="font-size:0.74rem;color:#6B7280;margin-top:0.18rem;">type a metric in the chat to color this LGA</div>' +
              '</div>';
            lyr.unbindTooltip();
            lyr.bindTooltip(tt, { sticky: true, direction: 'top', offset: [0, -8], opacity: 0.96, className: 'wgt-leaflet-tt' });
          });
          removeLegend();
          removeIndicator();
          clearAllPoints();
        }

        /* ── Point overlays · cluster groups keyed by 'layerKey' so callers
         *    can add / remove independently (e.g. headspace layer vs hospitals
         *    layer). Multiple groups stack on the same map. ── */
        function makeServicePopup(s) {
          var typeLabel = (SERVICE_STYLE[s.type] || {}).label || s.type;
          return (
            '<div style="font-family:Geist,system-ui,sans-serif;min-width:200px;">' +
              '<div style="font-size:0.68rem;font-weight:500;color:#6B7280;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:0.15rem;">' + escHtml(typeLabel) + '</div>' +
              '<div style="font-weight:600;font-size:0.96rem;color:#0A0A0A;margin-bottom:0.25rem;">' + escHtml(s.name) + '</div>' +
              '<div style="font-size:0.82rem;color:#4B5563;">' + escHtml(s.suburb || '') + '</div>' +
              (s.beds ? '<div style="font-size:0.74rem;color:#6B7280;margin-top:0.25rem;">' + escHtml(s.beds + ' beds · ' + (s.tier || '')) + '</div>' : '') +
              (s.tier && !s.beds ? '<div style="font-size:0.74rem;color:#6B7280;margin-top:0.25rem;">' + escHtml(s.tier) + '</div>' : '') +
              (s.phone ? '<div style="font-family:Geist Mono,ui-monospace,monospace;font-size:0.78rem;color:#0A0A0A;margin-top:0.4rem;">' + escHtml(s.phone) + '</div>' : '') +
            '</div>'
          );
        }
        function clusterFor(layerKey) {
          var color = layerKey === 'headspace' ? '#55BFAF'
                    : layerKey === 'hospital'  ? '#E13D6F'
                    : layerKey === 'acchs'     ? '#0A0A0A'
                    : layerKey === 'gp'        ? '#4C86FF'
                    : layerKey === 'racf'      ? '#F5B100'
                    : layerKey === 'mh'        ? '#7C5BD9'
                    : layerKey === 'aod'       ? '#FF8A3D'
                    : '#04264E';
          return L.markerClusterGroup({
            showCoverageOnHover: false,
            spiderfyOnMaxZoom: true,
            maxClusterRadius: 36,
            iconCreateFunction: function (c) {
              var n = c.getChildCount();
              return L.divIcon({
                className: 'semphn-cluster',
                html: '<div class="semphn-cluster-pin" style="background:' + color + ';">' + n + '</div>',
                iconSize: [32, 32],
              });
            },
          });
        }
        mapApi.pointLayers = {};   // { 'headspace': cluster, ... }
        mapApi.applyPoints = function (types, opts) {
          opts = opts || {};
          if (typeof L.markerClusterGroup !== 'function') return Promise.resolve();
          var fit = opts.fit !== false;
          return loadSemphnServices().then(function (data) {
            (Array.isArray(types) ? types : [types]).forEach(function (t) {
              // Remove existing for this type so re-apply replaces cleanly
              if (mapApi.pointLayers[t]) {
                try { map.removeLayer(mapApi.pointLayers[t]); } catch (_) {}
              }
              var pts = (data.services || []).filter(function (s) { return s.type === t; });
              if (!pts.length) return;
              var cluster = clusterFor(t);
              pts.forEach(function (s) {
                var m = L.marker([s.lat, s.lng], { icon: semphnMarkerIcon(s.type) });
                m.bindPopup(makeServicePopup(s));
                // Click on marker → draw 2/5/10 km accessibility rings around it
                m.on('click', function () {
                  drawAccessibilityRings([s.lat, s.lng], s);
                });
                cluster.addLayer(m);
              });
              cluster.addTo(map);
              mapApi.pointLayers[t] = cluster;
            });
            // Fit bounds to combined layers (LGAs + point overlays) so users
            // see the whole catchment with the new points in view
            if (fit) {
              try {
                var b = lgaLayer.getBounds();
                Object.values(mapApi.pointLayers).forEach(function (c) { try { b.extend(c.getBounds()); } catch (_) {} });
                map.fitBounds(b, { padding: [24, 24] });
              } catch (_) {}
            }
            updateLayerLegend();
          });
        };
        mapApi.clearPoints = function (types) {
          (Array.isArray(types) ? types : [types]).forEach(function (t) {
            if (mapApi.pointLayers[t]) {
              try { map.removeLayer(mapApi.pointLayers[t]); } catch (_) {}
              delete mapApi.pointLayers[t];
            }
          });
          updateLayerLegend();
        };
        function clearAllPoints() {
          Object.keys(mapApi.pointLayers).forEach(function (t) {
            try { map.removeLayer(mapApi.pointLayers[t]); } catch (_) {}
          });
          mapApi.pointLayers = {};
          updateLayerLegend();
        }
        mapApi.clearAllPoints = clearAllPoints;

        /* Accessibility rings · 2 / 5 / 10 km circles around a service marker.
         * Click any service to see catchment radius; useful for "how far is the
         * nearest headspace?" type planning conversations. */
        var ringsGroup = null;
        function drawAccessibilityRings(latlng, service) {
          clearRings();
          var color = (SERVICE_STYLE[service.type] || {}).color || '#04264E';
          ringsGroup = L.layerGroup();
          [
            { km: 10, op: 0.06, w: 1, label: '10 km' },
            { km: 5,  op: 0.10, w: 1.3, label: '5 km' },
            { km: 2,  op: 0.16, w: 1.6, label: '2 km' },
          ].forEach(function (r) {
            L.circle(latlng, {
              radius: r.km * 1000,
              color: color, weight: r.w, opacity: 0.7,
              fillColor: color, fillOpacity: r.op,
              interactive: false,
            }).addTo(ringsGroup);
          });
          // Tiny labels at the right edge of each ring
          [10, 5, 2].forEach(function (km) {
            var lat = latlng[0];
            var lngOffset = (km / 111) / Math.cos(lat * Math.PI / 180);
            L.marker([lat, latlng[1] + lngOffset], {
              icon: L.divIcon({
                className: 'semphn-ring-label',
                html: km + ' km',
                iconSize: [42, 18],
                iconAnchor: [21, 9],
              }),
              interactive: false,
            }).addTo(ringsGroup);
          });
          ringsGroup.addTo(map);
          showToast('2 / 5 / 10 km from ' + (service.name || 'service'), 'success');
        }
        function clearRings() {
          if (ringsGroup) { try { map.removeLayer(ringsGroup); } catch (_) {} ringsGroup = null; }
        }
        mapApi.clearRings = clearRings;

        // Full reset · empty map state (used by the "Reset map" affordance)
        mapApi.reset = function () {
          clearData();
          clearAllPoints();
          clearRings();
        };

        /* Layer legend · top-left chip showing which point types are on */
        var layerLegendCtl = null;
        function updateLayerLegend() {
          if (layerLegendCtl) { try { map.removeControl(layerLegendCtl); } catch (_) {} layerLegendCtl = null; }
          var keys = Object.keys(mapApi.pointLayers);
          if (!keys.length) return;
          layerLegendCtl = L.control({ position: 'topright' });
          layerLegendCtl.onAdd = function () {
            var d = L.DomUtil.create('div', 'semphn-leaflet-layerlegend');
            var parts = ['<div class="hdr">On the map</div>'];
            keys.forEach(function (k) {
              var s = SERVICE_STYLE[k] || { color: '#666', label: k };
              var count = mapApi.pointLayers[k].getLayers().length;
              parts.push(
                '<div class="row" data-type="' + escHtml(k) + '">' +
                  '<span class="dot" style="background:' + s.color + ';"></span>' +
                  '<span class="lab">' + escHtml(s.plural || s.label) + '</span>' +
                  '<span class="ct">' + count + '</span>' +
                  '<button type="button" class="x" title="Remove layer" aria-label="Remove ' + escHtml(s.label) + ' layer">×</button>' +
                '</div>'
              );
            });
            d.innerHTML = parts.join('');
            L.DomEvent.disableClickPropagation(d);
            Array.prototype.forEach.call(d.querySelectorAll('.x'), function (btn) {
              var t = btn.parentElement.getAttribute('data-type');
              L.DomEvent.on(btn, 'click', function () { mapApi.clearPoints(t); });
            });
            return d;
          };
          layerLegendCtl.addTo(map);
        }

        mapApi.applyData = function (w) {
          if (!w) return;
          if (w.type === 'choropleth' || w.type === 'map') applyChoropleth(w);
          if (w.type === 'points' && Array.isArray(w.layers)) {
            mapApi.applyPoints(w.layers, { fit: w.fit !== false });
          }
        };
        mapApi.clearData = clearData;

        // If the initial mount was given a widget (choropleth tile use-case),
        // apply it now so the legend + indicator render via the same path.
        if (opts.mode === 'choropleth' && opts.widget) {
          applyChoropleth(opts.widget);
        }

        setTimeout(function () { try { map.invalidateSize(); } catch (_) {} }, 200);
        resolve(mapApi);
      }).catch(function (e) { reject(e); });
    });
  }
  window.__mountSemphnLeaflet = mountSemphnLeaflet;

  /* Choropleth widget · uses the shared mounter */
  function buildLeafletChoropleth(widget) {
    var wrap = document.createElement('div');
    wrap.className = 'wgt-leaflet-wrap';
    var mapDiv = document.createElement('div');
    mapDiv.className = 'wgt-leaflet';
    wrap.appendChild(mapDiv);
    setTimeout(function () {
      if (typeof window.L === 'undefined' || typeof L.markerClusterGroup === 'undefined') {
        var fallback = buildChoroplethSVG(widget);
        wrap.replaceChild(fallback, mapDiv);
        return;
      }
      mountSemphnLeaflet(mapDiv, {
        mode: 'choropleth', widget: widget,
        showSearch: true, showLocate: true, showLayerToggle: true, showServicePoints: true,
      }).catch(function (e) {
        console.error('[choropleth] mount failed', e);
        var fallback = buildChoroplethSVG(widget);
        wrap.replaceChild(fallback, mapDiv);
      });
    }, 0);
    return wrap;
  }

  /* Linear-blend two hex colors at t∈[0,1] */
  function blendHex(a, b, t) {
    function p(s) { return [parseInt(s.slice(1,3),16), parseInt(s.slice(3,5),16), parseInt(s.slice(5,7),16)]; }
    function h(n) { var s = Math.round(n).toString(16); return s.length === 1 ? '0'+s : s; }
    var ap = p(a), bp = p(b);
    return '#' + h(ap[0]+(bp[0]-ap[0])*t) + h(ap[1]+(bp[1]-ap[1])*t) + h(ap[2]+(bp[2]-ap[2])*t);
  }
  /* WCAG-ish: pick a text color (white or near-black) that contrasts a fill */
  function pickTextColor(hex) {
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    var lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.62 ? '#0A0A0A' : '#FFFFFF';
  }
  function buildChoroplethSVG(widget) {
    var w = 600, h = 380;
    var data = widget.data || [];
    var byLga = {};
    data.forEach(function (d) { byLga[(d.label || '').trim()] = Number(d.value) || 0; });
    var values = Object.values(byLga);
    var min = values.length ? Math.min.apply(null, values) : 0;
    var max = values.length ? Math.max.apply(null, values) : 1;
    if (min === max) max = min + 1;
    // Colour ramp: pale-teal → teal → navy → ink (matches SEMPHN palette)
    function rampColor(v) {
      var t = (v - min) / (max - min);
      if (t < 0.33)  return blendHex('#E5F4F0', '#82D9C4', t / 0.33);
      if (t < 0.66)  return blendHex('#82D9C4', '#04264E', (t - 0.33) / 0.33);
      return blendHex('#04264E', '#0A0A0A', (t - 0.66) / 0.34);
    }
    var svg = svgEl('svg', {
      viewBox: '0 0 ' + w + ' ' + h,
      class: 'wgt-svg wgt-choro',
      preserveAspectRatio: 'xMidYMid meet',
    });
    SEMPHN_LGA_TILES.forEach(function (lga) {
      var hasData = lga.name in byLga;
      var value   = byLga[lga.name];
      var fill    = hasData ? rampColor(value) : '#F9FAFB';
      var stroke  = hasData ? rampColor(value) : '#E5E7EB';
      var txt     = hasData ? pickTextColor(fill) : '#9CA3AF';
      var isHi    = widget.highlight && widget.highlight === lga.name;
      // Tile background
      var rect = svgEl('rect', {
        x: lga.x, y: lga.y, width: lga.w, height: lga.h,
        rx: '8', ry: '8',
        fill: fill,
        stroke: isHi ? '#0A0A0A' : '#FFFFFF',
        'stroke-width': isHi ? '2.5' : '2',
      });
      // Hover title
      var title = svgEl('title');
      title.textContent = lga.name + (hasData ? (' — ' + formatValue(value, widget.unit)) : ' — no data');
      rect.appendChild(title);
      svg.appendChild(rect);
      // LGA name
      var cx = lga.x + lga.w / 2;
      var cy = lga.y + lga.h / 2;
      var nameLbl = svgEl('text', {
        x: cx, y: cy - (hasData ? 6 : 0),
        'text-anchor': 'middle',
        'font-family': 'Geist, system-ui, sans-serif',
        'font-size': lga.w < 110 ? '10.5' : '11.5',
        'font-weight': '500',
        fill: txt,
      });
      nameLbl.textContent = lga.name;
      svg.appendChild(nameLbl);
      // Value
      if (hasData) {
        var vLbl = svgEl('text', {
          x: cx, y: cy + 14,
          'text-anchor': 'middle',
          'font-family': 'Geist Mono, ui-monospace, monospace',
          'font-size': isHi ? '15' : '13',
          'font-weight': isHi ? '700' : '600',
          fill: txt,
        });
        vLbl.textContent = formatValue(value, widget.unit);
        svg.appendChild(vLbl);
      }
    });
    // Footer note · cartogram disclaimer
    var note = svgEl('text', {
      x: w / 2, y: h - 8,
      'text-anchor': 'middle',
      'font-family': 'Geist, system-ui, sans-serif',
      'font-size': '9.5',
      fill: '#9CA3AF',
    });
    note.textContent = 'Stylised tile cartogram of the SEMPHN catchment · not surveyed-accurate';
    svg.appendChild(note);
    // Build a wrapper that includes a legend strip below the SVG
    var wrap = document.createElement('div');
    wrap.className = 'wgt-choro-wrap';
    wrap.appendChild(svg);
    var legend = document.createElement('div');
    legend.className = 'wgt-choro-legend';
    var lo = document.createElement('span'); lo.className = 'v'; lo.textContent = formatValue(min, widget.unit);
    var bar = document.createElement('span'); bar.className = 'bar';
    bar.style.background = 'linear-gradient(90deg, #E5F4F0, #82D9C4 35%, #04264E 78%, #0A0A0A)';
    var hi = document.createElement('span'); hi.className = 'v'; hi.textContent = formatValue(max, widget.unit);
    var note2 = document.createElement('span'); note2.className = 'unit'; note2.textContent = widget.unit_label || widget.unit || '';
    legend.appendChild(lo); legend.appendChild(bar); legend.appendChild(hi); legend.appendChild(note2);
    wrap.appendChild(legend);
    return wrap;
  }

  function buildBarChart(widget)  { return buildEchartsContainer(widget, barOption); }
  function buildLineChart(widget) { return buildEchartsContainer(widget, function (w) { return lineOption(w, { area: false }); }); }
  function buildAreaChart(widget) { return buildEchartsContainer(widget, function (w) { return lineOption(w, { area: true  }); }); }
  function buildDonutChart(widget){ return buildEchartsContainer(widget, donutOption); }

  /* Legacy SVG renderers preserved as a fallback when ECharts hasn't
   * loaded yet (rare — but failing soft beats a blank tile). */
  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function buildBarSVG(widget) {
    var data = widget.data || [];
    if (!data.length) return null;
    var w = 560, h = 280;
    var padL = 140, padR = 64, padT = 12, padB = 14;
    var values = data.map(function (d) { return Number(d.value) || 0; });
    var max = Math.max.apply(null, values);
    if (max <= 0) max = 1;
    var rows = data.length;
    var rowH = (h - padT - padB) / rows;
    var barH = Math.min(22, Math.max(10, rowH - 10));

    var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'wgt-svg' });

    // Vertical gridlines at 0/50/100% of max
    [0, 0.5, 1].forEach(function (pct) {
      var x = padL + pct * (w - padL - padR);
      var line = svgEl('line', {
        x1: x, x2: x, y1: padT - 4, y2: h - padB + 4,
        stroke: '#F3F4F6', 'stroke-width': '1',
      });
      svg.appendChild(line);
    });
    // Baseline
    var base = svgEl('line', {
      x1: padL, x2: padL, y1: padT - 4, y2: h - padB + 4,
      stroke: '#E5E7EB', 'stroke-width': '1',
    });
    svg.appendChild(base);

    data.forEach(function (d, i) {
      var rowY = padT + i * rowH;
      var y = rowY + (rowH - barH) / 2;
      var isHi = widget.highlight && d.label === widget.highlight;
      var fill = isHi ? '#55BFAF' : '#0A0A0A';

      // Row label
      var lbl = svgEl('text', {
        x: padL - 10, y: y + barH * 0.72,
        'text-anchor': 'end',
        'font-family': 'Geist, -apple-system, system-ui, sans-serif',
        'font-size': '11.5', 'font-weight': isHi ? '600' : '500',
        fill: isHi ? '#0A0A0A' : '#4B5563',
      });
      lbl.textContent = d.label || '';
      svg.appendChild(lbl);

      // Track background
      var track = svgEl('rect', {
        x: padL, y: y,
        width: w - padL - padR, height: barH,
        rx: '4', ry: '4',
        fill: '#F9FAFB',
      });
      svg.appendChild(track);

      // Bar
      var bw = (values[i] / max) * (w - padL - padR);
      var bar = svgEl('rect', {
        x: padL, y: y,
        width: Math.max(3, bw), height: barH,
        rx: '4', ry: '4',
        fill: fill,
      });
      svg.appendChild(bar);

      // Value label
      var vlbl = svgEl('text', {
        x: padL + bw + 7, y: y + barH * 0.72,
        'font-family': 'Geist Mono, ui-monospace, monospace',
        'font-size': '11', 'font-weight': '500',
        fill: '#0A0A0A',
      });
      vlbl.textContent = formatValue(d.value, widget.unit);
      svg.appendChild(vlbl);
    });
    return svg;
  }

  /* Build line chart · Figma-style
   * - smooth Catmull-Rom curve through points
   * - gradient area fill underneath (ink → transparent)
   * - 4px solid stroke, ink-colored
   * - circles + label for first/last, every Nth otherwise
   * - hairline horizontal gridlines, no left axis */
  function buildLineSVG(widget) {
    var data = widget.data || [];
    if (!data.length) return null;
    var w = 560, h = 260;
    var padL = 36, padR = 24, padT = 24, padB = 36;
    var values = data.map(function (d) { return Number(d.value) || 0; });
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    if (max === min) { max = min + 1; }
    // Pad domain by 10% so curve has breathing room
    var range = max - min;
    var yMin = min - range * 0.1, yMax = max + range * 0.1;
    var innerW = w - padL - padR, innerH = h - padT - padB;

    function x(i) { return padL + (i / (data.length - 1 || 1)) * innerW; }
    function y(v) { return padT + (1 - (v - yMin) / (yMax - yMin)) * innerH; }

    var svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, class: 'wgt-svg' });

    // <defs> with gradient for area fill
    var defs = svgEl('defs');
    var gradId = 'wgt-grad-' + Math.random().toString(36).slice(2, 8);
    var grad = svgEl('linearGradient', {
      id: gradId, x1: '0', y1: '0', x2: '0', y2: '1',
    });
    var s1 = svgEl('stop', { offset: '0%',  'stop-color': '#0A0A0A', 'stop-opacity': '0.14' });
    var s2 = svgEl('stop', { offset: '100%', 'stop-color': '#0A0A0A', 'stop-opacity': '0' });
    grad.appendChild(s1); grad.appendChild(s2); defs.appendChild(grad); svg.appendChild(defs);

    // 3 horizontal gridlines
    [0.25, 0.5, 0.75, 1].forEach(function (pct) {
      var gy = padT + pct * innerH;
      var line = svgEl('line', {
        x1: padL, x2: w - padR, y1: gy, y2: gy,
        stroke: '#F3F4F6', 'stroke-width': '1',
      });
      svg.appendChild(line);
    });

    // Build smooth Catmull-Rom → bezier path
    var pts = data.map(function (d, i) { return [x(i), y(values[i])]; });
    function smoothPath(pts) {
      if (pts.length < 2) return '';
      var d = 'M' + pts[0][0] + ',' + pts[0][1];
      for (var i = 0; i < pts.length - 1; i++) {
        var p0 = pts[i - 1] || pts[i];
        var p1 = pts[i];
        var p2 = pts[i + 1];
        var p3 = pts[i + 2] || p2;
        var cp1x = p1[0] + (p2[0] - p0[0]) / 6;
        var cp1y = p1[1] + (p2[1] - p0[1]) / 6;
        var cp2x = p2[0] - (p3[0] - p1[0]) / 6;
        var cp2y = p2[1] - (p3[1] - p1[1]) / 6;
        d += ' C' + cp1x + ',' + cp1y + ' ' + cp2x + ',' + cp2y + ' ' + p2[0] + ',' + p2[1];
      }
      return d;
    }
    var smoothD = smoothPath(pts);

    // Area fill
    if (smoothD) {
      var areaD = smoothD + ' L' + pts[pts.length - 1][0] + ',' + (h - padB) +
                  ' L' + pts[0][0] + ',' + (h - padB) + ' Z';
      var area = svgEl('path', { d: areaD, fill: 'url(#' + gradId + ')' });
      svg.appendChild(area);

      // Line
      var line = svgEl('path', {
        d: smoothD,
        fill: 'none',
        stroke: '#0A0A0A',
        'stroke-width': '2',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      });
      svg.appendChild(line);
    }

    // Data points · subtle dots at every point, larger at first + last
    data.forEach(function (d, i) {
      var isEnd = (i === 0 || i === data.length - 1);
      var dot = svgEl('circle', {
        cx: x(i), cy: y(values[i]),
        r: isEnd ? '5' : '3',
        fill: '#FFFFFF',
        stroke: '#0A0A0A',
        'stroke-width': isEnd ? '2' : '1.5',
      });
      svg.appendChild(dot);
      // X-axis label
      var xLbl = svgEl('text', {
        x: x(i), y: h - 12,
        'text-anchor': 'middle',
        'font-family': 'Geist, -apple-system, system-ui, sans-serif',
        'font-size': '10.5', 'font-weight': '500',
        fill: '#6B7280',
      });
      xLbl.textContent = d.label || '';
      svg.appendChild(xLbl);
    });

    return svg;
  }
  function formatValue(v, unit) {
    if (v == null) return '';
    var num = Number(v);
    if (Number.isNaN(num)) return String(v);
    var rounded;
    switch (unit) {
      case 'pct':       rounded = (num.toFixed(1) + '%'); break;
      case 'per_1k':    rounded = num.toFixed(1) + ' /1k'; break;
      case 'per_10k':   rounded = num.toFixed(1) + ' /10k'; break;
      case 'per_100k':  rounded = num.toFixed(1) + ' /100k'; break;
      case 'aud':       rounded = '$' + num.toLocaleString('en-AU', { maximumFractionDigits: 0 }); break;
      case 'count':     rounded = num.toLocaleString('en-AU'); break;
      default:          rounded = num.toLocaleString('en-AU', { maximumFractionDigits: 1 });
    }
    return rounded;
  }
  /* Hash a string → stable palette index (so the same KPI gets the
   * same colour every render, instead of cycling on each rebuild). */
  function paletteIndexFor(s) {
    var str = String(s || '');
    var h = 0;
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
    return Math.abs(h) % SEMPHN_PALETTE.length;
  }
  function buildKpiNode(widget) {
    var data = (widget.data || [])[0] || {};
    var idx = paletteIndexFor(widget.title || data.label || '');
    var colorSolid = SEMPHN_PALETTE[idx];
    var colorLight = SEMPHN_PALETTE_LIGHT[idx];

    var wrap = document.createElement('div'); wrap.className = 'wgt-kpi';
    wrap.style.setProperty('--kpi-color',       colorSolid);
    wrap.style.setProperty('--kpi-color-light', colorLight);
    // Colored accent stripe at the top of the value (left edge)
    var accent = document.createElement('span'); accent.className = 'wgt-kpi-accent';
    wrap.appendChild(accent);

    var v = document.createElement('div'); v.className = 'v';
    v.textContent = formatValue(data.value, widget.unit);

    var d = document.createElement('div'); d.className = 'd';
    if (widget.delta) {
      var down = String(widget.delta).startsWith('-');
      var dchip = document.createElement('span'); dchip.className = 'delta ' + (down ? 'down' : 'up');
      dchip.textContent = widget.delta;
      d.appendChild(dchip);
    }
    if (data.label) {
      var lbl = document.createElement('span'); lbl.className = 'l';
      lbl.textContent = data.label;
      d.appendChild(lbl);
    }
    wrap.appendChild(v); wrap.appendChild(d);
    return wrap;
  }
  function buildTableNode(widget) {
    var rows = widget.data || [];
    if (!rows.length) return null;
    var cols = Object.keys(rows[0]);
    var tbl = document.createElement('table'); tbl.className = 'wgt-table';
    var thead = document.createElement('thead'); var trh = document.createElement('tr');
    cols.forEach(function (c) { var th = document.createElement('th'); th.textContent = c; trh.appendChild(th); });
    thead.appendChild(trh); tbl.appendChild(thead);
    var tbody = document.createElement('tbody');
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      cols.forEach(function (c) {
        var td = document.createElement('td'); var val = r[c];
        if (typeof val === 'number') { td.className = 'num'; td.textContent = formatValue(val, widget.unit); }
        else { td.textContent = val == null ? '' : String(val); }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    return tbl;
  }

  function buildWidgetCard(widget, callbacks) {
    callbacks = callbacks || {};
    var card = document.createElement('div'); card.className = 'wgt-card wgt-type-' + (widget.type || 'unknown');
    card.setAttribute('draggable', 'true');
    // Size hint · widget.size override OR derived from type.
    //   sm  → compact (KPI)
    //   md  → default flex item (bar/line/donut/area)
    //   lg  → full-row span (choropleth/table)
    var size = widget.size || (
      widget.type === 'kpi' ? 'sm' :
      (widget.type === 'choropleth' || widget.type === 'map' || widget.type === 'table') ? 'lg' :
      'md'
    );
    card.setAttribute('data-size', size);

    // Head
    var head = document.createElement('div'); head.className = 'wgt-head';
    var title = document.createElement('div'); title.className = 'wgt-title';
    var t = document.createElement('div'); t.className = 'wgt-t'; t.textContent = widget.title || 'Untitled widget';
    var s = document.createElement('div'); s.className = 'wgt-s'; s.textContent = widget.subtitle || '';
    title.appendChild(t); if (widget.subtitle) title.appendChild(s);

    // Inline rename · click the title to edit, blur or Enter to save
    if (callbacks.onRename) {
      t.title = 'Click to rename';
      t.addEventListener('click', function () {
        t.contentEditable = 'true';
        t.classList.add('is-editing');
        t.focus();
        document.execCommand('selectAll', false, null);
      });
      var commitRename = function () {
        t.contentEditable = 'false';
        t.classList.remove('is-editing');
        var v = (t.textContent || '').trim();
        if (v && v !== widget.title) callbacks.onRename(v);
        else t.textContent = widget.title || 'Untitled widget';
      };
      t.addEventListener('blur', commitRename);
      t.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); t.blur(); }
        if (e.key === 'Escape') { t.textContent = widget.title || 'Untitled widget'; t.blur(); }
      });
    }

    var actions = document.createElement('div'); actions.className = 'wgt-actions';
    // Kebab menu · rename / export PNG / copy CSV / duplicate / delete
    var kebab = document.createElement('button');
    kebab.type = 'button';
    kebab.title = 'Widget actions';
    kebab.setAttribute('aria-label', 'Widget actions');
    kebab.className = 'wgt-kebab';
    kebab.textContent = '⋯';
    kebab.addEventListener('click', function (e) {
      e.stopPropagation();
      openKebabMenu(card, widget, callbacks, kebab);
    });
    actions.appendChild(kebab);

    head.appendChild(title); head.appendChild(actions);
    card.appendChild(head);

    // Body — dispatch by type
    var body = document.createElement('div'); body.className = 'wgt-body';
    var node = null;
    if      (widget.type === 'bar')   node = buildBarChart(widget);
    else if (widget.type === 'line')  node = buildLineChart(widget);
    else if (widget.type === 'area')  node = buildAreaChart(widget);
    else if (widget.type === 'donut' || widget.type === 'pie') node = buildDonutChart(widget);
    else if (widget.type === 'kpi')   node = buildKpiNode(widget);
    else if (widget.type === 'table') node = buildTableNode(widget);
    else if (widget.type === 'choropleth' || widget.type === 'map') node = buildLeafletChoropleth(widget);
    else if (widget.type === 'cartogram') node = buildChoroplethSVG(widget);
    if (!node) {
      node = document.createElement('div');
      node.className = 'wgt-empty';
      node.textContent = 'Unable to render widget of type "' + (widget.type || '?') + '".';
    }
    body.appendChild(node);
    card.appendChild(body);

    // Foot
    if (widget.source_id) {
      var foot = document.createElement('div'); foot.className = 'wgt-foot';
      foot.textContent = 'Source · ' + widget.source_id;
      card.appendChild(foot);
    }
    return card;
  }

  /* Kebab menu · Rename / Export PNG / Copy CSV / Edit JSON / Duplicate / Delete */
  function openKebabMenu(card, widget, callbacks, anchor) {
    closeKebabMenu();
    var rect = anchor.getBoundingClientRect();
    var menu = document.createElement('div');
    menu.className = 'wgt-menu';
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = (rect.right - 200) + 'px';
    function item(label, handler, opt) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wgt-menu-item' + (opt && opt.danger ? ' is-danger' : '');
      b.textContent = label;
      b.addEventListener('click', function () { closeKebabMenu(); handler(); });
      menu.appendChild(b);
    }
    if (callbacks.onRename) item('Rename', function () {
      var t = card.querySelector('.wgt-t');
      if (t) { t.contentEditable = 'true'; t.classList.add('is-editing'); t.focus(); document.execCommand('selectAll', false, null); }
    });
    item('Copy data as CSV', function () { copyWidgetCSV(widget); });
    item('Export as PNG',    function () { exportWidgetPNG(card, widget); });
    item('Copy widget JSON', function () {
      navigator.clipboard.writeText(JSON.stringify(widget, null, 2))
        .then(function () { showToast('Widget JSON copied', 'success'); })
        .catch(function () { showToast('Clipboard blocked — try again', 'error'); });
    });
    // Add-to-HNA bridge · sends the widget into a chosen chapter as an inline
    // figure. Only meaningful on the Dashboards page (Maps' charts also benefit).
    if (window.__HNA_CHAPTERS) {
      var sepHna = document.createElement('div'); sepHna.className = 'wgt-menu-sep'; menu.appendChild(sepHna);
      var label = document.createElement('div');
      label.className = 'wgt-menu-label';
      label.textContent = 'Add to HNA chapter';
      menu.appendChild(label);
      Object.keys(window.__HNA_CHAPTERS).forEach(function (key) {
        var ch = window.__HNA_CHAPTERS[key];
        var titleClean = ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '');
        item('Ch ' + ch.num + ' · ' + titleClean, function () {
          addWidgetToHnaChapter(widget, key);
        });
      });
    }
    var sep = document.createElement('div'); sep.className = 'wgt-menu-sep'; menu.appendChild(sep);
    if (callbacks.onDuplicate) item('Duplicate', callbacks.onDuplicate);
    if (callbacks.onDelete)    item('Delete',    callbacks.onDelete, { danger: true });
    document.body.appendChild(menu);
    setTimeout(function () {
      document.addEventListener('click', closeKebabMenu, { once: true });
    }, 0);
  }
  function closeKebabMenu() {
    var m = document.querySelector('.wgt-menu');
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }
  /* CSV serializer · handles bar/line/donut (label,value), table (column keys),
   * kpi (label,value,delta) */
  function copyWidgetCSV(widget) {
    var rows = [];
    var data = widget.data || [];
    if (widget.type === 'table' && data.length) {
      var cols = Object.keys(data[0]);
      rows.push(cols.map(csvCell).join(','));
      data.forEach(function (r) { rows.push(cols.map(function (c) { return csvCell(r[c]); }).join(',')); });
    } else if (data.length) {
      rows.push('label,value');
      data.forEach(function (d) { rows.push(csvCell(d.label) + ',' + csvCell(d.value)); });
    } else {
      showToast('No data to copy', 'warn'); return;
    }
    navigator.clipboard.writeText(rows.join('\n'))
      .then(function () { showToast('Copied ' + (rows.length - 1) + ' rows as CSV', 'success'); })
      .catch(function () { showToast('Clipboard blocked — try again', 'error'); });
  }
  function csvCell(v) {
    if (v == null) return '';
    var s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  /* Export widget as PNG · uses ECharts.getDataURL for charts, SVG → PNG via
   * canvas for choropleth, html-to-image fallback would be needed for kpi/table
   * (left as a 'screenshot the card' toast for those types) */
  function exportWidgetPNG(card, widget) {
    var chartType = ['bar','line','area','donut','pie'].indexOf(widget.type) >= 0;
    if (chartType) {
      // Find the ECharts instance attached to this card and dump it
      var div = card.querySelector('.wgt-chart');
      if (div && window.echarts) {
        var inst = window.echarts.getInstanceByDom(div);
        if (inst) {
          var url = inst.getDataURL({ pixelRatio: 2, backgroundColor: '#FFFFFF' });
          downloadDataUrl(url, slug(widget.title) + '.png');
          showToast('PNG downloaded', 'success'); return;
        }
      }
    }
    if (widget.type === 'cartogram') {
      var svg = card.querySelector('svg.wgt-choro');
      if (svg) {
        svgToPng(svg, slug(widget.title) + '.png', function (ok) {
          if (ok) showToast('PNG downloaded', 'success');
          else    showToast('PNG export failed', 'error');
        });
        return;
      }
    }
    if (widget.type === 'choropleth' || widget.type === 'map') {
      // Leaflet tile maps can't be exported via canvas due to cross-origin
      // tile policy. Best UX: tell the user + suggest the OS screenshot.
      showToast('Use ⌘⇧4 to screenshot Leaflet maps — tile servers block canvas export', 'warn');
      return;
    }
    showToast('PNG export not supported for "' + widget.type + '" yet', 'warn');
  }
  function downloadDataUrl(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  function slug(s) {
    return String(s || 'widget').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  }
  function svgToPng(svg, name, cb) {
    try {
      var xml = new XMLSerializer().serializeToString(svg);
      var encoded = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement('canvas');
        var bb = svg.getBoundingClientRect();
        canvas.width = bb.width * 2; canvas.height = bb.height * 2;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        downloadDataUrl(canvas.toDataURL('image/png'), name);
        cb(true);
      };
      img.onerror = function () { cb(false); };
      img.src = encoded;
    } catch (e) { console.error(e); cb(false); }
  }

  /* Drag-to-reorder · native HTML5 DnD on widget cards */
  var DRAG_STATE = { fromIdx: -1, page: null };
  function attachDragHandlers(card, idx, page) {
    card.addEventListener('dragstart', function (e) {
      DRAG_STATE.fromIdx = idx;
      DRAG_STATE.page = page;
      card.classList.add('is-dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
    });
    card.addEventListener('dragend', function () {
      card.classList.remove('is-dragging');
      document.querySelectorAll('.wgt-card.is-drag-over').forEach(function (el) { el.classList.remove('is-drag-over'); });
    });
    card.addEventListener('dragover', function (e) {
      if (DRAG_STATE.fromIdx < 0) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      card.classList.add('is-drag-over');
    });
    card.addEventListener('dragleave', function () { card.classList.remove('is-drag-over'); });
    card.addEventListener('drop', function (e) {
      e.preventDefault();
      card.classList.remove('is-drag-over');
      var fromIdx = DRAG_STATE.fromIdx;
      var toIdx = idx;
      if (fromIdx < 0 || fromIdx === toIdx || DRAG_STATE.page !== page) return;
      var arr = readWidgets(page);
      var item = arr.splice(fromIdx, 1)[0];
      arr.splice(toIdx, 0, item);
      writeWidgets(page, arr);
      DRAG_STATE.fromIdx = -1;
      renderWidgets();
      showToast('Widget reordered', 'success');
    });
  }

  function renderWidgets() {
    var grid = document.getElementById('widget-grid');
    if (!grid) return;
    var page = pageId();
    // Dispose existing ECharts instances before re-render so we don't leak.
    ECHARTS_INSTANCES.forEach(function (c) { try { c.dispose(); } catch (_) {} });
    ECHARTS_INSTANCES = [];
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    var widgets = readWidgets(page);
    var empty = document.getElementById('widget-empty');
    if (empty) empty.hidden = widgets.length > 0;
    var countEl = document.getElementById('widget-count');
    if (countEl) countEl.textContent = widgets.length + (widgets.length === 1 ? ' widget' : ' widgets');
    // Insert AI commentary banner on Dashboards when ≥3 widgets present
    if (page === 'dashboards' && widgets.length >= 3) {
      var banner = buildDashboardCommentary(widgets);
      if (banner) grid.appendChild(banner);
    }
    widgets.forEach(function (w, idx) {
      try {
        var card = buildWidgetCard(w, {
          onDelete: function () {
            var arr = readWidgets(page);
            arr.splice(idx, 1);
            writeWidgets(page, arr);
            renderWidgets();
            showToast('Widget removed', 'success');
          },
          onDuplicate: function () {
            var arr = readWidgets(page);
            var clone = JSON.parse(JSON.stringify(w));
            clone.title = (w.title || 'Untitled') + ' (copy)';
            arr.splice(idx + 1, 0, clone);
            writeWidgets(page, arr);
            renderWidgets();
            showToast('Widget duplicated', 'success');
          },
          onRename: function (newTitle) {
            var arr = readWidgets(page);
            if (!arr[idx]) return;
            arr[idx].title = newTitle;
            writeWidgets(page, arr);
            showToast('Renamed', 'success');
          },
        });
        if (!card) { console.error('[widget] buildWidgetCard returned null', idx, w); return; }
        attachDragHandlers(card, idx, page);
        grid.appendChild(card);
      } catch (e) {
        console.error('[widget] failed to render widget', idx, e, w);
      }
    });
  }
  /* Build a synthesized commentary banner for the current dashboard.
   * Inspects the widget set + their highlighted values to produce a
   * one-paragraph "what this dashboard says" summary. Deterministic
   * (no AI call) so it loads instantly. */
  function buildDashboardCommentary(widgets) {
    if (!widgets || widgets.length < 3) return null;
    // Detect topic from titles
    var titles = widgets.map(function (w) { return (w.title || '') + ' ' + (w.subtitle || ''); }).join(' · ').toLowerCase();
    var topic;
    if (titles.match(/mental|mh|headspace|polar.*mh/)) topic = 'mental health';
    else if (titles.match(/first nations|irseo|achs|sewb/)) topic = 'First Nations';
    else if (titles.match(/aged|65\+|racf|dementia/)) topic = 'older people';
    else if (titles.match(/homeless|shs|housing/)) topic = 'homelessness';
    else if (titles.match(/diabet|chronic|acsc/)) topic = 'chronic disease';
    else if (titles.match(/gp|workforce|allied|ahpra/)) topic = 'workforce';
    else if (titles.match(/aod|alcohol|methamph|drug/)) topic = 'AOD';
    else if (titles.match(/cald|lote|humanitarian|interpreter/)) topic = 'CALD communities';
    else if (titles.match(/bowel|screen|nbcsp/)) topic = 'screening';
    else if (titles.match(/youth|0-17|5-17|school/)) topic = 'youth services';
    else topic = 'this catchment';

    // Pick the most striking bar-chart highlight as the headline finding
    var bar = widgets.find(function (w) { return w.type === 'bar' && w.highlight && w.data && w.data.length; });
    var headline = '';
    if (bar) {
      var hi = bar.data.find(function (d) { return d.label === bar.highlight; }) || bar.data[0];
      if (hi) {
        var unit = bar.unit === 'pct' ? '%' :
                   bar.unit === 'per_1k' ? '/1k' :
                   bar.unit === 'per_10k' ? '/10k' :
                   bar.unit === 'per_100k' ? '/100k' : '';
        headline = '<strong>' + escHtml(hi.label) + '</strong> stands out at <strong>' + hi.value + unit + '</strong> on ' + escHtml(bar.title || 'the headline metric') + '. ';
      }
    }
    // Pick the most striking KPI
    var kpi = widgets.find(function (w) { return w.type === 'kpi' && w.data && w.data.length; });
    var kpiText = '';
    if (kpi) {
      kpiText = 'The headline catchment number is <strong>' + escHtml(String(kpi.data[0].value)) + '</strong> for ' + escHtml(kpi.title || 'the catchment KPI') + (kpi.delta ? ' (' + escHtml(kpi.delta) + ')' : '') + '. ';
    }
    var counts = widgets.reduce(function (m, w) { m[w.type] = (m[w.type] || 0) + 1; return m; }, {});
    var mix = Object.keys(counts).map(function (k) { return counts[k] + ' ' + k; }).join(', ');

    var wrap = document.createElement('div');
    wrap.className = 'wgt-card wgt-commentary';
    wrap.setAttribute('data-size', 'lg');
    wrap.innerHTML =
      '<div class="wgt-com-head">' +
        '<span class="wgt-com-badge">Dashboard summary</span>' +
        '<span class="wgt-com-meta">' + escHtml(mix) + ' · auto-synthesised</span>' +
      '</div>' +
      '<p class="wgt-com-body">This ' + escHtml(String(widgets.length)) + '-tile dashboard frames the SEMPHN catchment view of <strong>' + escHtml(topic) + '</strong>. ' + headline + kpiText + 'Use the kebab on any tile → <em>Add to HNA chapter</em> to pull a tile into your narrative.</p>';
    return wrap;
  }

  function addWidget(widget) {
    console.log('[widget] addWidget called with', widget);
    if (!widget) { console.warn('[widget] addWidget called with null/undefined'); return; }
    var page = pageId();
    var arr = readWidgets(page);
    arr.push(widget);
    writeWidgets(page, arr);
    renderWidgets();
    showToast('Widget added to dashboard', 'success');
  }
  // Expose for the chat handler to call after extracting from reply
  window.__addWidget = addWidget;
  window.__renderWidgets = renderWidgets;
  window.__extractWidget  = extractWidget;
  window.__extractWidgets = extractWidgets;
  // For HNA to render in-doc charts using the dashboard renderer
  window.__buildWidgetNode = function (widget) {
    return buildWidgetCard(widget, {});
  };

  /* ============================================================
   * HNA · chat-edits-the-doc
   *
   * `paragraph` widgets emitted on the /hna/ page are appended to the
   * current chapter doc with a teal left-border highlight + AI badge.
   * Persisted to localStorage so refresh keeps them.
   *
   * Widget shape:
   *   { type: "paragraph", title: "...", heading: "<optional h2>",
   *     text: "<paragraph text · plain or with <strong>>",
   *     position: "end" }
   * ============================================================ */
  var HNA_EDITS_KEY_BASE = 'semphn.hna.edits.v1';
  function HNA_EDITS_KEY() { return uKey(HNA_EDITS_KEY_BASE); }
  function readHnaEdits() {
    try { return JSON.parse(localStorage.getItem(HNA_EDITS_KEY()) || '[]'); }
    catch (_) { return []; }
  }
  function writeHnaEdits(arr) {
    try { localStorage.setItem(HNA_EDITS_KEY(), JSON.stringify(arr)); }
    catch (_) {}
  }

  /* Safe HTML for paragraph text · strip tags except <strong>/<em>.
   * Defense in depth — paragraph text comes from the model.
   * Inline (source_id) tokens become clickable links to the sources list. */
  function sanitiseParagraphHtml(html) {
    if (!html) return '';
    // Allowlist <strong> and <em>; escape everything else.
    var tmp = document.createElement('div');
    tmp.textContent = String(html);
    var escaped = tmp.innerHTML;
    return escaped
      .replace(/&lt;(strong|em|b|i)&gt;/gi, function (_, t) { return '<' + t.toLowerCase() + '>'; })
      .replace(/&lt;\/(strong|em|b|i)&gt;/gi, function (_, t) { return '</' + t.toLowerCase() + '>'; });
  }

  /* Linkify inline (source_id) citations in a rendered paragraph.
   * Pattern: (lowercase_snake_case) where snake_case matches SOURCE_LABELS.
   * Replaces with a clickable .hna-cite that scrolls to the sources list and
   * highlights the matching row. */
  function linkifyCitations(rootEl) {
    if (!rootEl) return;
    var rx = /\(([a-z][a-z0-9_]{3,})\)/g;
    var nodes = [];
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    var n; while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (tn) {
      var s = tn.nodeValue;
      if (!rx.test(s)) return;
      rx.lastIndex = 0;
      var frag = document.createDocumentFragment();
      var last = 0, m;
      while ((m = rx.exec(s))) {
        var id = m[1];
        if (!SOURCE_LABELS[id]) continue;
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        var a = document.createElement('a');
        a.className = 'hna-cite';
        a.href = '#src-' + id;
        a.textContent = '(' + id + ')';
        a.title = SOURCE_LABELS[id];
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var target = document.querySelector('[data-src-id="' + id + '"]');
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.classList.add('is-highlight');
            setTimeout(function () { target.classList.remove('is-highlight'); }, 1800);
          }
        });
        frag.appendChild(a);
        last = m.index + m[0].length;
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      if (frag.childNodes.length > 0 && tn.parentNode) {
        tn.parentNode.replaceChild(frag, tn);
      }
    });
  }

  function buildHnaEditNode(edit, index) {
    var wrap = document.createElement('div');
    wrap.className = 'hna-ai-edit-wrap';
    wrap.setAttribute('data-edit-index', String(index));

    // Chart/figure widget · render the same way Dashboards renders widgets
    // but framed as a chapter-figure with a caption.
    if (edit.widget) {
      var fig = document.createElement('figure');
      fig.className = 'hna-figure';
      if (edit.heading) {
        var fcap = document.createElement('h2');
        fcap.textContent = edit.heading;
        wrap.appendChild(fcap);
      }
      var holder = document.createElement('div');
      holder.className = 'hna-figure-body';
      // Re-use the dashboard widget builder if available
      if (typeof window.__buildWidgetNode === 'function') {
        try {
          var node = window.__buildWidgetNode(edit.widget);
          if (node) holder.appendChild(node);
        } catch (e) {
          holder.textContent = '(chart render failed)';
        }
      } else {
        holder.textContent = '(chart support loading…)';
      }
      fig.appendChild(holder);
      if (edit.text) {
        var caption = document.createElement('figcaption');
        caption.innerHTML = sanitiseParagraphHtml(edit.text);
        fig.appendChild(caption);
      }
      wrap.appendChild(fig);
    } else {
      // Standard paragraph widget
      if (edit.heading) {
        var h = document.createElement('h2');
        h.textContent = edit.heading;
        wrap.appendChild(h);
      }
      var p = document.createElement('p');
      p.className = 'hna-ai-edit';
      p.innerHTML = sanitiseParagraphHtml(edit.text || '');
      wrap.appendChild(p);
    }

    // Actions bar
    var bar = document.createElement('div');
    bar.className = 'hna-ai-edit-actions';
    function btn(label, opts, handler) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (opts && opts.danger) b.className = 'danger';
      if (opts && opts.subtle) b.className = (b.className || '') + ' subtle';
      b.addEventListener('click', handler);
      bar.appendChild(b);
    }
    // Reorder up/down · only meaningful when there are multiple edits in
    // this chapter
    var slug = currentChapterSlug();
    var allEdits = readHnaEdits();
    var sameChapterIndices = allEdits
      .map(function (e, i) { return { e: e, i: i }; })
      .filter(function (x) { return (x.e.chapter || DEFAULT_HNA_CHAPTER) === slug; });
    var posInChapter = sameChapterIndices.findIndex(function (x) { return x.i === index; });
    if (sameChapterIndices.length > 1) {
      if (posInChapter > 0) {
        btn('↑', { subtle: true }, function () {
          var arr = readHnaEdits();
          var swapIdx = sameChapterIndices[posInChapter - 1].i;
          var tmp = arr[swapIdx]; arr[swapIdx] = arr[index]; arr[index] = tmp;
          writeHnaEdits(arr);
          renderHnaEdits();
        });
        bar.lastChild.title = 'Move up';
      }
      if (posInChapter < sameChapterIndices.length - 1) {
        btn('↓', { subtle: true }, function () {
          var arr = readHnaEdits();
          var swapIdx = sameChapterIndices[posInChapter + 1].i;
          var tmp = arr[swapIdx]; arr[swapIdx] = arr[index]; arr[index] = tmp;
          writeHnaEdits(arr);
          renderHnaEdits();
        });
        bar.lastChild.title = 'Move down';
      }
    }
    btn('Keep', {}, function () {
      var p = wrap.querySelector('.hna-ai-edit');
      if (p) p.classList.remove('hna-ai-edit');
      bar.remove();
      var arr = readHnaEdits();
      if (arr[index]) { arr[index].accepted = true; writeHnaEdits(arr); }
      showToast('Kept · added to chapter', 'success');
      // Re-render so the chapter guide recomputes its state
      renderChapterGuide();
    });
    // Inline edit · only for paragraph widgets, not charts
    if (!edit.widget) {
      btn('Edit', { subtle: true }, function () {
        var p = wrap.querySelector('.hna-ai-edit') || wrap.querySelector('p');
        if (!p) return;
        var original = p.innerHTML;
        // Replace the paragraph with a textarea + Save/Cancel
        var ta = document.createElement('textarea');
        ta.className = 'hna-edit-textarea';
        ta.value = p.textContent || '';
        ta.rows = Math.min(8, Math.max(3, (ta.value.match(/\n/g) || []).length + 3));
        p.replaceWith(ta);
        bar.innerHTML = '';
        var saveBtn = document.createElement('button');
        saveBtn.type = 'button'; saveBtn.textContent = 'Save';
        saveBtn.className = 'primary';
        saveBtn.addEventListener('click', function () {
          var arr = readHnaEdits();
          if (arr[index]) {
            arr[index].text = ta.value.trim();
            writeHnaEdits(arr);
          }
          renderHnaEdits();
          showToast('Paragraph updated', 'success');
        });
        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button'; cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'subtle';
        cancelBtn.addEventListener('click', function () { renderHnaEdits(); });
        bar.appendChild(saveBtn); bar.appendChild(cancelBtn);
        ta.focus();
        ta.selectionStart = 0;
        ta.selectionEnd = ta.value.length;
      });
      btn('Rewrite', { subtle: true }, function () {
        var input = document.getElementById('chat-input');
        var send  = document.getElementById('chat-send');
        if (!input) return;
        input.value = 'Rewrite this paragraph in a tighter, more agency-centred voice — same figures, same length: "' +
          (edit.text || '').replace(/"/g, '\\"') + '". New paragraph, replace.';
        input.dispatchEvent(new Event('input'));
        input.focus();
      });
    }
    btn('Discard', { danger: true }, function () {
      var arr = readHnaEdits();
      arr.splice(index, 1);
      writeHnaEdits(arr);
      renderHnaEdits();
      showToast('Removed from chapter', 'success');
    });
    wrap.appendChild(bar);
    return wrap;
  }

  /* ============================================================
   * HNA chapters · 12 chapters (5 fleshed + 7 stubs)
   *
   * Each chapter is keyed by slug, with a deck (intro), one or more
   * sections (h2 + body), a target word count for the DoH lodgement,
   * a list of DoH-rubric checks (substring → must appear in seed or
   * accepted AI edits to pass), and the bundled source_ids.
   * ============================================================ */
  var HNA_CHAPTERS = {
    '01-introduction': {
      num: '01', title: 'About <em>this assessment</em>', subtitle: 'Methodology + frameworks',
      target_words: 600,
      sources: ['semphn_hna_2025_28', 'doh_rubric_2024'],
      rubric: ['methodology', 'triangulation', 'priority'],
      deck: 'This annual update to the South Eastern Melbourne PHN <strong>Health Needs Assessment 2025-28</strong> uses three frameworks to identify what should rise to a commissioned response: Bradshaw\'s Taxonomy of Need, the Dahlgren-Whitehead model of social determinants, and the DoH PHN Performance Rubric triangulation matrix.',
      sections: [
        { heading: 'Frameworks · Bradshaw + Dahlgren-Whitehead',
          body: 'Bradshaw distinguishes <strong>normative</strong>, <strong>felt</strong>, <strong>expressed</strong>, and <strong>comparative</strong> need — we triangulate all four. Dahlgren-Whitehead foregrounds the social and structural determinants behind clinical metrics; we layer those onto every priority population chapter rather than treating SDOH as a standalone topic.' },
        { heading: 'How priorities surface',
          body: 'A finding is escalated to <span class="chip">priority</span> when it meets at least two of three tests: well above Victorian average, concentrated in our <strong>most-disadvantaged corridor</strong> (Gr Dandenong → Casey → Cardinia), and addressable by primary or community care within the funding envelope.' },
      ],
    },
    '02-region': {
      num: '02', title: 'The <em>SEMPHN catchment</em>', subtitle: 'Regional overview',
      target_words: 800,
      sources: ['abs_erp_2024', 'abs_seifa_2021', 'semphn_hna_2025_28'],
      rubric: ['10 lga', '1.6', 'growth', 'seifa'],
      deck: 'The SEMPHN catchment covers <strong>10 LGAs</strong> and serves <strong>1,638,200 residents</strong> — <strong>24.3% of Victoria\'s population</strong> — across an arc from Port Phillip Bay to the Mornington Peninsula and east to Cardinia. Population is projected to reach <strong>2.0M by 2030</strong> on the back of growth-corridor expansion in Casey (+3.4% pa) and Cardinia (+3.2% pa).',
      sections: [
        { heading: 'The 10 LGAs',
          body: 'Bayside, Cardinia, Casey, Frankston, Glen Eira, Greater Dandenong, Kingston, Mornington Peninsula, Port Phillip, Stonnington. The most-disadvantaged LGA is Greater Dandenong (<strong>SEIFA decile 2</strong>); the most-affluent are Stonnington and Bayside (both decile 10). This 8-decile spread is wider than most Victorian PHNs.' },
        { heading: 'Population pressure',
          body: '<span class="chip">Casey 393,000</span> is the catchment\'s largest LGA — bigger than the Cities of Hobart and Darwin combined. The Cardinia + Casey growth corridor accounts for ~80% of forecast 5-year growth, with implications for GP supply, MH services, and aged-care planning.' },
      ],
    },
    '03-cald': {
      num: '03', title: 'CALD <em>communities</em>', subtitle: 'Priority population',
      target_words: 1400,
      sources: ['abs_census_2021_lote', 'dss_scv_2025', 'tis_2024'],
      rubric: ['LOTE', 'humanitarian', 'interpreter'],
      deck: 'CALD is the catchment\'s defining feature: <strong>38.4% of residents speak a language other than English at home</strong> — a +4.6pp rise since 2016. The concentration is east, with <span class="chip">Greater Dandenong 64.2%</span> the highest LOTE rate in Victoria. By 2030 the catchment\'s CALD share is projected to exceed 45% (abs_census_2021_lote).',
      sections: [
        { heading: 'Multilingual hub · Greater Dandenong',
          body: 'Greater Dandenong\'s top 6 ancestries (Indian 18% · Vietnamese 14% · Afghan 9% · Sri Lankan 8% · Cambodian 6% · Chinese 6%) shape primary-care demand, vaccination uptake, and bowel-screening barriers. <strong>Casey 42.8%</strong> follows as the second-most-multilingual LGA, driven by recent humanitarian arrivals and the growth corridor (abs_census_2021).' },
        { heading: 'Humanitarian arrivals · 3,840 in 3 years',
          body: '<strong>3,840 humanitarian visa holders</strong> settled in the catchment 2022-2025, <strong>72% to Greater Dandenong + Casey</strong>. This is the largest humanitarian footprint of any Victorian PHN. Settlement health needs concentrate in the first 18 months: TB screening, dental, hearing, mental health post-trauma, immunisation catch-up (dss_scv_2025).' },
        { heading: 'Interpreter demand · top 6 languages',
          body: 'TIS National FY24 interpreter requests at SEMPHN-funded services were dominated by <span class="chip">Dari 4,820</span>, <span class="chip">Vietnamese 3,960</span>, <span class="chip">Arabic 3,280</span>, Mandarin 2,640, Tamil 1,920, Khmer 1,480 (tis_2024). Phone-interpreting carries 71% of demand; in-person is rationed by clinic geography.' },
        { heading: 'Cultural competence · gap, not absence',
          body: 'Mainstream general practice in Greater Dandenong + Casey is staffed disproportionately by clinicians who themselves migrated, partly offsetting the cultural-fit gap. The intervention lever is workflow not training: bilingual reception, predictable interpreter access, post-arrival enrolment pathways from refugee settlement providers.' },
      ],
    },
    '04-first-nations': {
      num: '04', title: 'First Nations <em>people</em>', subtitle: 'Priority population',
      target_words: 1600,
      sources: ['abs_census_2021', 'aihw_irseo_2024', 'polar_fn_2024', 'semphn_service_locator'],
      rubric: ['ACCHS', 'IRSEO', 'mental health', 'housing'],
      deck: 'The South Eastern Melbourne PHN catchment is home to approximately <strong>7,500 First Nations residents</strong>. The largest populations sit in <strong>Casey (23.4%)</strong>, <strong>Frankston (18.4%)</strong> and <strong>Mornington Peninsula (17.5%)</strong>. Median age <strong>25</strong>; one in three is under 15.',
      sections: [
        { heading: 'Socioeconomic determinants',
          body: 'The catchment IRSEO of <strong>25</strong> for First Nations residents is meaningfully above the Victorian average of <strong>14</strong>. The lowest IRSEO scores sit in Greater Dandenong, Cranbourne-Narre Warren (Casey), Cardinia and Mornington Peninsula — confirming a sharp east-west gradient in disadvantage across the catchment.' },
        { heading: 'Mental health · the standout finding',
          body: 'Mental health is the most common chronic condition reported by SEMPHN First Nations residents. Three LGAs sit above the Victorian average of <strong>18.3%</strong>: <span class="chip">Port Phillip 23.3%</span>, <span class="chip">Frankston 22.0%</span>, and <span class="chip">Greater Dandenong 21.4%</span>. Together these account for ~28% of the catchment\'s First Nations population but a disproportionate share of MH-related primary care contact.' },
        { heading: 'Housing · strain in the growth corridor',
          body: 'Greater Dandenong (<strong>18.0%</strong>), Casey (<strong>13.8%</strong>) and Cardinia (<strong>12.1%</strong>) lead the catchment on the share of First Nations rental households needing additional bedrooms. Overcrowding correlates with poorer self-rated health and lower preventive-care contact — the housing pathway and the primary-care pathway should be planned together.' },
        { heading: 'Workforce · two ACCHS, both stretched',
          body: 'Two Aboriginal Community Controlled Health Services operate in the catchment. Capacity is the binding constraint; a partnership model with mainstream general practice — and cultural-safety training as a service-contract KPI — emerges as the most actionable recommendation from this chapter.' },
      ],
    },
    '05-older-people': {
      num: '05', title: 'Older <em>people</em>', subtitle: 'Priority population',
      target_words: 1300,
      sources: ['abs_census_2021_age', 'abs_projections_2024', 'gen_aged_care_data'],
      rubric: ['65+', 'RACF', 'dementia'],
      deck: 'The catchment\'s <strong>65+ population is 314,600</strong> — <strong>19.2% of residents</strong>, growing <strong>+2.8% pa</strong>. Projected to reach <strong>372,100 by 2030</strong>, a <strong>+18% absolute increase</strong> in six years. The ageing-curve hits unevenly: <span class="chip">Mornington Peninsula 27.6%</span> is the oldest LGA in Victoria; <span class="chip">Casey 11.8%</span> the youngest in the catchment (abs_census_2021_age).',
      sections: [
        { heading: 'Mornington Peninsula · the oldest LGA in Vic',
          body: 'Mornington Peninsula is the demographic bellwether: <strong>27.6% over 65</strong>, retirement migration sustained for 15+ years, geographic isolation from tertiary care. Peninsula Health\'s Rosebud + The Bays carry the load; specialist outreach from Frankston Hospital is the access lever, not on-site capacity expansion (gen_aged_care_data).' },
        { heading: 'RACF capacity · 155 facilities, 12,400 beds',
          body: '<strong>155 residential aged-care facilities</strong> operate across the catchment with <strong>12,400 beds</strong>. Bed-per-1,000-residents-65+ runs 39.4 — slightly below the Victorian average of 41.2. Bupa, Mecwacare, Estia, Arcare, Regis, and Calvary collectively hold ~62% of stock. Independent and not-for-profit operators concentrate in Bayside, Glen Eira, Stonnington (gen_aged_care_data).' },
        { heading: 'Dementia · the cost driver for primary care',
          body: 'Dementia is the leading cause of death for women in the catchment and the third leading cause for men. Primary-care contact intensity for dementia-affected residents runs <strong>3.4× the all-cause average</strong>. The intervention lever is early diagnosis: <strong>SEMPHN-funded Care Finders + Dementia Australia partnership</strong> ($3.1M FY26) targets pre-diagnosis screening at GP practices in the high-incidence corridor of Mornington Pen + Bayside.' },
        { heading: 'Care-finder coverage · 6 of 10 LGAs covered',
          body: 'SEMPHN\'s Care Finders program ($5.2M FY26) operates in <strong>6 of 10 LGAs</strong>. Coverage gaps in Cardinia, Stonnington, and parts of Greater Dandenong are the active commissioning question for FY27. Aged-care funding is the catchment\'s second-largest stream at <strong>$18.4M</strong>, behind only mental health.' },
      ],
    },
    '06-homelessness': {
      num: '06', title: 'Homelessness <em>+ housing strain</em>', subtitle: 'Priority population',
      target_words: 1200,
      sources: ['abs_census_2021_homeless', 'aihw_shs_2024', 'launch_housing_2024'],
      rubric: ['rough sleeper', 'SHS', 'DV/FV'],
      deck: 'The catchment counts <strong>2,460 residents homeless or marginally housed</strong> — <strong>+18% since 2016</strong>. The catchment-wide rate of <strong>64.3 per 10,000</strong> conceals a 3.5× spread between LGAs. Homelessness is increasingly a <strong>mental-health frontline</strong>: 14% of SHS clients in the catchment cite mental health as the primary reason for presenting (abs_census_2021_homeless / aihw_shs_2024).',
      sections: [
        { heading: 'Greater Dandenong · 149.5 per 10,000',
          body: '<span class="chip">Greater Dandenong 149.5/10k</span> is the catchment\'s highest homelessness rate — <strong>2.3× the catchment median</strong>. Frankston 124.8, Port Phillip 118.2 follow. The Greater Dandenong cluster combines SEIFA decile 2 disadvantage, humanitarian-arrival concentration, and the inner south-eastern social-housing footprint. Wayss and Launch Housing dominate the local SHS delivery (abs_census_2021_homeless).' },
        { heading: 'DV/FV · the leading driver',
          body: 'Specialist Homelessness Services data for FY24 shows <strong>domestic + family violence drives 38% of all SHS presentations</strong> in the catchment — well above the Victorian average of 32%. Housing affordability is the second cause at 23%, mental health third at 14%. The DV/FV concentration means homelessness commissioning must <strong>integrate with safety, not just shelter</strong> (aihw_shs_2024).' },
        { heading: 'Rough sleepers · 6.9 per 10,000',
          body: 'StreetCount 2024 counted catchment rough sleepers at <strong>6.9 per 10,000 residents</strong> — below Greater Melbourne (8.2) but above the Australian average (5.6). Visible rough sleeping clusters in Frankston CBD, Dandenong CBD, and Carlton Gardens fringe of Port Phillip. The bulk of catchment homelessness is hidden — couch-surfing, severely crowded dwellings, transitional housing (launch_housing_2024).' },
        { heading: 'SHS volume · 11,240 clients FY24',
          body: 'SHS clients in the catchment rose from <strong>8,420 in FY20 to 11,240 in FY24</strong> — a <strong>+33% five-year increase</strong>. SEMPHN\'s <strong>Psychosocial Support stream ($4.9M FY26)</strong> co-commissions HeadtoHelp + Wellways + Stride to provide MH wrap-around for SHS clients in Frankston, Dandenong, Bentleigh. The expansion target is a warm-handover rate ≥ 60% by FY27.' },
      ],
    },
    '07-mental-health': {
      num: '07', title: 'Mental <em>health</em>', subtitle: 'Priority population',
      target_words: 1700,
      sources: ['polar_2024', 'aihw_phidu_mh_2024', 'aihw_ed_2024', 'semphn_funding_fy26',
                'vsr_2024', 'aihw_suicide_2024'],
      rubric: ['headspace', 'ED presentation', 'Frankston', 'suicide', 'self-harm'],
      deck: 'Mental health remains the catchment\'s single largest commissioning category — <strong>$25.6M of $76.6M FY26 funding</strong>. Adult prevalence is <strong>18.3%</strong> and has risen <strong>+1.3 percentage points</strong> over five years. The catchment supports <strong>9 headspace centres</strong> serving an estimated <strong>358,000 residents aged 0-17</strong>.',
      sections: [
        { heading: 'Frankston · the standout LGA',
          body: 'Frankston records <strong>116.1 MH conditions per 1,000 residents</strong> — <strong>48% above the Victorian average</strong> of 78.2. The combination of high deprivation (SEIFA decile 4) + ageing infrastructure + service-access barriers concentrates burden here. MH ED presentations at Frankston Hospital run <strong>218 per 10,000</strong> — also catchment-highest.' },
        { heading: 'Coastal gradient',
          body: '<span class="chip">Mornington Peninsula 102.6/1k</span> and <span class="chip">Greater Dandenong 97.4/1k</span> follow Frankston. The peninsula gradient is partly age-driven — older populations report more MH conditions per 1k — but Greater Dandenong\'s rate is age-standardised and reflects refugee/humanitarian arrival trauma load.' },
        { heading: 'Headspace coverage',
          body: 'The 9 headspace centres (Bentleigh, Frankston, Dandenong, Cranbourne, Narre Warren, Rosebud, South Melbourne, Elsternwick, Hastings) provide good geographic spread but capacity in the growth corridor lags youth-population growth. Cranbourne + Narre Warren serve a catchment growing at 3-4% pa.' },
        { heading: 'Suicide + self-harm · the catchment\'s most-confronting metric',
          body: 'Catchment suicide rate runs <strong>12.6 per 100k for men · 4.2 for women</strong> (5-yr average). The highest LGA rates concentrate in <span class="chip">Frankston 14.2</span> · <span class="chip">Mornington Peninsula 13.6</span> · <span class="chip">Greater Dandenong 12.4</span>. Self-harm ED presentations among 15-24-year-olds run <strong>318 per 100k catchment-wide</strong> — <strong>+24% over three years</strong>. SEMPHN\'s suicide-prevention commissioning ($1.48M FY26) supports Anglicare After Suicide Bereavement + StandBy; the geographic gap is Mornington Peninsula postvention coverage (vsr_2024 / aihw_suicide_2024).' },
      ],
    },
    '08-aod': {
      num: '08', title: 'Alcohol <em>+ other drugs</em>', subtitle: 'Priority population',
      stub: true,
      target_words: 1100,
      sources: ['aihw_aodts_2024', 'semphn_aod_2026'],
      rubric: ['methamphetamine', 'wait time', 'Frankston'],
      starter_prompts: [
        'Draft a deck paragraph on AOD treatment demand in the SEMPHN catchment. Heading: "AOD · methamphetamine the rising concern".',
        'Draft a paragraph on Frankston as the catchment\'s highest AOD episode rate. Heading: "Frankston · 128 episodes per 10k".',
        'Draft a paragraph on non-residential AOD wait times vs the 14-day target. Heading: "Wait times · 22 days vs 14-day target".',
      ],
    },
    '09-chronic-disease': {
      num: '09', title: 'Chronic <em>disease</em>', subtitle: 'Population health',
      target_words: 1500,
      sources: ['aihw_phidu_diabetes_2024', 'polar_chronic_2024', 'aihw_acsc_2024',
                'aihw_bod_2024', 'aihw_phidu_2024', 'aihw_admitted_patient_2024'],
      rubric: ['diabetes', 'avoidable', 'CHD', 'risk factor', 'screening'],
      deck: 'Chronic disease accounts for <strong>~62% of the catchment\'s burden of disease</strong>, with <strong>286,000 adults aged 45+ living with 2 or more chronic conditions</strong> (31.4%). The east-west gradient is sharp: avoidable mortality runs <strong>218 per 100k in Greater Dandenong</strong> against <strong>108 in Stonnington</strong> — a 2× spread on a single hour\'s drive (aihw_bod_2024 / aihw_phidu_2024).',
      sections: [
        { heading: 'Greater Dandenong · the diabetes hotspot',
          body: 'Type 2 diabetes prevalence in Greater Dandenong runs <strong>8.9%</strong> of adults — <strong>1.6× the Victorian average of 5.4%</strong>. The pattern compounds with low cancer-screening participation (<strong>38.4% bowel</strong>, <strong>43.4% breast</strong>, <strong>48.6% cervical</strong>) and CHD prevalence of <strong>9.2%</strong>. Type 2 diabetes incidence is also rising fastest in Casey + Cardinia growth corridors (polar_chronic_2024).' },
        { heading: 'Cardiovascular disease · the leading killer for men',
          body: 'Coronary heart disease is the <strong>leading cause of death for men</strong> across the catchment and the <strong>second leading cause for women</strong>. AMI admission rates per 100k follow the disadvantage gradient: <span class="chip">Gr Dandenong 412</span> · <span class="chip">Frankston 376</span> · <span class="chip">Mornington Pen 358</span> versus <span class="chip">Stonnington 178</span>. Hypertension is prevalent in <strong>24.6%</strong> of adults; <strong>~38% of those diagnosed have uncontrolled BP</strong> (aihw_phidu_2024 / aihw_admitted_patient_2024).' },
        { heading: 'Risk factors · the modifiable layer',
          body: 'Adult overweight + obese: <strong>Cardinia 68.4%</strong>, <strong>Frankston 65.2%</strong>, <strong>Casey 64.8%</strong>. Insufficient physical activity: <strong>Greater Dandenong 58.4%</strong>, <strong>Casey 52.6%</strong>. Daily smoking concentrates in Gr Dandenong (14.8%) + Frankston (14.1%). Risky alcohol consumption follows the coastal/affluent pattern: Mornington Peninsula 24.6%, Bayside 21.4%. These four risk factors map directly to ~40% of the avoidable-mortality burden (aihw_nhs_2022).' },
        { heading: 'Avoidable hospitalisations · the primary-care signal',
          body: 'Ambulatory-Care Sensitive Conditions per 100,000 (FY24): <span class="chip">Gr Dandenong 3,460</span> · <span class="chip">Frankston 3,120</span> · <span class="chip">Mornington Pen 2,840</span>. These are the conditions where good primary care prevents admission — diabetes complications, asthma, COPD, hypertension. The PIP-QI uplift program ($2.4M FY26) targets practices in these top-3 LGAs.' },
        { heading: 'Cancer screening · prevention beyond chronic-disease management',
          body: 'Three-program screening (bowel + breast + cervical) lags catchment-wide and disadvantage-driven. <strong>Casey 35.9% bowel screening is Australia\'s lowest LGA</strong>. The equity gap is sharpest in cervical screening, where Gr Dandenong (48.6%) sits 22.6 percentage points below Stonnington (71.2%) — a structural CALD + multi-language access problem, not a clinical one (aihw_nbcsp_2024 / vccr_2024).' },
      ],
    },
    '10-workforce': {
      num: '10', title: 'Health <em>workforce</em>', subtitle: 'Supply + capacity',
      target_words: 1500,
      sources: ['ahpra_mabel_2024', 'semphn_locator_2024', 'ahpra_age_2024'],
      rubric: ['GP', 'allied health', 'retirement'],
      deck: 'The catchment supports <strong>1,681 GP full-time equivalents</strong> — <strong>108 per 100,000 residents</strong>, against a Victorian average of <strong>124</strong>. The 16-FTE-per-100k gap is largest in the Cardinia + Casey growth corridor where supply has not kept pace with population.',
      sections: [
        { heading: 'GP age · the retirement curve',
          body: 'Forty per cent of catchment GPs are over <strong>55</strong>. A succession-planning lag means we should expect a measurable <strong>FTE contraction</strong> by 2028 even with current registrar pipelines. The 5-year trend is already negative — <strong>-4.8% since 2020</strong>.' },
        { heading: 'Allied health · the bayside skew',
          body: 'Allied health FTE per 10,000 residents follows the SEIFA gradient: <span class="chip">Stonnington 64.8</span>, <span class="chip">Port Phillip 58.1</span>, <span class="chip">Cardinia 21.4</span>. The growth-corridor LGAs are under-served by a factor of ~3.' },
        { heading: 'Bulk-billing concentration',
          body: 'Bulk-billing density is highest in Greater Dandenong + Casey — the most-disadvantaged LGAs — confirming that the bulk-billing model is the catchment\'s primary equity safety-net. Any Medicare reform that erodes bulk-billing economics will fall hardest on the catchment\'s lowest-income suburbs.' },
      ],
    },
    '11-recommendations': {
      num: '11', title: 'Recommendations', subtitle: 'Synthesis',
      stub: true,
      target_words: 1000,
      sources: ['semphn_hna_2025_28'],
      rubric: ['priority', 'commissioning', 'measure'],
      starter_prompts: [
        'Draft the top 5 recommendations from this HNA, ranked by potential impact + actionability. Heading: "Top 5 recommendations".',
        'Draft a paragraph linking each recommendation to a measurable indicator. Heading: "How we\'ll measure progress".',
      ],
    },
    '12-preflight': {
      num: '12', title: 'Pre-flight <em>checks</em>', subtitle: 'DoH rubric compliance',
      stub: true,
      target_words: 400,
      sources: ['doh_rubric_2024'],
      rubric: ['compliance', 'rubric', 'gap'],
      starter_prompts: [
        'Critique the current HNA against the DoH Performance Rubric. List gaps as bullets. Reply in prose, no widget.',
        'Draft a one-paragraph summary of pre-flight check results. Heading: "Pre-flight summary".',
      ],
    },
  };
  window.__HNA_CHAPTERS = HNA_CHAPTERS;
  var DEFAULT_HNA_CHAPTER = '04-first-nations';

  function currentChapterSlug() {
    var hash = (window.location.hash || '').replace(/^#/, '').trim();
    return HNA_CHAPTERS[hash] ? hash : DEFAULT_HNA_CHAPTER;
  }

  /* Friendly labels for source_ids · keeps the sources list readable */
  var SOURCE_LABELS = {
    abs_erp_2024:           'ABS Estimated Resident Population 2024',
    abs_census_2021:        'ABS Census 2021',
    abs_census_2021_age:    'ABS Census 2021 · age tables',
    abs_census_2021_lote:   'ABS Census 2021 · language tables',
    abs_census_2021_homeless: 'ABS Census 2021 · homelessness tables',
    abs_projections_2024:   'ABS Population Projections 2024',
    abs_seifa_2021:         'ABS SEIFA 2021',
    aihw_phidu_2024:        'AIHW PHIDU 2024',
    aihw_phidu_mh_2024:     'AIHW PHIDU · mental health 2024',
    aihw_phidu_diabetes_2024: 'AIHW PHIDU · diabetes 2024',
    aihw_irseo_2024:        'AIHW IRSEO 2024',
    aihw_ed_2024:           'AIHW ED data 2024',
    aihw_acsc_2024:         'AIHW ACSC 2024 · avoidable hospitalisations',
    aihw_aodts_2024:        'AIHW AODTS 2024',
    aihw_shs_2024:          'AIHW SHS 2024 · homelessness services',
    polar_2024:             'POLAR primary-care data 2024',
    polar_fn_2024:          'POLAR · First Nations cohort 2024',
    polar_chronic_2024:     'POLAR · chronic disease 2024',
    semphn_hna_2025_28:     'SEMPHN HNA 2025-28',
    semphn_funding_fy26:    'SEMPHN FY26 commissioning schedules',
    semphn_locator_2024:    'SEMPHN service locator 2024',
    semphn_service_locator: 'SEMPHN service locator 2024',
    semphn_aod_2026:        'SEMPHN AOD commissioning FY26',
    ahpra_mabel_2024:       'AHPRA + DoH MABEL 2024',
    ahpra_age_2024:         'AHPRA practitioner age 2024',
    gen_aged_care_data:     'GEN Aged Care Data 2024',
    dss_scv_2025:           'DSS Settlement reports 2025',
    tis_2024:               'TIS National FY24',
    launch_housing_2024:    'Launch Housing StreetCount 2024',
    doh_rubric_2024:        'DoH PHN Performance Rubric 2024',
    det_vic_2024:           'DET Vic schools register 2024',
    acara_2024:             'ACARA MySchool 2024',
    aihw_bod_2024:          'AIHW Burden of Disease Study 2024',
    abs_le_2024:            'ABS Life Expectancy 2024',
    aihw_nhs_2022:          'AIHW National Health Survey 2022',
    aihw_nbcsp_2024:        'AIHW National Bowel Cancer Screening Program 2024',
    breastscreen_vic_2024:  'BreastScreen Victoria 2024',
    vccr_2024:              'Victorian Cervical Cytology Registry 2024',
    vsr_2024:               'Victorian Suicide Register 2024',
    aihw_suicide_2024:      'AIHW Suicide & Self-harm Monitoring 2024',
    abs_disability_2018:    'ABS Survey of Disability, Ageing & Carers 2018',
    ndia_2024:              'NDIA Quarterly Reports 2024',
    aihw_admitted_patient_2024: 'AIHW Admitted Patient Care 2024',
  };

  function renderHnaEdits() {
    var body = document.getElementById('hna-doc-body');
    if (!body) return;
    // Remove all previously-rendered AI edits
    Array.prototype.slice.call(body.querySelectorAll('.hna-ai-edit-wrap'))
      .forEach(function (el) { el.remove(); });
    var slug = currentChapterSlug();
    var edits = readHnaEdits().filter(function (e) {
      // Edits without a chapter field land in the default chapter (back-compat)
      return (e.chapter || DEFAULT_HNA_CHAPTER) === slug;
    });
    edits.forEach(function (e, idx) {
      // Pass the ORIGINAL index so accept/discard can update the right item
      var globalIdx = readHnaEdits().findIndex(function (x) { return x === e || (x.ts === e.ts && x.text === e.text); });
      var node = buildHnaEditNode(e, globalIdx);
      if (e.accepted) {
        var p = node.querySelector('.hna-ai-edit');
        if (p) p.classList.remove('hna-ai-edit');
        var bar = node.querySelector('.hna-ai-edit-actions');
        if (bar) bar.remove();
      }
      body.appendChild(node);
    });
    updateHnaStatusBar();
    renderHnaSources();
    if (typeof renderActivity === 'function') renderActivity();
    if (typeof renderMarkComplete === 'function') renderMarkComplete();
  }

  function renderHnaSources() {
    var box = document.getElementById('hna-doc-sources');
    if (!box) return;
    var slug = currentChapterSlug();
    var ch = HNA_CHAPTERS[slug];
    var ids = (ch && ch.sources) ? ch.sources.slice() : [];
    // Pull additional source_ids from AI edits in this chapter
    var edits = readHnaEdits().filter(function (e) { return (e.chapter || DEFAULT_HNA_CHAPTER) === slug; });
    edits.forEach(function (e) {
      var txt = (e.text || '') + ' ' + (e.heading || '');
      var matches = txt.match(/\(([a-z0-9_]+)\)/gi) || [];
      matches.forEach(function (m) {
        var id = m.replace(/[()]/g, '').trim();
        if (SOURCE_LABELS[id] && ids.indexOf(id) < 0) ids.push(id);
      });
    });
    if (!ids.length) { box.setAttribute('hidden', ''); return; }
    box.removeAttribute('hidden');
    box.innerHTML = '<div class="srcs-hdr">Sources</div>' + ids.map(function (id) {
      var label = SOURCE_LABELS[id] || id;
      return '<div class="srcs-row" data-src-id="' + escHtml(id) + '" id="src-' + escHtml(id) + '"><span class="srcs-id">' + escHtml(id) + '</span><span class="srcs-lab">' + escHtml(label) + '</span></div>';
    }).join('');
  }

  function renderHnaChapter() {
    var slug = currentChapterSlug();
    var ch = HNA_CHAPTERS[slug];
    if (!ch) return;
    var meta = document.getElementById('hna-doc-meta');
    var title = document.getElementById('hna-doc-title');
    var body = document.getElementById('hna-doc-body');
    if (!meta || !title || !body) return;
    meta.innerHTML =
      '<span>Chapter ' + escHtml(ch.num) + ' · ' + escHtml(ch.subtitle || '') + '</span>' +
      '<span class="right">v1.2 · 28 May 2026 · target ' + (ch.target_words || '—') + ' words</span>';
    title.innerHTML = ch.title;
    body.innerHTML = '';
    if (ch.stub) {
      var stub = document.createElement('div');
      stub.className = 'hna-stub';
      var inner =
        '<div class="hna-stub-badge">Not yet drafted</div>' +
        '<p class="hna-stub-lead">This chapter doesn\'t have a draft yet. Pick a starter prompt to begin — the AI drafts straight into the doc, and you Keep or Discard each paragraph.</p>' +
        '<div class="hna-stub-chips">';
      (ch.starter_prompts || []).forEach(function (p) {
        // Use the first 6 words as the label
        var label = p.split(/\s+/).slice(0, 7).join(' ') + '…';
        inner += '<button type="button" class="hna-stub-chip" data-prompt="' + escHtml(p) + '">' +
          '<span class="ico">✎</span><span class="lab">' + escHtml(label) + '</span></button>';
      });
      inner += '</div>';
      stub.innerHTML = inner;
      Array.prototype.forEach.call(stub.querySelectorAll('.hna-stub-chip'), function (b) {
        b.addEventListener('click', function () {
          var p = b.getAttribute('data-prompt');
          var input = document.getElementById('chat-input');
          var send  = document.getElementById('chat-send');
          if (!input) return;
          input.value = p;
          input.dispatchEvent(new Event('input'));
          input.focus();
          if (send && !send.disabled) send.click();
        });
      });
      body.appendChild(stub);
    } else {
      // Seed content: deck + sections
      if (ch.deck) {
        var deck = document.createElement('p');
        deck.className = 'deck';
        deck.innerHTML = ch.deck;
        body.appendChild(deck);
      }
      (ch.sections || []).forEach(function (s, idx) {
        var h = document.createElement('h2');
        h.textContent = s.heading;
        body.appendChild(h);
        var p = document.createElement('p');
        p.innerHTML = s.body;
        body.appendChild(p);
        // Per-section "Add chart / Add map" toolbar with contextual suggestions
        var toolbar = buildSectionAddToolbar(s, ch, idx);
        if (toolbar) body.appendChild(toolbar);
      });
    }
    renderChapterRail();
    renderHnaEdits();
    renderChapterGuide();
    renderMarkComplete();
    renderToc();
    renderActivity();
    // Linkify (source_id) tokens in the seed content + AI edits → clickable
    // citations that scroll the sources list into view
    var docBody = document.getElementById('hna-doc-body');
    if (docBody) {
      Array.prototype.forEach.call(docBody.querySelectorAll('p, figcaption'), function (p) {
        linkifyCitations(p);
      });
    }
  }

  /* ============================================================
   * Chapter guide · always-on "Next steps" panel
   *
   * State-aware: reads the current chapter body + the chapter's
   * rubric / sections / sources and computes the 3-4 next-best
   * actions the user should take. Each chip auto-fires a chat
   * prompt OR triggers a local action (auto-draft, add chart).
   * ============================================================ */
  function chapterState(slug) {
    var ch = HNA_CHAPTERS[slug];
    var body = document.getElementById('hna-doc-body');
    if (!ch || !body) return null;
    var textLc = (body.textContent || '').toLowerCase();
    var rubricMissing = (ch.rubric || []).filter(function (k) { return textLc.indexOf(k.toLowerCase()) < 0; });
    var rubricDone = (ch.rubric || []).length - rubricMissing.length;
    var sectionsCount = body.querySelectorAll('h2').length;
    var paragraphsCount = body.querySelectorAll('p').length;
    var aiEditsCount = body.querySelectorAll('.hna-ai-edit-wrap').length;
    var chartsCount = body.querySelectorAll('.hna-figure').length;
    var hasDeck = !!body.querySelector('p.deck');
    var hasRecommendations = textLc.indexOf('recommend') >= 0;
    var words = body.textContent ? body.textContent.trim().split(/\s+/).length : 0;
    var target = ch.target_words || 1000;
    var pctOfTarget = Math.round((words / target) * 100);
    // Stage of the build
    var stage;
    if (ch.stub && aiEditsCount === 0) stage = 'Outline';
    else if (!hasDeck) stage = 'Outline';
    else if (sectionsCount === 0) stage = 'Drafting deck';
    else if (rubricMissing.length > 0) stage = 'Drafting sections';
    else if (chartsCount === 0) stage = 'Add data';
    else if (!hasRecommendations) stage = 'Recommendations';
    else if (pctOfTarget < 80) stage = 'Polishing';
    else stage = 'Ready for pre-flight';
    return {
      slug: slug, ch: ch,
      rubricMissing: rubricMissing, rubricDone: rubricDone,
      sectionsCount: sectionsCount,
      paragraphsCount: paragraphsCount,
      aiEditsCount: aiEditsCount,
      chartsCount: chartsCount,
      hasDeck: hasDeck,
      hasRecommendations: hasRecommendations,
      words: words, target: target, pctOfTarget: pctOfTarget,
      stage: stage,
    };
  }

  /* Pick 3-4 most-useful next actions given the chapter's current state. */
  function pickChapterActions(state) {
    if (!state) return [];
    var ch = state.ch;
    var chapterName = ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '').trim();
    var actions = [];

    // Stub chapter → top action is auto-draft everything
    if (ch.stub && state.aiEditsCount === 0) {
      actions.push({
        icon: '⚡', primary: true,
        label: 'Auto-draft this chapter',
        sub: 'Run all ' + (ch.starter_prompts || []).length + ' starter prompts in sequence',
        action: 'auto-draft',
      });
    }

    // Add missing rubric sections (top 2)
    state.rubricMissing.slice(0, 2).forEach(function (topic) {
      actions.push({
        icon: '+',
        label: 'Add a section on ' + topic,
        sub: 'Required by DoH Performance Rubric',
        prompt: 'Draft a paragraph for the ' + chapterName + ' chapter focused on **' + topic + '**. Use real SEMPHN figures, heading reflects the focus.',
      });
    });

    // Add a chart if there are sections but no chart yet
    if (state.sectionsCount > 0 && state.chartsCount === 0) {
      actions.push({
        icon: '◐',
        label: 'Add a data chart',
        sub: 'Visualises a key figure from this chapter',
        prompt: 'Add a chart widget to the ' + chapterName + ' chapter — pick the most important comparison or trend that backs up the deck. Type bar/donut/area as appropriate.',
      });
    }

    // Recommendations / pre-flight
    if (state.sectionsCount > 0 && !state.hasRecommendations) {
      actions.push({
        icon: '✓',
        label: 'Draft recommendations',
        sub: '3-5 actionable items tied to commissioning',
        prompt: 'Draft a recommendations paragraph for the ' + chapterName + ' chapter — 3-5 actionable items each tied to a commissioning lever. Heading: "Recommendations".',
      });
    }
    if (state.pctOfTarget >= 70 && state.rubricMissing.length === 0) {
      actions.push({
        icon: '◉',
        label: 'Run DoH pre-flight',
        sub: 'Check this chapter against the rubric',
        prompt: 'Run the DoH Performance Rubric pre-flight check on the current ' + chapterName + ' chapter. List any gaps as bullets. Reply in prose, no widget.',
      });
    }

    // Polish suggestions when we're well into the chapter
    if (state.pctOfTarget > 40 && actions.length < 4) {
      actions.push({
        icon: '↺',
        label: 'Tighten the deck',
        sub: 'Sharpen the opening paragraph',
        prompt: 'Rewrite the deck paragraph of the ' + chapterName + ' chapter — 25% shorter, sharper opening, same figures. New paragraph, replace.',
      });
    }
    if (state.sectionsCount === 0 && !ch.stub) {
      // Fleshed chapter with seed only — encourage adding a strengthening section
      actions.push({
        icon: '+',
        label: 'Add a SDOH section',
        sub: 'Layer social determinants onto the data',
        prompt: 'Draft a section that layers Dahlgren-Whitehead social determinants onto the ' + chapterName + ' chapter findings. Heading: "Social determinants".',
      });
    }

    return actions.slice(0, 4);
  }

  function renderChapterGuide() {
    var panel = document.getElementById('hna-next');
    var chipsEl = document.getElementById('hna-next-chips');
    var stageEl = document.getElementById('hna-next-stage');
    var titleEl = document.getElementById('hna-next-title');
    if (!panel || !chipsEl) return;
    var state = chapterState(currentChapterSlug());
    if (!state) { panel.setAttribute('hidden', ''); return; }
    var actions = pickChapterActions(state);
    if (!actions.length) { panel.setAttribute('hidden', ''); return; }
    panel.removeAttribute('hidden');
    if (stageEl) stageEl.textContent = state.stage;
    if (titleEl) {
      var chapterName = state.ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '').trim();
      titleEl.textContent = 'Next steps · ' + chapterName;
    }
    chipsEl.innerHTML = '';
    actions.forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hna-next-chip' + (a.primary ? ' primary' : '');
      btn.innerHTML =
        '<span class="ico">' + escHtml(a.icon) + '</span>' +
        '<span class="body">' +
          '<span class="lab">' + escHtml(a.label) + '</span>' +
          (a.sub ? '<span class="sub">' + escHtml(a.sub) + '</span>' : '') +
        '</span>' +
        '<span class="arr">→</span>';
      btn.addEventListener('click', function () {
        if (a.action === 'auto-draft') {
          autoDraftChapter(currentChapterSlug());
          return;
        }
        if (!a.prompt) return;
        var input = document.getElementById('chat-input');
        var send  = document.getElementById('chat-send');
        if (!input) return;
        input.value = a.prompt;
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (send && !send.disabled) send.click();
      });
      chipsEl.appendChild(btn);
    });
  }
  window.__renderChapterGuide = renderChapterGuide;

  /* ============================================================
   * HNA Mark Complete · per-chapter completion flag
   * ============================================================ */
  var HNA_COMPLETE_KEY_BASE = 'semphn.workbench.hna_complete.v1';
  function HNA_COMPLETE_KEY() { return uKey(HNA_COMPLETE_KEY_BASE); }
  function readChapterComplete() {
    try { return JSON.parse(localStorage.getItem(HNA_COMPLETE_KEY()) || '{}'); }
    catch (_) { return {}; }
  }
  function writeChapterComplete(map) {
    try { localStorage.setItem(HNA_COMPLETE_KEY(), JSON.stringify(map)); }
    catch (_) {}
  }
  function isChapterComplete(slug) {
    return !!readChapterComplete()[slug];
  }
  function setChapterComplete(slug, val) {
    var m = readChapterComplete();
    if (val) m[slug] = Date.now();
    else delete m[slug];
    writeChapterComplete(m);
  }
  window.__readChapterComplete = readChapterComplete;

  function renderMarkComplete() {
    var el = document.getElementById('hna-mark-complete');
    var btn = document.getElementById('hna-mc-btn');
    if (!el || !btn) return;
    var slug = currentChapterSlug();
    var state = chapterState(slug);
    if (!state) { el.setAttribute('hidden', ''); return; }
    var complete = isChapterComplete(slug);
    var ready = state.rubricMissing.length === 0 && state.pctOfTarget >= 60;
    if (!ready && !complete) { el.setAttribute('hidden', ''); return; }
    el.removeAttribute('hidden');
    el.classList.toggle('is-complete', complete);
    if (complete) {
      el.querySelector('.hna-mc-h').textContent = 'Marked complete';
      el.querySelector('.hna-mc-s').textContent = 'You can keep editing — re-open by un-marking.';
      btn.textContent = 'Un-mark';
    } else {
      el.querySelector('.hna-mc-h').textContent = 'This chapter looks ready';
      el.querySelector('.hna-mc-s').textContent = 'All DoH rubric checks pass and word target met. Lock it in?';
      btn.textContent = '✓ Mark complete';
    }
    btn.onclick = function () {
      var willBeComplete = !complete;
      setChapterComplete(slug, willBeComplete);
      renderMarkComplete();
      renderChapterRail();
      if (willBeComplete) {
        showToast('✓ Chapter marked complete', 'success');
        suggestNextChapter(slug);
      } else {
        showToast('Re-opened for editing', 'success');
      }
    };
  }

  /* After marking a chapter complete, surface the next least-complete
   * non-stub chapter as a suggestion so the user has a clear next focus. */
  function suggestNextChapter(currentSlug) {
    var slugs = Object.keys(HNA_CHAPTERS);
    var doneMap = readChapterComplete();
    var candidates = slugs
      .filter(function (s) { return s !== currentSlug && !doneMap[s]; })
      .map(function (s) {
        return { slug: s, ch: HNA_CHAPTERS[s], pct: computeChapterCompletion(s) };
      })
      .filter(function (c) { return !c.ch.stub; })
      .sort(function (a, b) { return a.pct - b.pct; });
    if (!candidates.length) {
      // All non-stub chapters done — celebrate
      showLodgementReadyBanner();
      return;
    }
    var next = candidates[0];
    var nextName = next.ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '').trim();
    var banner = document.createElement('div');
    banner.className = 'hna-next-chapter-banner';
    banner.innerHTML =
      '<div class="hna-ncb-l">' +
        '<div class="hna-ncb-eyebrow">Now focus on</div>' +
        '<div class="hna-ncb-title">Ch ' + escHtml(next.ch.num) + ' · ' + escHtml(nextName) + '</div>' +
        '<div class="hna-ncb-meta">' + next.pct + '% drafted · next least-complete chapter</div>' +
      '</div>' +
      '<button type="button" class="hna-ncb-go" data-slug="' + escHtml(next.slug) + '">Open chapter →</button>' +
      '<button type="button" class="hna-ncb-x" aria-label="Dismiss">×</button>';
    document.body.appendChild(banner);
    setTimeout(function () { banner.classList.add('is-open'); }, 30);
    banner.querySelector('.hna-ncb-go').addEventListener('click', function () {
      window.location.hash = '#' + next.slug;
      banner.classList.remove('is-open');
      setTimeout(function () { banner.remove(); }, 300);
    });
    banner.querySelector('.hna-ncb-x').addEventListener('click', function () {
      banner.classList.remove('is-open');
      setTimeout(function () { banner.remove(); }, 300);
    });
    // Auto-hide after 12s
    setTimeout(function () {
      if (banner.parentNode) {
        banner.classList.remove('is-open');
        setTimeout(function () { try { banner.remove(); } catch (_) {} }, 300);
      }
    }, 12000);
  }
  function showLodgementReadyBanner() {
    var banner = document.createElement('div');
    banner.className = 'hna-next-chapter-banner is-celebrate';
    banner.innerHTML =
      '<div class="hna-ncb-l">' +
        '<div class="hna-ncb-eyebrow">🎉 All chapters complete</div>' +
        '<div class="hna-ncb-title">HNA ready for pre-flight</div>' +
        '<div class="hna-ncb-meta">Run the DoH rubric review, then lodge to PPERS</div>' +
      '</div>' +
      '<button type="button" class="hna-ncb-go" id="hna-ncb-preflight">Run pre-flight →</button>' +
      '<button type="button" class="hna-ncb-x" aria-label="Dismiss">×</button>';
    document.body.appendChild(banner);
    setTimeout(function () { banner.classList.add('is-open'); }, 30);
    banner.querySelector('#hna-ncb-preflight').addEventListener('click', function () {
      banner.classList.remove('is-open');
      setTimeout(function () { banner.remove(); }, 300);
      if (typeof window.__openPreflight === 'function') window.__openPreflight();
    });
    banner.querySelector('.hna-ncb-x').addEventListener('click', function () {
      banner.classList.remove('is-open');
      setTimeout(function () { banner.remove(); }, 300);
    });
  }

  /* ============================================================
   * Pre-flight modal · DoH rubric check across all 12 chapters
   * ============================================================ */
  function buildPreflight() {
    var summaryEl = document.getElementById('hna-preflight-summary');
    var listEl = document.getElementById('hna-preflight-list');
    var titleEl = document.getElementById('hna-preflight-title');
    if (!summaryEl || !listEl || !titleEl) return;
    var slugs = Object.keys(HNA_CHAPTERS);
    var passed = 0, totalChecks = 0, missingChecks = 0;
    var rows = [];
    slugs.forEach(function (s) {
      var ch = HNA_CHAPTERS[s];
      var pct = computeChapterCompletion(s);
      var rubric = ch.rubric || [];
      // Build text for rubric matching
      var text = (ch.deck || '');
      (ch.sections || []).forEach(function (sec) { text += ' ' + (sec.heading || '') + ' ' + (sec.body || ''); });
      readHnaEdits().filter(function (e) { return (e.chapter || DEFAULT_HNA_CHAPTER) === s; })
        .forEach(function (e) { text += ' ' + (e.heading || '') + ' ' + (e.text || ''); });
      var lc = text.toLowerCase();
      var perRubric = rubric.map(function (k) { return { topic: k, pass: lc.indexOf(k.toLowerCase()) >= 0 }; });
      totalChecks += rubric.length;
      var checkPass = perRubric.filter(function (r) { return r.pass; }).length;
      missingChecks += (rubric.length - checkPass);
      var stageOk = pct >= 60 && checkPass === rubric.length && !ch.stub;
      var manuallyMarked = isChapterComplete(s);
      if (stageOk || manuallyMarked) passed++;
      rows.push({ slug: s, ch: ch, pct: pct, perRubric: perRubric, stageOk: stageOk, marked: manuallyMarked });
    });
    var totalCh = slugs.length;
    titleEl.textContent = passed + '/' + totalCh + ' chapters ready for lodgement';
    var ready = passed === totalCh;
    summaryEl.innerHTML =
      '<div class="hna-preflight-stats">' +
        '<div class="hna-pf-stat"><div class="v">' + passed + '/' + totalCh + '</div><div class="l">Chapters complete</div></div>' +
        '<div class="hna-pf-stat"><div class="v">' + (totalChecks - missingChecks) + '/' + totalChecks + '</div><div class="l">Rubric items passed</div></div>' +
        '<div class="hna-pf-stat is-' + (ready ? 'pass' : 'warn') + '"><div class="v">' + (ready ? 'Ready' : 'Not ready') + '</div><div class="l">Lodgement status</div></div>' +
      '</div>';
    listEl.innerHTML = rows.map(function (r) {
      var checks = r.perRubric.map(function (rb) {
        return '<span class="hna-pf-check is-' + (rb.pass ? 'pass' : 'miss') + '">' +
          (rb.pass ? '✓' : '○') + ' ' + escHtml(rb.topic) + '</span>';
      }).join('');
      var titleClean = r.ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '').trim();
      var missingRubric = r.perRubric.filter(function (x) { return !x.pass; });
      var statusClass = (r.stageOk || r.marked) ? 'is-ready' : (r.pct >= 30 ? 'is-progress' : 'is-stub');
      var statusLabel = r.marked ? 'Marked ✓' : (r.stageOk ? 'Ready' : (r.pct >= 30 ? r.pct + '% drafted' : 'Not started'));
      var fixBtn = missingRubric.length ? (
        '<button type="button" class="hna-pf-fix" data-slug="' + escHtml(r.slug) + '" data-topic="' + escHtml(missingRubric[0].topic) + '">' +
          'Draft ' + escHtml(missingRubric[0].topic) + ' →</button>'
      ) : '';
      return '<div class="hna-pf-row ' + statusClass + '">' +
        '<div class="hna-pf-num">' + escHtml(r.ch.num) + '</div>' +
        '<div class="hna-pf-body">' +
          '<div class="hna-pf-titlerow"><a class="hna-pf-link" href="#' + escHtml(r.slug) + '" data-jump="' + escHtml(r.slug) + '">' + escHtml(titleClean) + '</a>' +
          '<span class="hna-pf-status">' + statusLabel + '</span></div>' +
          '<div class="hna-pf-checks">' + checks + '</div>' +
          fixBtn +
        '</div>' +
      '</div>';
    }).join('');
    // Wire jump links + fix buttons
    Array.prototype.forEach.call(listEl.querySelectorAll('[data-jump]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        window.location.hash = '#' + a.getAttribute('data-jump');
        closePreflight();
      });
    });
    Array.prototype.forEach.call(listEl.querySelectorAll('.hna-pf-fix'), function (b) {
      b.addEventListener('click', function () {
        var slug = b.getAttribute('data-slug');
        var topic = b.getAttribute('data-topic');
        window.location.hash = '#' + slug;
        closePreflight();
        setTimeout(function () {
          var input = document.getElementById('chat-input');
          var send  = document.getElementById('chat-send');
          if (!input) return;
          input.value = 'Draft a paragraph for this chapter focused on **' + topic + '**. Use real SEMPHN figures from the ground truth. New paragraph.';
          input.dispatchEvent(new Event('input'));
          input.focus();
          if (send && !send.disabled) send.click();
        }, 500);
      });
    });
  }
  function openPreflight() {
    var modal = document.getElementById('hna-preflight');
    if (!modal) return;
    buildPreflight();
    modal.removeAttribute('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closePreflight() {
    var modal = document.getElementById('hna-preflight');
    if (modal) modal.setAttribute('hidden', '');
    document.body.style.overflow = '';
  }
  window.__openPreflight = openPreflight;

  /* ============================================================
   * Recent activity panel · floating right edge
   * ============================================================ */
  function renderActivity() {
    var panel = document.getElementById('hna-activity');
    var listEl = document.getElementById('hna-activity-list');
    var countEl = document.getElementById('hna-activity-count');
    if (!panel || !listEl || !countEl) return;
    var edits = readHnaEdits().slice().reverse().slice(0, 6);
    if (!edits.length) { panel.setAttribute('hidden', ''); return; }
    panel.removeAttribute('hidden');
    countEl.textContent = readHnaEdits().length;
    listEl.innerHTML = edits.map(function (e) {
      var ch = HNA_CHAPTERS[e.chapter || DEFAULT_HNA_CHAPTER];
      var chName = ch ? ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '').trim() : 'Unknown';
      var when = e.ts ? relativeTime(e.ts) : '';
      var snippet = (e.text || e.heading || '').slice(0, 80);
      var isChart = !!e.widget;
      return '<a class="hna-activity-item" href="#' + escHtml(e.chapter || DEFAULT_HNA_CHAPTER) + '">' +
        '<span class="hna-ai-pip ' + (isChart ? 'is-chart' : '') + '">' + (isChart ? '◐' : '✎') + '</span>' +
        '<div class="hna-ai-body">' +
          '<div class="hna-ai-row1">' +
            '<span class="hna-ai-chapter">Ch ' + escHtml(ch ? ch.num : '?') + ' · ' + escHtml(chName) + '</span>' +
            '<span class="hna-ai-when">' + escHtml(when) + '</span>' +
          '</div>' +
          '<div class="hna-ai-snippet">' + escHtml(snippet) + (snippet.length === 80 ? '…' : '') + '</div>' +
        '</div>' +
      '</a>';
    }).join('');
  }
  function relativeTime(ts) {
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }
  window.__renderActivity = renderActivity;

  /* ============================================================
   * In-chapter TOC right-rail
   * ============================================================ */
  function renderToc() {
    var tocEl = document.getElementById('hna-toc');
    if (!tocEl) return;
    var body = document.getElementById('hna-doc-body');
    if (!body) { tocEl.setAttribute('hidden', ''); return; }
    var headings = body.querySelectorAll('h2');
    if (headings.length < 3) { tocEl.setAttribute('hidden', ''); return; }
    tocEl.removeAttribute('hidden');
    var html = '<div class="hna-toc-h">In this chapter</div><ol class="hna-toc-list">';
    Array.prototype.forEach.call(headings, function (h, i) {
      var id = 'sec-' + i;
      h.id = id;
      html += '<li><a href="#' + id + '" data-toc>' + escHtml(h.textContent.trim()) + '</a></li>';
    });
    html += '</ol>';
    tocEl.innerHTML = html;
    Array.prototype.forEach.call(tocEl.querySelectorAll('[data-toc]'), function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var id = a.getAttribute('href').replace('#', '');
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }
  window.__renderToc = renderToc;

  /* Auto-draft · run a chapter's starter prompts in sequence. Shows a
   * floating progress chip so the user knows the queue is running.
   * Spaced 5s apart so the AI's reply for each lands before the next
   * prompt fires (matches typical Foundry latency under MAX_OUTPUT_TOKENS). */
  function autoDraftChapter(slug) {
    var ch = HNA_CHAPTERS[slug];
    if (!ch || !ch.starter_prompts || !ch.starter_prompts.length) {
      showToast('No starter prompts for this chapter', 'warn');
      return;
    }
    var prompts = ch.starter_prompts;
    showAutoDraftProgress(0, prompts.length, ch.title.replace(/<[^>]+>/g, ''));
    prompts.forEach(function (p, i) {
      setTimeout(function () {
        var input = document.getElementById('chat-input');
        var send  = document.getElementById('chat-send');
        if (!input) return;
        input.value = p;
        input.dispatchEvent(new Event('input'));
        if (send && !send.disabled) send.click();
        showAutoDraftProgress(i + 1, prompts.length, ch.title.replace(/<[^>]+>/g, ''));
      }, i * 5000);
    });
    // Auto-hide the chip 4s after the final prompt fires
    setTimeout(hideAutoDraftProgress, prompts.length * 5000 + 4000);
  }
  window.__autoDraftChapter = autoDraftChapter;

  function showAutoDraftProgress(done, total, chapterName) {
    var el = document.getElementById('hna-autodraft-chip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'hna-autodraft-chip';
      el.className = 'hna-autodraft-chip';
      document.body.appendChild(el);
    }
    var pct = Math.round((done / total) * 100);
    el.innerHTML =
      '<div class="hna-ad-spinner"></div>' +
      '<div class="hna-ad-body">' +
        '<div class="hna-ad-title">Auto-drafting · ' + escHtml(chapterName) + '</div>' +
        '<div class="hna-ad-meta">' + done + ' of ' + total + ' prompts sent · ' + pct + '%</div>' +
      '</div>' +
      '<div class="hna-ad-bar"><span style="width:' + pct + '%"></span></div>';
    el.classList.add('is-open');
  }
  function hideAutoDraftProgress() {
    var el = document.getElementById('hna-autodraft-chip');
    if (el) el.classList.remove('is-open');
  }

  /* Compute a 0-100 completion percentage for a single chapter.
   * Combines: seed-content presence + rubric pass rate + word-count-to-target.
   * Read by renderChapterRail to draw the progress ring on each chip. */
  function computeChapterCompletion(slug) {
    var ch = HNA_CHAPTERS[slug];
    if (!ch) return 0;
    var rubric = ch.rubric || [];
    var rubricCount = rubric.length || 1;
    // Build the chapter's full text without mounting it: concat seed + edits
    var text = (ch.deck || '');
    (ch.sections || []).forEach(function (s) {
      text += ' ' + (s.heading || '') + ' ' + (s.body || '');
    });
    var edits = readHnaEdits().filter(function (e) {
      return (e.chapter || DEFAULT_HNA_CHAPTER) === slug;
    });
    edits.forEach(function (e) { text += ' ' + (e.heading || '') + ' ' + (e.text || ''); });
    var textLc = text.toLowerCase();
    var rubricPassed = rubric.filter(function (k) { return textLc.indexOf(k.toLowerCase()) >= 0; }).length;
    var rubricPct = (rubricPassed / rubricCount) * 100;
    // Word count vs target
    var words = text.trim() ? text.trim().split(/\s+/).length : 0;
    var target = ch.target_words || 1000;
    var wordPct = Math.min(100, (words / target) * 100);
    // Seed weight: fleshed chapters start at 30% just for having seed content
    var seedPct = ch.stub ? 0 : 30;
    var aiBoost = ch.stub ? Math.min(50, edits.length * 20) : 0;
    var raw = seedPct + aiBoost + 0.35 * rubricPct + 0.35 * wordPct;
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  /* ============================================================
   * Per-section Add-chart / Add-map suggestions
   *
   * Each section gets a small toolbar with 2-4 chart prompts + 2-3 map
   * prompts tailored to the section's topic (inferred from heading
   * keywords + chapter context). Click → either fires the AI prompt
   * (chart) or loads a prebuilt map template (map).
   * ============================================================ */
  function suggestionsForSection(section, chapter) {
    var heading = (section.heading || '').toLowerCase();
    var chapterTitle = (chapter.title || '').replace(/<[^>]+>/g, '').toLowerCase();
    var charts = [];
    var maps = [];

    function pushChart(label, prompt) { charts.push({ label: label, prompt: prompt }); }
    function pushMap(label, mapTemplate, prompt) {
      maps.push({ label: label, mapTemplate: mapTemplate, prompt: prompt });
    }

    // ---- MH / suicide ----
    if (heading.includes('frankston') && chapterTitle.includes('mental')) {
      pushChart('Bar · MH conditions by LGA',
        'Add a bar chart of MH conditions per 1,000 residents by SEMPHN LGA — ranked highest to lowest. Highlight Frankston (116.1).');
      pushChart('Area · 5-year MH ED trend',
        'Add an area chart of MH ED presentations per 100k for the catchment over the last 5 financial years.');
      pushMap('Map · MH hotspots', 'mh-hotspots',
        'Add a choropleth widget mapping MH conditions per 1,000 residents by LGA. Highlight Frankston.');
    }
    if (heading.includes('suicide')) {
      pushChart('Bar · suicide rate by LGA',
        'Add a bar chart of suicide rate per 100,000 by SEMPHN LGA — ranked highest to lowest. Highlight Frankston.');
      pushChart('Donut · means of suicide',
        'Add a donut chart of means of suicide (hanging 53% · pharmaceutical 18% · other 23% · firearm 6%).');
      pushMap('Map · suicide prevention', 'suicide-prevention',
        'Add a choropleth widget mapping suicide rate per 100,000 by SEMPHN LGA. Highlight Frankston.');
    }
    if (heading.includes('coastal') || heading.includes('mornington')) {
      pushChart('Bar · MH ED presentations by LGA',
        'Add a bar chart of MH ED presentations per 10,000 by SEMPHN LGA. Highlight Frankston.');
      pushMap('Map · MH hotspots', 'mh-hotspots', null);
    }
    if (heading.includes('headspace')) {
      pushChart('Donut · headspace centres by LGA',
        'Add a donut chart of the 9 SEMPHN headspace centres by LGA share.');
      pushMap('Map · headspace coverage', 'youth-services',
        'Add a choropleth widget mapping % aged 5-17 by SEMPHN LGA. Highlight Casey.');
    }

    // ---- First Nations ----
    if (heading.includes('socioeconomic') || heading.includes('irseo')) {
      pushChart('Bar · First Nations IRSEO by LGA',
        'Add a bar chart of First Nations IRSEO by SEMPHN LGA — higher = more disadvantaged. Highlight Greater Dandenong.');
      pushMap('Map · First Nations services', 'first-nations',
        'Add a choropleth widget mapping First Nations IRSEO by SEMPHN LGA.');
    }
    if (heading.includes('mental health') && chapterTitle.includes('first nations')) {
      pushChart('Bar · First Nations MH prevalence',
        'Add a bar chart of First Nations MH prevalence by SEMPHN LGA. Highlight Port Phillip 23.3%.');
    }
    if (heading.includes('housing') && chapterTitle.includes('first nations')) {
      pushChart('Donut · First Nations housing strain',
        'Add a donut chart of First Nations household-bedroom-need share (Gr Dandenong 18.0%, Casey 13.8%, Cardinia 12.1%, other 56.1%).');
    }
    if (heading.includes('workforce') && chapterTitle.includes('first nations')) {
      pushChart('Table · 2 ACCHS in catchment',
        'Add a table widget with columns Service, Suburb, Type, Staff for the 2 SEMPHN ACCHS.');
    }

    // ---- CALD ----
    if (heading.includes('multilingual') || heading.includes('lote')) {
      pushChart('Bar · % LOTE by LGA',
        'Add a bar chart of % LOTE-at-home by SEMPHN LGA. Highlight Greater Dandenong 64.2%.');
      pushMap('Map · CALD density', 'cald-density', null);
    }
    if (heading.includes('humanitarian')) {
      pushChart('Donut · humanitarian arrivals by LGA share',
        'Add a donut chart of humanitarian-arrival settlement share by SEMPHN LGA (Gr Dandenong + Casey 72%, other 28%).');
    }
    if (heading.includes('interpreter')) {
      pushChart('Bar · interpreter requests by language',
        'Add a bar chart of TIS interpreter requests FY24 by top 6 languages. Highlight Dari (4,820).');
    }

    // ---- Older people ----
    if (heading.includes('mornington') && chapterTitle.includes('older')) {
      pushChart('Bar · % 65+ by LGA',
        'Add a bar chart of % aged 65+ by SEMPHN LGA. Highlight Mornington Peninsula 27.6%.');
      pushMap('Map · aged care', 'aged-care', null);
    }
    if (heading.includes('racf')) {
      pushChart('Area · projected 65+ growth',
        'Add an area chart of projected 65+ population in the catchment 2024-2030.');
    }
    if (heading.includes('dementia')) {
      pushChart('Donut · aged-care funding by category',
        'Add a donut chart of FY26 aged-care funding by SEMPHN program category.');
    }
    if (heading.includes('care-finder') || heading.includes('care finder')) {
      pushChart('KPI · aged-care FY26 funding',
        'Add a KPI tile for SEMPHN aged-care commissioning total FY26 ($18.4M).');
    }

    // ---- Homelessness ----
    if (heading.includes('greater dandenong') && chapterTitle.includes('homeless')) {
      pushChart('Bar · homelessness rate by LGA',
        'Add a bar chart of homeless + marginal housing rate per 10,000 by SEMPHN LGA. Highlight Greater Dandenong.');
      pushMap('Map · homelessness', 'homelessness', null);
    }
    if (heading.includes('dv/fv') || heading.includes('domestic')) {
      pushChart('Donut · SHS primary reasons',
        'Add a donut chart of primary SHS presentation reasons (DV/FV 38%, housing 23%, MH 14%, family 11%, substance 8%, other 6%).');
    }
    if (heading.includes('rough sleeper')) {
      pushChart('Bar · rough sleepers vs benchmarks',
        'Add a bar chart of rough sleepers per 10,000 — catchment vs Greater Melbourne vs Australia.');
    }
    if (heading.includes('shs volume')) {
      pushChart('Area · 5-year SHS client volume',
        'Add an area chart of catchment SHS clients FY20-FY24.');
    }

    // ---- Chronic disease / risk factors / CVD / screening ----
    if (heading.includes('diabetes') || heading.includes('gr dandenong')) {
      pushChart('Bar · type 2 diabetes by LGA',
        'Add a bar chart of type 2 diabetes prevalence % by SEMPHN LGA. Highlight Greater Dandenong 8.9%.');
      pushMap('Map · CVD burden', 'cvd-burden', null);
    }
    if (heading.includes('cardiovascular') || heading.includes('cvd')) {
      pushChart('Bar · AMI admissions by LGA',
        'Add a bar chart of AMI admissions per 100,000 by SEMPHN LGA. Highlight Greater Dandenong 412.');
      pushMap('Map · CVD burden', 'cvd-burden', null);
    }
    if (heading.includes('risk factor') || heading.includes('modifiable')) {
      pushChart('Bar · overweight + obese by LGA',
        'Add a bar chart of adult overweight + obese % by SEMPHN LGA. Highlight Cardinia 68.4%.');
      pushChart('Bar · daily smoker by LGA',
        'Add a bar chart of daily smoker % adult by SEMPHN LGA. Highlight Greater Dandenong 14.8%.');
      pushMap('Map · risk factors', 'risk-factors', null);
    }
    if (heading.includes('avoidable')) {
      pushChart('Bar · avoidable admissions by LGA',
        'Add a bar chart of ACSC avoidable admissions per 100,000 by SEMPHN LGA. Highlight Greater Dandenong 3,460.');
    }
    if (heading.includes('cancer screening') || heading.includes('screening')) {
      pushChart('Bar · bowel screening by LGA',
        'Add a bar chart of bowel screening % NBCSP FY24 by SEMPHN LGA — ranked lowest first. Highlight Casey 35.9%.');
      pushChart('Bar · cervical screening by LGA',
        'Add a bar chart of cervical screening % by SEMPHN LGA. Highlight Greater Dandenong 48.6%.');
      pushMap('Map · screening gap', 'screening-gap', null);
    }

    // ---- Workforce ----
    if (heading.includes('gp age') || heading.includes('retirement')) {
      pushChart('Donut · GP age distribution',
        'Add a donut chart of catchment GP age distribution (under 35 14%, 35-44 24%, 45-54 22%, 55-64 24%, 65+ 16%).');
      pushChart('Area · GP FTE 5-year trend',
        'Add an area chart of catchment GP FTE 2020-2024.');
    }
    if (heading.includes('allied health')) {
      pushChart('Bar · allied health FTE by LGA',
        'Add a bar chart of allied health FTE per 10,000 residents by SEMPHN LGA. Highlight Stonnington 64.8.');
    }
    if (heading.includes('bulk-billing') || heading.includes('bulk billing')) {
      pushMap('Map · GP supply', 'gp-supply', null);
    }

    // ---- Region / catchment ----
    if (heading.includes('10 lga') || heading.includes('lgas')) {
      pushChart('Bar · catchment population by LGA',
        'Add a bar chart of catchment population by SEMPHN LGA. Highlight Casey 393,000.');
      pushMap('Map · service network', 'service-network', null);
    }
    if (heading.includes('population pressure') || heading.includes('growth')) {
      pushChart('Area · catchment population projection',
        'Add an area chart of SEMPHN catchment population projection 2024-2030.');
      pushMap('Map · growth corridor', 'growth-corridor', null);
    }

    // ---- Methodology / introduction (mostly text) ----
    if (heading.includes('framework') || heading.includes('bradshaw')) {
      pushChart('KPI · 13-chapter cycle',
        'Add a KPI tile showing the 12 chapters of the SEMPHN HNA.');
    }

    // Universal fallback if no topic match
    if (charts.length === 0) {
      pushChart('Bar · catchment headline metric',
        'Add a bar chart of the most important metric from this section, ranked by LGA. Use real SEMPHN figures from the ground truth.');
    }
    if (maps.length === 0) {
      pushMap('Map · service network', 'service-network', null);
    }

    return { charts: charts.slice(0, 4), maps: maps.slice(0, 3) };
  }

  function buildSectionAddToolbar(section, chapter, idx) {
    var sug = suggestionsForSection(section, chapter);
    var wrap = document.createElement('div');
    wrap.className = 'hna-section-add';
    var label = document.createElement('div');
    label.className = 'hna-sa-label';
    label.textContent = 'Add to this section';
    wrap.appendChild(label);
    var chips = document.createElement('div');
    chips.className = 'hna-sa-chips';
    sug.charts.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hna-sa-chip is-chart';
      btn.innerHTML = '<span class="ico">◐</span><span class="lab">' + escHtml(c.label) + '</span>';
      btn.addEventListener('click', function () { fireHnaSectionPrompt(c.prompt); });
      chips.appendChild(btn);
    });
    sug.maps.forEach(function (m) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hna-sa-chip is-map';
      btn.innerHTML = '<span class="ico">▦</span><span class="lab">' + escHtml(m.label) + '</span>';
      btn.addEventListener('click', function () {
        if (m.prompt) {
          // Chart-style: ask AI to emit a choropleth widget directly into HNA
          fireHnaSectionPrompt(m.prompt);
        } else if (m.mapTemplate && window.__MAP_TEMPLATES) {
          // Pre-built template: synthesize a choropleth widget from the template
          // data and inject as an inline HNA figure (no AI roundtrip needed)
          var tpl = window.__MAP_TEMPLATES[m.mapTemplate];
          if (tpl && tpl.choropleth && window.__applyHnaWidget) {
            var w = JSON.parse(JSON.stringify(tpl.choropleth));
            w.title = tpl.title || w.title;
            w.subtitle = tpl.description || w.subtitle;
            window.__applyHnaWidget(w);
            showToast('Added map · ' + (tpl.title || ''), 'success');
          }
        }
      });
      chips.appendChild(btn);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  function fireHnaSectionPrompt(prompt) {
    var input = document.getElementById('chat-input');
    var send  = document.getElementById('chat-send');
    if (!input) return;
    input.value = prompt;
    input.dispatchEvent(new Event('input'));
    input.focus();
    if (send && !send.disabled) send.click();
  }

  function renderChapterRail() {
    var rail = document.getElementById('hna-chapter-rail');
    if (!rail) return;
    var slug = currentChapterSlug();
    rail.innerHTML = '';
    Object.keys(HNA_CHAPTERS).forEach(function (key) {
      var ch = HNA_CHAPTERS[key];
      var pct = computeChapterCompletion(key);
      var manuallyMarked = isChapterComplete(key);
      var displayPct = manuallyMarked ? 100 : pct;
      var isComplete = manuallyMarked || pct >= 80;
      var a = document.createElement('a');
      a.className = 'chapter-chip' +
                    (key === slug ? ' is-on' : '') +
                    (ch.stub ? ' is-stub' : '') +
                    (isComplete ? ' is-complete' : '') +
                    (pct >= 30 && pct < 80 && !manuallyMarked ? ' is-progress' : '');
      a.href = '#' + key;
      a.title = ch.title.replace(/<[^>]+>/g, '') + ' · ' + displayPct + '% complete' + (manuallyMarked ? ' (marked)' : '');
      var label = ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, ' ').split(' ').slice(0, 2).join(' ');
      a.innerHTML =
        '<span class="n">' + escHtml(ch.num) + '</span>' +
        '<span class="lab">' + escHtml(label) + '</span>' +
        '<span class="prog" style="width:' + displayPct + '%;"></span>';
      rail.appendChild(a);
    });
  }

  function countWords(html) {
    if (!html) return 0;
    var tmp = document.createElement('div');
    tmp.innerHTML = html;
    var text = (tmp.textContent || '').trim();
    if (!text) return 0;
    return text.split(/\s+/).length;
  }

  function updateHnaStatusBar() {
    var slug = currentChapterSlug();
    var ch = HNA_CHAPTERS[slug];
    if (!ch) return;
    var body = document.getElementById('hna-doc-body');
    var words = body ? countWords(body.innerHTML) : 0;
    var target = ch.target_words || 0;

    var wordsEl = document.getElementById('hna-words');
    var wordsLEl = document.getElementById('hna-words-l');
    if (wordsEl) wordsEl.textContent = words.toLocaleString('en-AU');
    if (wordsLEl) wordsLEl.textContent = target ? 'words · target ' + target.toLocaleString('en-AU') : 'words';

    // Lodgement countdown to 15 Nov 2026
    var deadlineEl = document.getElementById('hna-deadline');
    if (deadlineEl) {
      var now = new Date();
      var ppers = new Date('2026-11-15T00:00:00+10:00');
      var days = Math.max(0, Math.round((ppers - now) / (1000 * 60 * 60 * 24)));
      deadlineEl.textContent = days + ' days';
    }

    // DoH rubric · count how many required keywords appear in the body
    var rubric = ch.rubric || [];
    var bodyTextLc = body ? (body.textContent || '').toLowerCase() : '';
    var passed = rubric.filter(function (k) { return bodyTextLc.indexOf(k.toLowerCase()) >= 0; }).length;
    var rubricEl = document.getElementById('hna-rubric');
    if (rubricEl) {
      rubricEl.textContent = passed + '/' + rubric.length;
      rubricEl.parentElement.classList.toggle('is-warn', passed < rubric.length);
      rubricEl.parentElement.classList.toggle('is-pass', rubric.length > 0 && passed === rubric.length);
    }

    // Overall progress · count chapters with at least one paragraph (seed or edit)
    var pctEl = document.getElementById('hna-pct');
    var fillEl = document.getElementById('hna-progress-fill');
    var all = Object.keys(HNA_CHAPTERS);
    var startedCh = all.filter(function (k) {
      var c = HNA_CHAPTERS[k];
      if (!c.stub) return true;
      // Stubs count as started if they have any AI edits saved
      return readHnaEdits().some(function (e) { return (e.chapter || DEFAULT_HNA_CHAPTER) === k; });
    }).length;
    var pct = Math.round((startedCh / all.length) * 100);
    if (pctEl) pctEl.textContent = startedCh + '/' + all.length;
    if (fillEl) fillEl.style.width = pct + '%';
  }

  function applyHnaParagraph(widget) {
    if (!widget || widget.type !== 'paragraph') return false;
    var edit = {
      heading: widget.heading || '',
      text:    widget.text || widget.value || '',
      title:   widget.title || '',
      chapter: currentChapterSlug(),
      ts:      Date.now(),
      accepted: false,
    };
    if (!edit.text) return false;
    var arr = readHnaEdits();
    arr.push(edit);
    writeHnaEdits(arr);
    renderHnaEdits();
    // Scroll the new paragraph into view
    setTimeout(function () {
      var body = document.getElementById('hna-doc-body');
      if (!body) return;
      var last = body.querySelector('.hna-ai-edit-wrap:last-child');
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return true;
  }
  window.__applyHnaParagraph = applyHnaParagraph;
  window.__renderHnaEdits    = renderHnaEdits;
  window.__renderHnaChapter  = renderHnaChapter;

  /* Apply a chart/data widget into the current HNA chapter as an inline
   * figure (rendered by the same code as dashboard tiles). Allows the AI
   * to back up a paragraph with a visual without leaving the doc. */
  function applyHnaWidget(widget) {
    if (!widget) return false;
    var edit = {
      heading: widget.title || '',
      text:    widget.subtitle || '',
      widget:  widget,     // full widget spec for the renderer
      chapter: currentChapterSlug(),
      ts:      Date.now(),
      accepted: false,
    };
    var arr = readHnaEdits();
    arr.push(edit);
    writeHnaEdits(arr);
    renderHnaEdits();
    setTimeout(function () {
      var body = document.getElementById('hna-doc-body');
      if (!body) return;
      var last = body.querySelector('.hna-ai-edit-wrap:last-child');
      if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 120);
    return true;
  }
  window.__applyHnaWidget = applyHnaWidget;

  /* Cross-page bridge · sends a dashboard/maps widget into an HNA chapter as
   * an inline figure. Writes directly to the HNA edits store + offers a CTA
   * to jump to the chapter. */
  function addWidgetToHnaChapter(widget, chapterSlug) {
    if (!widget || !chapterSlug || !window.__HNA_CHAPTERS) {
      showToast('Bridge not available', 'warn'); return false;
    }
    var ch = window.__HNA_CHAPTERS[chapterSlug];
    if (!ch) { showToast('Chapter not found', 'warn'); return false; }
    var edit = {
      heading: widget.title || '',
      text:    widget.subtitle || '',
      widget:  JSON.parse(JSON.stringify(widget)),  // clone
      chapter: chapterSlug,
      ts:      Date.now(),
      accepted: false,
    };
    var arr = readHnaEdits();
    arr.push(edit);
    writeHnaEdits(arr);
    var chapterName = ch.title.replace(/<[^>]+>/g, '');
    showToast('Added to HNA · Ch ' + ch.num + ' ' + chapterName, 'success');
    // Show a floating "Open chapter" CTA so the user can jump immediately
    var cta = document.createElement('div');
    cta.className = 'hna-bridge-cta';
    cta.innerHTML =
      '<span class="hbc-l">Widget sent to <strong>Ch ' + escHtml(ch.num) + ' · ' + escHtml(chapterName) + '</strong></span>' +
      '<button type="button" class="hbc-go">Open chapter →</button>' +
      '<button type="button" class="hbc-x" aria-label="Dismiss">×</button>';
    document.body.appendChild(cta);
    setTimeout(function () { cta.classList.add('is-open'); }, 20);
    cta.querySelector('.hbc-go').addEventListener('click', function () { window.location.href = '/hna/#' + chapterSlug; });
    cta.querySelector('.hbc-x').addEventListener('click', function () {
      cta.classList.remove('is-open');
      setTimeout(function () { try { cta.remove(); } catch (_) {} }, 300);
    });
    setTimeout(function () {
      if (cta.parentNode) { cta.classList.remove('is-open'); setTimeout(function () { try { cta.remove(); } catch (_) {} }, 300); }
    }, 8000);
    return true;
  }
  window.__addWidgetToHnaChapter = addWidgetToHnaChapter;

  /* Export current chapter as Markdown */
  function exportHnaChapterMd() {
    var slug = currentChapterSlug();
    var ch = HNA_CHAPTERS[slug];
    if (!ch) return;
    var body = document.getElementById('hna-doc-body');
    if (!body) return;
    var title = (ch.title || '').replace(/<\/?em>/g, '*').replace(/<[^>]+>/g, '');
    var lines = [
      '# ' + title,
      '',
      '> SEMPHN HNA 2025-28 · Chapter ' + ch.num + ' · ' + (ch.subtitle || ''),
      '> Exported ' + new Date().toUTCString(),
      '',
      '---',
      '',
    ];
    // Walk DOM in order, mapping h2/p
    Array.prototype.forEach.call(body.children, function (el) {
      if (el.tagName === 'P' && el.classList.contains('deck')) {
        lines.push('**' + el.textContent.trim() + '**');
        lines.push('');
      } else if (el.tagName === 'H2') {
        lines.push('## ' + el.textContent.trim());
        lines.push('');
      } else if (el.tagName === 'P') {
        lines.push(el.textContent.trim());
        lines.push('');
      } else if (el.classList.contains('hna-ai-edit-wrap')) {
        var h = el.querySelector('h2');
        if (h) { lines.push('## ' + h.textContent.trim()); lines.push(''); }
        var p = el.querySelector('p');
        if (p) { lines.push(p.textContent.trim()); lines.push(''); }
      }
    });
    // Sources
    var sourcesBox = document.getElementById('hna-doc-sources');
    if (sourcesBox && !sourcesBox.hasAttribute('hidden')) {
      lines.push('---');
      lines.push('');
      lines.push('## Sources');
      lines.push('');
      Array.prototype.forEach.call(sourcesBox.querySelectorAll('.srcs-row'), function (row) {
        lines.push('- **' + row.querySelector('.srcs-id').textContent + '** · ' + row.querySelector('.srcs-lab').textContent);
      });
      lines.push('');
    }
    var md = lines.join('\n');
    triggerDownload(md, 'semphn-hna-' + slug + '-' + isoStamp() + '.md', 'text/markdown;charset=utf-8');
    showToast('Exported chapter ' + ch.num, 'success');
  }
  window.__exportHnaChapterMd = exportHnaChapterMd;

  function isoStamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }
  function triggerDownload(content, filename, mime) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1000);
  }

  /* Export the FULL HNA · all 12 chapters bundled with cover + TOC */
  function exportHnaFullMd() {
    var date = new Date();
    var lines = [
      '# SEMPHN Health Needs Assessment 2025-28',
      '',
      '> South Eastern Melbourne PHN · annual update',
      '> Exported ' + date.toUTCString(),
      '> Lodgement target · PPERS · 15 Nov 2026',
      '',
      '---',
      '',
      '## Table of contents',
      '',
    ];
    var slugs = Object.keys(HNA_CHAPTERS);
    slugs.forEach(function (s) {
      var ch = HNA_CHAPTERS[s];
      var pct = computeChapterCompletion(s);
      var titleClean = ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '');
      lines.push('- **Ch ' + ch.num + ' · ' + titleClean + '** — ' + pct + '% complete');
    });
    lines.push(''); lines.push('---'); lines.push('');
    var edits = readHnaEdits();
    slugs.forEach(function (s) {
      var ch = HNA_CHAPTERS[s];
      var titleClean = ch.title.replace(/<\/?em>/g, '*').replace(/<[^>]+>/g, '');
      lines.push('# Chapter ' + ch.num + ' · ' + titleClean);
      lines.push('');
      if (ch.subtitle) { lines.push('*' + ch.subtitle + '*'); lines.push(''); }
      if (ch.deck) {
        lines.push('**' + stripHtml(ch.deck) + '**');
        lines.push('');
      }
      (ch.sections || []).forEach(function (sec) {
        lines.push('## ' + sec.heading);
        lines.push('');
        lines.push(stripHtml(sec.body));
        lines.push('');
      });
      // AI edits for this chapter
      edits.filter(function (e) { return (e.chapter || DEFAULT_HNA_CHAPTER) === s; }).forEach(function (e) {
        if (e.heading) { lines.push('## ' + e.heading); lines.push(''); }
        if (e.text) { lines.push(stripHtml(e.text)); lines.push(''); }
      });
      // Sources
      if (ch.sources && ch.sources.length) {
        lines.push('### Sources'); lines.push('');
        ch.sources.forEach(function (id) {
          lines.push('- **' + id + '** · ' + (SOURCE_LABELS[id] || id));
        });
        lines.push('');
      }
      lines.push('---'); lines.push('');
    });
    triggerDownload(lines.join('\n'), 'semphn-hna-FULL-' + isoStamp() + '.md', 'text/markdown;charset=utf-8');
    showToast('Exported full HNA · ' + slugs.length + ' chapters', 'success');
  }
  window.__exportHnaFullMd = exportHnaFullMd;

  function stripHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return (tmp.textContent || '').trim();
  }

  /* Export current chapter as a Word-compatible .doc file
   * Word opens HTML files cleanly when given proper meta + .doc extension.
   * No external libs needed — the Microsoft Word Pre-2007 HTML format. */
  function exportHnaChapterDoc() {
    var slug = currentChapterSlug();
    var ch = HNA_CHAPTERS[slug];
    if (!ch) return;
    var body = document.getElementById('hna-doc-body');
    if (!body) return;
    var titleClean = ch.title.replace(/<\/?em>/g, '').replace(/<[^>]+>/g, '');
    // Strip our action UI from a clone of the body
    var clone = body.cloneNode(true);
    Array.prototype.forEach.call(clone.querySelectorAll('.hna-ai-edit-actions, .hna-stub, button, .turn-prompt-acts'), function (n) { n.remove(); });
    // Promote AI-edit paragraphs to clean <p>
    Array.prototype.forEach.call(clone.querySelectorAll('.hna-ai-edit'), function (p) {
      p.classList.remove('hna-ai-edit');
      p.removeAttribute('class');
    });
    Array.prototype.forEach.call(clone.querySelectorAll('.hna-ai-edit-wrap'), function (w) {
      w.replaceWith.apply(w, Array.from(w.children));
    });
    var bodyHtml = clone.innerHTML;
    var sourcesHtml = '';
    if (ch.sources && ch.sources.length) {
      sourcesHtml = '<h2>Sources</h2><ul>' + ch.sources.map(function (id) {
        return '<li><strong>' + id + '</strong> · ' + (SOURCE_LABELS[id] || id) + '</li>';
      }).join('') + '</ul>';
    }
    var html =
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">' +
      '<head><meta charset="utf-8"/><title>' + escHtml(titleClean) + '</title>' +
      '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' +
      '<style>' +
        'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#0A0A0A;line-height:1.5;max-width:800px;margin:24pt auto;padding:0 24pt}' +
        'h1{color:#04264E;font-size:24pt;font-weight:400;margin:0 0 12pt;line-height:1.1}' +
        'h2{color:#04264E;font-size:13pt;font-weight:600;margin:18pt 0 6pt}' +
        'h3{color:#04264E;font-size:11pt;font-weight:600;margin:14pt 0 4pt}' +
        '.deck{font-size:12pt;color:#444;border-bottom:1px solid #ddd;padding-bottom:10pt;margin-bottom:14pt}' +
        '.doc-meta{color:#666;font-size:9pt;border-bottom:1px solid #ddd;padding-bottom:8pt;margin-bottom:14pt}' +
        'p{margin:0 0 8pt}' +
        '.chip{background:#E5F4F0;color:#04264E;padding:1pt 4pt;border:1px solid #82D9C4;border-radius:3pt;font-size:10pt}' +
        'ul{margin:6pt 0 12pt 18pt}' +
        'li{margin:2pt 0}' +
      '</style></head><body>' +
      '<div class="doc-meta">SEMPHN HNA 2025-28 · Chapter ' + ch.num + ' · ' + escHtml(ch.subtitle || '') + ' · target ' + (ch.target_words || '—') + ' words</div>' +
      '<h1>' + titleClean + '</h1>' +
      bodyHtml +
      sourcesHtml +
      '</body></html>';
    triggerDownload(html, 'semphn-hna-' + slug + '-' + isoStamp() + '.doc', 'application/msword');
    showToast('Exported chapter ' + ch.num + ' as Word doc', 'success');
  }
  window.__exportHnaChapterDoc = exportHnaChapterDoc;

  /* ============================================================
   * Storage helpers
   * ============================================================ */
  function readSession() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return p && p.email ? p : null;
    } catch (_) { return null; }
  }
  function clearSession() { try { localStorage.removeItem(AUTH_KEY); } catch (_) {} }
  function readState() {
    try {
      var raw = localStorage.getItem(STORE_KEY());
      var s = raw ? JSON.parse(raw) : null;
      return (s && s.byPage) ? s : { byPage: {} };
    } catch (_) { return { byPage: {} }; }
  }
  function writeState(s) { try { localStorage.setItem(STORE_KEY(), JSON.stringify(s)); } catch (_) {} }
  function readUI() {
    try {
      var raw = localStorage.getItem(UI_KEY());
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function writeUI(u) { try { localStorage.setItem(UI_KEY(), JSON.stringify(u)); } catch (_) {} }

  function pageId() { return document.body.getAttribute('data-page') || 'dashboards'; }

  /* ============================================================
   * Auth gate
   * ============================================================ */
  function gate() {
    var sess = readSession();
    if (!sess) {
      var next = location.pathname + location.search + location.hash;
      location.replace(SIGNIN + '?next=' + encodeURIComponent(next));
      return null;
    }
    return sess;
  }
  function hydrateUserPill(session) {
    var pill = document.querySelector('.nav-user');
    if (!pill) return;
    var av  = pill.querySelector('.av');
    var who = pill.querySelector('.meta .who');
    var sub = pill.querySelector('.meta .sub');
    if (av) av.textContent = session.avatar || (session.email ? session.email.charAt(0).toUpperCase() : '?');
    if (who) who.textContent = session.name || session.email || 'Signed in';
    if (sub) sub.textContent = (session.tenantName || 'SEMPHN') + ' · ' + (session.tenantCode || 'PHN108') +
                                 (session.name && session.email ? ' · ' + session.email : '');
    var out = pill.querySelector('button');
    if (out && !out.dataset.bound) {
      out.dataset.bound = '1';
      out.addEventListener('click', function () {
        showToast('Signed out · come back soon', 'success');
        setTimeout(function () { clearSession(); location.href = SIGNIN; }, 500);
      });
    }
  }
  function highlightNav(page) {
    document.querySelectorAll('.nav-link').forEach(function (a) {
      var on = a.dataset.page === page;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ============================================================
   * Resizable + collapsible chat panel
   * ============================================================ */
  function wireResize() {
    var split  = document.querySelector('.split');
    var handle = document.querySelector('.split-handle');
    if (!split || !handle) return;

    var ui = readUI();
    if (ui.chatW)        split.style.setProperty('--chatw', ui.chatW + 'px');
    if (ui.chatCollapsed) split.setAttribute('data-chat-collapsed', 'true');

    // Floating expand-button injected on the canvas side · only visible
    // when chat is collapsed. Without this, a collapsed chat has no
    // visible "re-expand" affordance from outside the panel.
    var canvas = document.querySelector('.canvas');
    var expandBtn = null;
    if (canvas) {
      expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'chat-expand-floating';
      expandBtn.title = 'Show chat panel (⌘\\)';
      expandBtn.setAttribute('aria-label', 'Show chat panel');
      expandBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"/></svg><span>Chat</span>';
      canvas.appendChild(expandBtn);
    }

    function setCollapsed(collapsed) {
      if (collapsed) split.setAttribute('data-chat-collapsed', 'true');
      else           split.removeAttribute('data-chat-collapsed');
      var u = readUI(); u.chatCollapsed = collapsed; writeUI(u);
      var inPanelBtn = document.querySelector('.chat-collapse');
      if (inPanelBtn) {
        inPanelBtn.textContent = collapsed ? '›' : '‹';
        inPanelBtn.title = collapsed ? 'Expand chat panel' : 'Collapse chat panel';
      }
      showToast(collapsed ? 'Chat collapsed · click "Chat" on the left to re-open' : 'Chat panel expanded', 'success');
    }

    var collapseBtn = document.querySelector('.chat-collapse');
    if (collapseBtn) {
      // Reflect initial state
      var initiallyCollapsed = split.getAttribute('data-chat-collapsed') === 'true';
      collapseBtn.textContent = initiallyCollapsed ? '›' : '‹';
      collapseBtn.title = initiallyCollapsed ? 'Expand chat panel' : 'Collapse chat panel';
      collapseBtn.addEventListener('click', function () {
        setCollapsed(split.getAttribute('data-chat-collapsed') !== 'true');
      });
    }
    if (expandBtn) {
      expandBtn.addEventListener('click', function () { setCollapsed(false); });
    }

    var dragging = false, startX = 0, startW = 0;
    function onDown(e) {
      if (split.getAttribute('data-chat-collapsed') === 'true') return;
      dragging = true;
      startX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      var cs = getComputedStyle(split);
      startW = parseInt(cs.getPropertyValue('--chatw'), 10) || 400;
      handle.classList.add('is-dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }
    function onMove(e) {
      if (!dragging) return;
      var x = e.clientX || (e.touches && e.touches[0].clientX) || 0;
      var w = Math.max(320, Math.min(640, startW + (x - startX)));
      split.style.setProperty('--chatw', w + 'px');
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('is-dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      var cs = getComputedStyle(split);
      var w = parseInt(cs.getPropertyValue('--chatw'), 10) || 400;
      var u = readUI(); u.chatW = w; writeUI(u);
    }
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  }

  /* ============================================================
   * Safe markdown rendering for AI replies
   * Supports: **bold**, *italic*, `code`, ```fences```, lists, links,
   * paragraphs. Built bottom-up via createElement — no innerHTML.
   * ============================================================ */
  function renderInline(text, target) {
    // Tokenise a single line for inline marks. Order matters:
    // 1. inline `code` (no further parsing inside)
    // 2. links [label](url)
    // 3. **bold**, *italic*
    var re = /(`[^`]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g;
    var parts = text.split(re);
    parts.forEach(function (p) {
      if (!p) return;
      if (p[0] === '`' && p[p.length - 1] === '`') {
        var code = document.createElement('code');
        code.textContent = p.slice(1, -1);
        target.appendChild(code);
      } else if (p.indexOf('[') === 0) {
        var m = p.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (m) {
          var a = document.createElement('a');
          a.textContent = m[1];
          // Only allow http(s) + mailto. Reject other schemes silently.
          if (/^(https?:|mailto:)/i.test(m[2])) { a.href = m[2]; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
          target.appendChild(a);
        } else {
          target.appendChild(document.createTextNode(p));
        }
      } else if (p.slice(0, 2) === '**' && p.slice(-2) === '**') {
        var st = document.createElement('strong');
        st.textContent = p.slice(2, -2);
        target.appendChild(st);
      } else if (p[0] === '*' && p[p.length - 1] === '*' && p.length > 2) {
        var em = document.createElement('em');
        em.textContent = p.slice(1, -1);
        target.appendChild(em);
      } else {
        target.appendChild(document.createTextNode(p));
      }
    });
  }
  function renderMarkdown(md, container) {
    if (!md) return;
    var lines = String(md).split(/\n/);
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      // Code fence
      if (/^```/.test(line)) {
        var code = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // skip closing fence
        var pre = document.createElement('pre');
        var cc = document.createElement('code');
        cc.textContent = code.join('\n');
        pre.appendChild(cc);
        container.appendChild(pre);
        continue;
      }
      // Bullet list
      if (/^\s*[-*]\s+/.test(line)) {
        var ul = document.createElement('ul');
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          var li = document.createElement('li');
          renderInline(lines[i].replace(/^\s*[-*]\s+/, ''), li);
          ul.appendChild(li);
          i++;
        }
        container.appendChild(ul);
        continue;
      }
      // Numbered list
      if (/^\s*\d+\.\s+/.test(line)) {
        var ol = document.createElement('ol');
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          var li2 = document.createElement('li');
          renderInline(lines[i].replace(/^\s*\d+\.\s+/, ''), li2);
          ol.appendChild(li2);
          i++;
        }
        container.appendChild(ol);
        continue;
      }
      // Paragraph (group consecutive non-blank lines)
      if (line.trim()) {
        var buf = [];
        while (i < lines.length && lines[i].trim() && !/^```|^\s*[-*]\s+|^\s*\d+\.\s+/.test(lines[i])) {
          buf.push(lines[i]); i++;
        }
        var p = document.createElement('p');
        renderInline(buf.join(' '), p);
        container.appendChild(p);
        continue;
      }
      i++;
    }
  }

  /* ============================================================
   * Chat feed render
   * ============================================================ */
  function getPageTurns(page) {
    var s = readState();
    if (!s.byPage[page]) s.byPage[page] = [];   // CLEAN START — no seed turn
    return s.byPage[page];
  }
  function setPageTurns(page, turns) {
    var s = readState();
    s.byPage[page] = turns;
    writeState(s);
  }

  function buildTurnNode(turn) {
    var wrap = document.createElement('div'); wrap.className = 'turn';

    var pr = document.createElement('div'); pr.className = 'turn-prompt';
    var pTxt = document.createElement('div'); pTxt.className = 'text';
    pTxt.textContent = turn.prompt || '';
    var pAv = document.createElement('div'); pAv.className = 'avatar';
    pAv.textContent = turn.avatar || 'U';
    // Action chips on hover · edit (load back into composer) + retry
    var pActs = document.createElement('div'); pActs.className = 'turn-prompt-acts';
    var editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'turn-act-btn'; editBtn.title = 'Edit and resend'; editBtn.setAttribute('aria-label', 'Edit prompt');
    editBtn.innerHTML = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2.5 13.5 5l-8 8H3v-2.5l8-8Z"/><path d="m10 3.5 2.5 2.5"/></svg>';
    editBtn.addEventListener('click', function () {
      var input = document.getElementById('chat-input');
      if (!input) return;
      input.value = turn.prompt || '';
      input.dispatchEvent(new Event('input'));
      input.focus();
      input.selectionStart = 0;
      input.selectionEnd = input.value.length;
      showToast('Loaded into composer · edit and send', 'success');
    });
    pActs.appendChild(editBtn);
    pr.appendChild(pTxt); pr.appendChild(pActs); pr.appendChild(pAv);
    wrap.appendChild(pr);

    if (turn.reasoning) {
      var rBtn = document.createElement('button');
      rBtn.className = 'turn-section';
      rBtn.setAttribute('aria-expanded', 'true');
      var rCar = document.createElement('span'); rCar.className = 'caret'; rCar.textContent = '▾';
      rBtn.appendChild(document.createTextNode('Reasoning '));
      rBtn.appendChild(rCar);
      var rBody = document.createElement('div'); rBody.className = 'turn-reasoning';
      rBody.textContent = turn.reasoning;
      rBtn.addEventListener('click', function () {
        var open = rBtn.getAttribute('aria-expanded') === 'true';
        rBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
        rBody.hidden = open;
      });
      wrap.appendChild(rBtn);
      wrap.appendChild(rBody);
    }

    if (turn.files && turn.files.length) {
      var fBtn = document.createElement('button');
      fBtn.className = 'turn-section';
      fBtn.setAttribute('aria-expanded', 'true');
      var fCar = document.createElement('span'); fCar.className = 'caret'; fCar.textContent = '▾';
      fBtn.appendChild(document.createTextNode((turn.filesLabel || ('Worked with ' + turn.files.length + ' files')) + ' '));
      fBtn.appendChild(fCar);
      var fBody = document.createElement('div'); fBody.className = 'turn-files';
      var ul = document.createElement('ul'); ul.className = 'turn-files-list';
      turn.files.forEach(function (f) { var li = document.createElement('li'); li.textContent = f; ul.appendChild(li); });
      fBody.appendChild(ul);
      fBtn.addEventListener('click', function () {
        var open = fBtn.getAttribute('aria-expanded') === 'true';
        fBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
        fBody.hidden = open;
      });
      wrap.appendChild(fBtn);
      wrap.appendChild(fBody);
    }

    if (turn.thinking) {
      var th = document.createElement('div'); th.className = 'turn-thinking';
      var label = document.createElement('span'); label.className = 'turn-thinking-label';
      label.textContent = 'Reading SEMPHN data';
      th.appendChild(label);
      var dots = document.createElement('span'); dots.className = 'dots';
      dots.appendChild(document.createElement('span'));
      dots.appendChild(document.createElement('span'));
      dots.appendChild(document.createElement('span'));
      th.appendChild(dots);
      // Stop button · cancels in-flight generation via __chatAbort
      var stopBtn = document.createElement('button');
      stopBtn.type = 'button'; stopBtn.className = 'turn-stop'; stopBtn.title = 'Stop generating';
      stopBtn.innerHTML = '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg><span>Stop</span>';
      stopBtn.addEventListener('click', function () {
        if (typeof window.__chatAbort === 'function') window.__chatAbort();
      });
      th.appendChild(stopBtn);
      // Rotate the label through page-aware stages every 1.4s while thinking
      var stages = THINKING_STAGES[pageId()] || THINKING_STAGES._default;
      var stageIdx = 0;
      var timer = setInterval(function () {
        if (!document.body.contains(th)) { clearInterval(timer); return; }
        stageIdx = (stageIdx + 1) % stages.length;
        label.style.opacity = '0';
        setTimeout(function () {
          label.textContent = stages[stageIdx];
          label.style.opacity = '1';
        }, 180);
      }, 1400);
      th.dataset.timer = String(timer);
      wrap.appendChild(th);
    }

    if (turn.summary) {
      var bod = document.createElement('div'); bod.className = 'turn-body';
      renderMarkdown(turn.summary, bod);
      // Copy-reply button · floats top-right of the body, only visible on hover
      var copyBtn = document.createElement('button');
      copyBtn.type = 'button'; copyBtn.className = 'turn-body-copy'; copyBtn.title = 'Copy reply';
      copyBtn.innerHTML = '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="9" height="11" rx="1.4"/><path d="M11 13v1.4A0.6.6 0 0 1 10.4 15H2.6A0.6.6 0 0 1 2 14.4V4.6A0.6.6 0 0 1 2.6 4H4"/></svg>';
      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(turn.summary).then(function () {
            copyBtn.classList.add('is-done');
            showToast('Reply copied to clipboard', 'success');
            setTimeout(function () { copyBtn.classList.remove('is-done'); }, 1500);
          }).catch(function () { showToast('Copy failed', 'warn'); });
        }
      });
      bod.appendChild(copyBtn);
      wrap.appendChild(bod);
    }

    if (turn.version) {
      var v = document.createElement('div'); v.className = 'turn-version';
      var m = document.createElement('div'); m.className = 'meta';
      var h = document.createElement('div'); h.className = 'h'; h.textContent = turn.version.title;
      var vt = document.createElement('div'); vt.className = 'v'; vt.textContent = turn.version.tag;
      m.appendChild(h); m.appendChild(vt);
      var kb = document.createElement('button'); kb.className = 'kebab'; kb.textContent = '⋯'; kb.setAttribute('aria-label', 'More');
      v.appendChild(m); v.appendChild(kb);
      wrap.appendChild(v);
    }

    if (turn.summary) {
      var fb = document.createElement('div'); fb.className = 'turn-feedback';
      [
        { sym: '👍',  cls: 'fb-up',    tip: 'Helpful' },
        { sym: '👎',  cls: 'fb-down',  tip: 'Not helpful' },
        { sym: '↻',  cls: 'fb-retry', tip: 'Retry — re-fire this prompt as a new turn' },
      ].forEach(function (def) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = def.sym; b.title = def.tip;
        b.className = def.cls;
        b.addEventListener('click', function () {
          if (def.sym === '↻') {
            // Actually retry · re-fire the prompt as a new turn
            var input = document.getElementById('chat-input');
            var send  = document.getElementById('chat-send');
            if (!input || !turn.prompt) return;
            input.value = turn.prompt;
            input.dispatchEvent(new Event('input'));
            input.focus();
            if (send && !send.disabled) send.click();
            return;
          }
          b.classList.toggle('is-on');
          if (def.sym === '👍') showToast('Thanks — saved as helpful', 'success');
          else if (def.sym === '👎') showToast('Noted — saved as not helpful', 'warn');
        });
        fb.appendChild(b);
      });
      wrap.appendChild(fb);
    }

    if (turn.warnings) {
      var wn = document.createElement('div'); wn.className = 'turn-warnings';
      var lbl = document.createElement('div'); lbl.className = 'label';
      lbl.appendChild(document.createTextNode(turn.warnings.label || (turn.warnings.count + ' warnings')));
      var right = document.createElement('div'); right.className = 'right';
      var fix = document.createElement('button'); fix.type = 'button'; fix.className = 'fix'; fix.textContent = 'Fix for me';
      fix.addEventListener('click', function () { showToast('Fix-for-me queued', 'success'); });
      var close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×';
      close.addEventListener('click', function () { wn.remove(); });
      right.appendChild(fix); right.appendChild(close);
      wn.appendChild(lbl); wn.appendChild(right);
      wrap.appendChild(wn);
    }

    /* Follow-up chips · "help them build as we go".
     * We attach 2-3 next-step prompts to every turn that has a summary,
     * driven by the widget type if the turn produced a widget, otherwise
     * by the page (HNA gets critique chips, Maps gets overlay chips). */
    if (turn.summary && turn.followups && turn.followups.length) {
      var fu = document.createElement('div'); fu.className = 'turn-followups';
      var fuLab = document.createElement('div'); fuLab.className = 'turn-followups-label';
      fuLab.textContent = 'Next';
      fu.appendChild(fuLab);
      var fuRow = document.createElement('div'); fuRow.className = 'turn-followups-row';
      turn.followups.forEach(function (sug) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'turn-followup-chip';
        var arr = document.createElement('span'); arr.className = 'arr'; arr.textContent = '→';
        var lab = document.createElement('span'); lab.textContent = sug.label;
        chip.appendChild(arr); chip.appendChild(lab);
        chip.addEventListener('click', function () {
          var input = document.getElementById('chat-input');
          var send  = document.getElementById('chat-send');
          if (!input || !send) return;
          input.value = sug.prompt;
          input.dispatchEvent(new Event('input'));
          if (!send.disabled) send.click();
        });
        fuRow.appendChild(chip);
      });
      fu.appendChild(fuRow);
      wrap.appendChild(fu);
    }

    return wrap;
  }

  /* Pick 2-3 follow-up chips for a freshly completed turn.
   * If the turn produced a widget on the dashboards page, key off the
   * widget type. Otherwise use a per-page default set. */
  /* Topic-aware proxy suggestions · when the user asked about something we
   * don't have data for, the AI's reply will say "I don't have…" and we
   * surface alternative actions tied to the user's actual topic. Keys are
   * lowercase substrings found in the prompt; values are 2-3 chips. */
  var TOPIC_PROXIES = {
    'school': [
      { label: '⚡ Youth services map',   mapTemplate: 'youth-services' },
      { label: '⚡ School density map',   mapTemplate: 'school-density' },
      { label: 'Open DET Find My School', prompt: 'Where can I get authoritative school location + enrolment data for the SEMPHN catchment? Reply in prose, no widget.' },
    ],
    'kinder': [
      { label: 'Map % aged 0-4',          prompt: 'Map % of residents aged 0-4 by SEMPHN LGA. Unit pct.' },
      { label: 'Map youth services',      mapTemplate: 'youth-services' },
    ],
    'child': [
      { label: '⚡ Youth services map',   mapTemplate: 'youth-services' },
      { label: 'Map % aged 0-17',         prompt: 'Map % of residents aged 0-17 by SEMPHN LGA. Unit pct.' },
    ],
    'crime': [
      { label: 'Map SEIFA disadvantage',  prompt: 'Map ABS SEIFA disadvantage decile by SEMPHN LGA. Highlight Greater Dandenong. Unit count.' },
      { label: 'CSA Victoria',            prompt: 'Where can I get authoritative crime statistics for the SEMPHN catchment? Reply in prose, no widget.' },
    ],
    'safety': [
      { label: 'Map SEIFA disadvantage',  prompt: 'Map ABS SEIFA disadvantage decile by SEMPHN LGA. Highlight Greater Dandenong. Unit count.' },
    ],
    'transport': [
      { label: 'Map SEIFA disadvantage',  prompt: 'Map ABS SEIFA disadvantage decile by SEMPHN LGA — proxy for transport-disadvantaged areas.' },
      { label: 'PTV / DoT VicRoads',      prompt: 'Where can I get authoritative public transport coverage data for the SEMPHN catchment? Reply in prose, no widget.' },
    ],
    'housing': [
      { label: '⚡ Homelessness map',     mapTemplate: 'homelessness' },
      { label: 'Map housing strain',      prompt: 'Map % of households needing additional bedrooms by SEMPHN LGA — proxy for housing strain.' },
    ],
    'rent': [
      { label: '⚡ Homelessness map',     mapTemplate: 'homelessness' },
    ],
    'employment': [
      { label: 'Map SEIFA disadvantage',  prompt: 'Map ABS SEIFA disadvantage decile by SEMPHN LGA. Unit count.' },
      { label: 'Map First Nations IRSEO', mapTemplate: 'first-nations' },
    ],
    'income': [
      { label: 'Map SEIFA disadvantage',  prompt: 'Map ABS SEIFA disadvantage decile by SEMPHN LGA. Unit count.' },
    ],
    'specialist': [
      { label: '⚡ GP supply map',        mapTemplate: 'gp-supply' },
      { label: 'AHPRA Practitioner Register', prompt: 'Where can I get authoritative specialist workforce data for the SEMPHN catchment? Reply in prose, no widget.' },
    ],
    'hospital': [
      { label: 'Add hospital markers',    mapPoints: ['hospital'] },
      { label: 'AIHW My Hospitals',       prompt: 'Where can I get authoritative public hospital activity data for the SEMPHN catchment? Reply in prose, no widget.' },
    ],
    'gp': [
      { label: '⚡ GP supply map',        mapTemplate: 'gp-supply' },
      { label: 'Add GP markers',          mapPoints: ['gp'] },
    ],
    'cancer': [
      { label: '⚡ Bowel screening gap',  mapTemplate: 'screening-gap' },
    ],
    'screening': [
      { label: '⚡ Bowel screening gap',  mapTemplate: 'screening-gap' },
    ],
    'indigenous': [
      { label: '⚡ First Nations map',    mapTemplate: 'first-nations' },
    ],
    'aboriginal': [
      { label: '⚡ First Nations map',    mapTemplate: 'first-nations' },
    ],
  };

  function noDataReply(text) {
    if (!text) return false;
    var t = text.toLowerCase();
    return /(\bi['’]?m unable\b|\bisn['’]?t available\b|\bnot in the (current )?dataset\b|\bdon['’]?t have (data|that|access)\b|\bno data\b|\bunable to provide\b|\bcannot provide\b|\bsorry[,.]?\s+i\b)/i.test(t);
  }
  /* Punt detector · catches "Would you like me to draft that?" style replies
   * where the AI asks permission instead of just doing the work. Surfaces
   * a 'Yes, do it now' chip that re-fires the SAME prompt with explicit
   * permission framing so the AI can't dodge a second time. */
  function isPuntReply(text) {
    if (!text) return false;
    var t = text.toLowerCase();
    return /(would you like (me )?to|shall i (proceed|draft|continue)|let me know if you('|')?d like|would you like to proceed|do you want me to|should i (draft|proceed|continue))/i.test(t);
  }
  window.__isPuntReply = isPuntReply;
  function topicChipsFor(promptText) {
    if (!promptText) return null;
    var lc = promptText.toLowerCase();
    var matched = [];
    Object.keys(TOPIC_PROXIES).forEach(function (k) {
      if (lc.indexOf(k) >= 0) {
        TOPIC_PROXIES[k].forEach(function (c) {
          // Dedupe by label
          if (!matched.some(function (m) { return m.label === c.label; })) matched.push(c);
        });
      }
    });
    return matched.length ? matched.slice(0, 4) : null;
  }

  function pickFollowups(turn, widget) {
    var page = pageId();
    // Universal · punt detection: if the AI asked permission instead of just
    // doing the work, surface a single "Yes, do it now" chip that re-fires
    // the SAME prompt with explicit permission framing so the model can't
    // dodge a second time.
    if (turn && isPuntReply(turn.summary)) {
      return [
        { label: '✓ Yes, do it now — don\'t ask permission',
          prompt: (turn.prompt || '') + '\n\nDo it now — don\'t ask permission, don\'t hedge, don\'t say the data is insufficient. Use the SEMPHN ground truth + sample patterns to produce the output directly.' },
        { label: '↺ Try a tighter version',
          prompt: 'Rewrite that as a 60-word paragraph using actual SEMPHN figures from the ground truth block. Heading: pick the most useful one. New paragraph.' },
      ];
    }
    // Universal: if the AI's reply admits no data, surface topic-relevant
    // proxies based on what the user actually asked. This rescues every
    // out-of-scope ask with concrete, clickable next steps.
    if (turn && noDataReply(turn.summary)) {
      var topic = topicChipsFor(turn.prompt);
      if (topic) return topic;
    }
    if (page === 'dashboards') {
      return getFollowups(widget);
    }
    if (page === 'hna') {
      // Chapter-aware: re-use the same state-derived actions the always-on
      // guide panel uses, so what the user sees after a reply mirrors what
      // they'd see if they looked up. Filter out the auto-draft chip (it
      // belongs to the stub empty state, not in-conversation flow).
      if (typeof chapterState === 'function') {
        try {
          var state = chapterState(currentChapterSlug());
          var actions = state ? pickChapterActions(state).filter(function (a) {
            return a.action !== 'auto-draft' && a.prompt;
          }) : [];
          if (actions.length) {
            return actions.slice(0, 4).map(function (a) {
              return { label: a.label, prompt: a.prompt };
            });
          }
        } catch (_) {}
      }
      // Fallback when the chapter helpers aren't loaded yet
      if (widget && widget.type === 'paragraph') {
        return [
          { label: 'Tighten by 25%',        prompt: 'Draft a tightened version of the paragraph you just wrote — 25% shorter without losing any figure. New paragraph, append to doc.' },
          { label: 'Strengths-based rewrite', prompt: 'Draft a strengths-based rewrite of the paragraph you just wrote. Same figures, more agency-centred framing. New paragraph.' },
          { label: 'Add a methods footnote', prompt: 'Draft a methods footnote paragraph for the figures in the paragraph you just wrote. Heading: "Methods · sources + caveats".' },
        ];
      }
      return [
        { label: 'Draft next section',   prompt: 'Draft the next section of this chapter — pick the area that is weakest in the current draft.' },
        { label: 'Executive summary',    prompt: 'Draft a 3-sentence executive summary of this chapter — paragraph, heading: "Executive summary".' },
        { label: 'DoH critique',         prompt: 'Critique the current draft against the DoH Performance Rubric. Reply in prose, no widget.' },
      ];
    }
    if (page === 'maps') {
      // After a successful map render, suggest related layers
      if (widget && (widget.type === 'choropleth' || widget.type === 'map')) {
        return [
          { label: '+ Add headspace markers', mapPoints: ['headspace'] },
          { label: '+ Add ACCHS markers',     mapPoints: ['acchs'] },
          { label: '+ Add hospitals',         mapPoints: ['hospital'] },
        ];
      }
      return [
        { label: '⚡ Mental health hotspots', mapTemplate: 'mh-hotspots' },
        { label: '⚡ Service network',        mapTemplate: 'service-network' },
        { label: '⚡ Equity overlay',         mapTemplate: 'equity' },
      ];
    }
    return [];
  }

  function buildEmptyState() {
    var page = pageId();
    var meta = PAGE_META[page] || PAGE_META.dashboards;
    var sugs = SUGGESTIONS[page] || [];

    var wrap = document.createElement('div');
    wrap.className = 'chat-empty';

    var badge = document.createElement('span');
    badge.className = 'chat-empty-badge';
    var dot = document.createElement('span'); dot.className = 'dot';
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode('Workbench · ' + page.toUpperCase() + ' · ready'));
    wrap.appendChild(badge);

    var h2 = document.createElement('h2');
    h2.className = 'chat-empty-h';
    var heads = {
      hna:        'What chapter shall we work on?',
      dashboards: 'What metric shall we visualise?',
      maps:       'What should we map?',
    };
    h2.textContent = heads[page] || 'How can I help?';
    wrap.appendChild(h2);

    var p = document.createElement('p');
    p.className = 'chat-empty-lead';
    var leads = {
      hna:        'Ask the workbench to draft, revise or critique any HNA chapter. The document on the right updates as you go.',
      dashboards: 'Ask in plain English. A SEMPHN-themed chart lands on the right. Pin it, restyle it, or drop it into the HNA.',
      maps:       'Choropleth, point-overlay or heat — all rendered against the SEMPHN 10-LGA catchment. Export as PNG.',
    };
    p.textContent = leads[page] || meta.placeholder;
    wrap.appendChild(p);

    // Suggestions are now grouped into sections. The list under each section
    // header is a tighter version of the empty-state — easier to scan, gives
    // each chip a category context.
    function fireSuggestion(prompt) {
      var input = document.getElementById('chat-input');
      if (!input) return;
      input.value = prompt;
      input.dispatchEvent(new Event('input'));
      input.focus();
      var send = document.getElementById('chat-send');
      if (send && !send.disabled) send.click();
    }
    // Backwards-compat: support both legacy flat array AND new grouped shape.
    var groups = Array.isArray(sugs) && sugs.length && sugs[0].section
      ? sugs
      : [{ section: 'Try one of these', items: sugs || [] }];
    groups.forEach(function (group) {
      var label = document.createElement('div');
      label.className = 'chat-empty-suglabel';
      label.textContent = group.section;
      wrap.appendChild(label);
      var grid = document.createElement('div'); grid.className = 'chat-empty-sugs';
      (group.items || []).forEach(function (s) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chat-empty-sug';
        var ic = document.createElement('span'); ic.className = 'ico'; ic.textContent = s.icon || '·';
        var lab = document.createElement('span'); lab.className = 'label'; lab.textContent = s.label;
        btn.appendChild(ic); btn.appendChild(lab);
        // Template hover preview · for dashboard templates, show the tile
        // titles before the user commits. Same idea applies to map templates.
        if (s.template && window.__DASHBOARD_TEMPLATES) {
          var tpl = window.__DASHBOARD_TEMPLATES[s.template];
          if (tpl && tpl.length) {
            btn.classList.add('has-preview');
            btn.title = tpl.map(function (w) { return '• ' + (w.title || ''); }).join('\n');
            // Build a richer custom tooltip
            btn.addEventListener('mouseenter', function () { showTemplatePreview(btn, tpl, s.label); });
            btn.addEventListener('mouseleave', hideTemplatePreview);
          }
        }
        if (s.mapTemplate && window.__MAP_TEMPLATES) {
          var mt = window.__MAP_TEMPLATES[s.mapTemplate];
          if (mt) {
            btn.classList.add('has-preview');
            var items = [];
            if (mt.choropleth) items.push('• ' + (mt.choropleth.title || 'Choropleth'));
            (mt.layers || []).forEach(function (k) {
              var st = SERVICE_STYLE[k]; items.push('• ' + (st && st.plural || k) + ' overlay');
            });
            btn.title = items.join('\n');
            btn.addEventListener('mouseenter', function () { showMapTemplatePreview(btn, mt, s.label); });
            btn.addEventListener('mouseleave', hideTemplatePreview);
          }
        }
        btn.addEventListener('click', function () {
          // Three flavours of chips:
          //   template       → dashboard preset (loadDashboardTemplate)
          //   mapTemplate    → map preset (loadMapTemplate)
          //   mapPoints      → drop a point layer onto the map
          //   prompt         → fire as a chat prompt
          if (s.template && typeof window.__loadDashboardTemplate === 'function') {
            window.__loadDashboardTemplate(s.template);
          } else if (s.mapTemplate && typeof window.__loadMapTemplate === 'function') {
            window.__loadMapTemplate(s.mapTemplate);
          } else if (s.mapPoints && window.__defaultMapApi) {
            window.__defaultMapApi.applyPoints(s.mapPoints, { fit: true });
            var first = (s.mapPoints[0] || '').toString();
            showToast('Added ' + (SERVICE_STYLE[first] && SERVICE_STYLE[first].plural || first) + ' to the map', 'success');
          } else if (s.prompt) {
            fireSuggestion(s.prompt);
          }
        });
        grid.appendChild(btn);
      });
      wrap.appendChild(grid);
    });

    var hint = document.createElement('div');
    hint.className = 'chat-empty-hint';
    hint.appendChild(document.createTextNode('Or write your own — press '));
    var k1 = document.createElement('kbd'); k1.textContent = '⌘K'; hint.appendChild(k1);
    hint.appendChild(document.createTextNode(' for commands · '));
    var k2 = document.createElement('kbd'); k2.textContent = '⌘/'; hint.appendChild(k2);
    hint.appendChild(document.createTextNode(' to focus the composer'));
    wrap.appendChild(hint);

    return wrap;
  }

  function renderFeed() {
    var feed = document.getElementById('chat-feed');
    if (!feed) return;
    while (feed.firstChild) feed.removeChild(feed.firstChild);
    var turns = getPageTurns(pageId());
    if (turns.length === 0) {
      feed.appendChild(buildEmptyState());
    } else {
      turns.forEach(function (t) { feed.appendChild(buildTurnNode(t)); });
      feed.scrollTop = feed.scrollHeight;
    }
    // Refresh declutter state + msg count + clear-btn enabled
    if (typeof window.__syncChatState === 'function') window.__syncChatState();
  }

  /* ============================================================
   * Composer
   * ============================================================ */
  /* Slash command templates — Notion/Linear-style power-user shortcut.
   * Type "/" at start of composer → menu opens; arrow + enter to insert. */
  var SLASH_COMMANDS = [
    { trigger: '/bar',    label: 'Bar chart',     hint: 'Compare across LGAs',          template: 'Build a bar chart of __METRIC__ by LGA, ranked highest to lowest. Highlight __TOP_LGA__.' },
    { trigger: '/line',   label: 'Line chart',    hint: 'Trend over time',              template: 'Build a line chart of __METRIC__ over the last 5 years for the SEMPHN catchment.' },
    { trigger: '/area',   label: 'Area chart',    hint: 'Trend with magnitude',         template: 'Build an area chart of __METRIC__ over the last 5 financial years for the SEMPHN catchment.' },
    { trigger: '/donut',  label: 'Donut chart',   hint: 'Share of total',               template: 'Build a donut chart of __METRIC__ broken down by __CATEGORY__.' },
    { trigger: '/kpi',    label: 'KPI tile',      hint: 'Single headline number',       template: 'Add a KPI tile for __METRIC__ with the year-on-year delta.' },
    { trigger: '/table',  label: 'Table',         hint: 'Mixed columns',                template: 'Build a table widget with columns: __COL_1__, __COL_2__, __COL_3__.' },
    { trigger: '/map',    label: 'Choropleth',    hint: 'Map by LGA',                   template: 'Build a choropleth of __METRIC__ across the 10 SEMPHN LGAs. Highlight __TOP_LGA__.' },
    { trigger: '/draft',  label: 'Draft paragraph', hint: 'HNA narrative',              template: 'Draft a paragraph for the HNA on __TOPIC__ — anchor it on real SEMPHN figures from the data slice.' },
    { trigger: '/critique', label: 'Critique',    hint: 'DoH-rubric style review',      template: 'Critique the current draft against the DoH Performance Rubric. List the top 3 gaps.' },
  ];
  function wireSlashMenu(input, send) {
    var menu = null, cursor = 0, filtered = SLASH_COMMANDS.slice();
    function close() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
    }
    function shouldOpen() {
      var v = input.value;
      // Open if the whole field starts with "/" — keeps things deterministic
      return v[0] === '/' && v.indexOf(' ') < 0 && v.indexOf('\n') < 0;
    }
    function refresh() {
      var q = input.value.toLowerCase();
      filtered = SLASH_COMMANDS.filter(function (c) {
        return c.trigger.indexOf(q) === 0 || c.label.toLowerCase().indexOf(q.slice(1)) >= 0;
      });
      cursor = 0;
      render();
    }
    function render() {
      if (!shouldOpen()) { close(); return; }
      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'slash-menu';
        // Position relative to the composer-wrap (textarea parent)
        var wrap = input.closest('.composer-wrap') || input.parentNode;
        var rect = wrap.getBoundingClientRect();
        menu.style.left  = rect.left + 'px';
        menu.style.width = rect.width + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        document.body.appendChild(menu);
      }
      while (menu.firstChild) menu.removeChild(menu.firstChild);
      if (!filtered.length) {
        var none = document.createElement('div'); none.className = 'slash-menu-empty';
        none.textContent = 'No matching commands. Press Esc.';
        menu.appendChild(none); return;
      }
      filtered.forEach(function (c, i) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'slash-menu-item' + (i === cursor ? ' is-on' : '');
        var trig = document.createElement('span'); trig.className = 'trig'; trig.textContent = c.trigger;
        var lab  = document.createElement('span'); lab.className  = 'lab';  lab.textContent  = c.label;
        var hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = c.hint;
        item.appendChild(trig); item.appendChild(lab); item.appendChild(hint);
        item.addEventListener('mouseenter', function () { cursor = i; render(); });
        item.addEventListener('mousedown', function (e) { e.preventDefault(); insert(c); });
        menu.appendChild(item);
      });
    }
    function insert(c) {
      input.value = c.template;
      input.dispatchEvent(new Event('input'));
      // Move cursor to first placeholder
      var pos = input.value.indexOf('__');
      if (pos >= 0) { input.selectionStart = pos; input.selectionEnd = input.value.indexOf('__', pos + 2) + 2; }
      input.focus();
      close();
    }
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', function (e) {
      if (!menu) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % filtered.length; render(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); cursor = (cursor - 1 + filtered.length) % filtered.length; render(); return; }
      if (e.key === 'Enter' && filtered[cursor]) { e.preventDefault(); insert(filtered[cursor]); return; }
      if (e.key === 'Tab' && filtered[cursor])   { e.preventDefault(); insert(filtered[cursor]); return; }
    });
    input.addEventListener('blur', function () { setTimeout(close, 120); });
  }

  /* ============================================================
   * Type-ahead suggestions in composer
   *
   * As the user types (2+ chars, not a slash command), open a
   * dropdown above the composer with matching SUGGESTIONS for
   * the current page + slash command templates. Tab inserts;
   * arrow keys navigate; Esc closes. Enter still sends the
   * user's literal text (typeahead is help, not autocomplete).
   *
   * Why bother: SEMPHN staff don't memorise the right phrasing
   * to get the right widget. Typing "homeless" and seeing
   * "Build a bar chart of homeless + marginal housing rate per
   * 10k by LGA" is the single biggest UX win.
   * ============================================================ */
  function wireTypeahead(input) {
    var page = pageId();
    // Build a flat pool of matchable items from this page's SUGGESTIONS,
    // plus a synthetic entry per slash command so "donut" matches "/donut".
    var pool = [];
    (SUGGESTIONS[page] || []).forEach(function (sec) {
      (sec.items || []).forEach(function (item) {
        pool.push({
          label: item.label,
          section: sec.section,
          icon: item.icon || '◯',
          prompt: item.prompt || null,
          template: item.template || null,
          mapTemplate: item.mapTemplate || null,
          mapPoints: item.mapPoints || null,
        });
      });
    });
    SLASH_COMMANDS.forEach(function (c) {
      pool.push({
        label: c.label,
        section: 'Slash commands',
        icon: c.trigger,
        prompt: c.template,
      });
    });

    var menu = null, cursor = 0, filtered = [];

    function close() {
      if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
      menu = null;
    }
    function shouldOpen() {
      var v = input.value;
      if (!v || v[0] === '/') return false;
      return v.trim().length >= 2;
    }
    function escapeHtml(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c];
      });
    }
    function highlight(label, token) {
      if (!token) return escapeHtml(label);
      var lc = label.toLowerCase();
      var idx = lc.indexOf(token);
      if (idx < 0) return escapeHtml(label);
      return escapeHtml(label.slice(0, idx)) +
             '<mark>' + escapeHtml(label.slice(idx, idx + token.length)) + '</mark>' +
             escapeHtml(label.slice(idx + token.length));
    }
    function refresh() {
      if (!shouldOpen()) { close(); return; }
      var q = input.value.trim().toLowerCase();
      var tokens = q.split(/\s+/).filter(Boolean);
      filtered = pool.filter(function (it) {
        var hay = (it.label + ' ' + (it.section || '') + ' ' + (it.prompt || it.template || '')).toLowerCase();
        return tokens.every(function (t) { return hay.indexOf(t) >= 0; });
      }).slice(0, 6);
      cursor = 0;
      render();
    }
    function render() {
      if (!filtered.length) { close(); return; }
      if (!menu) {
        menu = document.createElement('div');
        menu.className = 'typeahead-menu';
        var wrap = input.closest('.composer-wrap') || input.parentNode;
        var rect = wrap.getBoundingClientRect();
        menu.style.left   = rect.left + 'px';
        menu.style.width  = rect.width + 'px';
        menu.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        document.body.appendChild(menu);
      }
      while (menu.firstChild) menu.removeChild(menu.firstChild);
      var head = document.createElement('div'); head.className = 'typeahead-head';
      var lhead = document.createElement('span');
      lhead.textContent = filtered.length + ' matching prompt' + (filtered.length === 1 ? '' : 's');
      var rhead = document.createElement('span');
      rhead.innerHTML = '<kbd>Tab</kbd> insert · <kbd>↑↓</kbd> nav · <kbd>Esc</kbd> close';
      head.appendChild(lhead); head.appendChild(rhead);
      menu.appendChild(head);
      var firstToken = (input.value.trim().toLowerCase().split(/\s+/)[0]) || '';
      filtered.forEach(function (it, i) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'typeahead-item' + (i === cursor ? ' is-on' : '');
        var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = it.icon;
        var body = document.createElement('span'); body.className = 'body';
        var lab = document.createElement('span'); lab.className = 'lab';
        lab.innerHTML = highlight(it.label, firstToken);
        var sec = document.createElement('span'); sec.className = 'sec';
        var instant = it.template || it.mapTemplate || it.mapPoints;
        sec.textContent = instant ? (it.section + ' · instant') : it.section;
        body.appendChild(lab); body.appendChild(sec);
        item.appendChild(ico); item.appendChild(body);
        item.addEventListener('mouseenter', function () { cursor = i; render(); });
        item.addEventListener('mousedown', function (e) { e.preventDefault(); accept(it); });
        menu.appendChild(item);
      });
    }
    function accept(it) {
      if (it.template) {
        input.value = ''; input.style.height = 'auto';
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (typeof window.__loadDashboardTemplate === 'function') {
          window.__loadDashboardTemplate(it.template);
        }
      } else if (it.mapTemplate) {
        input.value = ''; input.style.height = 'auto';
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (typeof window.__loadMapTemplate === 'function') {
          window.__loadMapTemplate(it.mapTemplate);
        }
      } else if (it.mapPoints) {
        input.value = ''; input.style.height = 'auto';
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (window.__defaultMapApi) {
          window.__defaultMapApi.applyPoints(it.mapPoints, { fit: true });
          var first = (it.mapPoints[0] || '').toString();
          showToast('Added ' + (SERVICE_STYLE[first] && SERVICE_STYLE[first].plural || first) + ' to the map', 'success');
        }
      } else if (it.prompt) {
        input.value = it.prompt;
        input.dispatchEvent(new Event('input'));
        // Jump cursor to first placeholder if any (so /bar etc. is fillable)
        var pos = input.value.indexOf('__');
        if (pos >= 0) {
          input.selectionStart = pos;
          input.selectionEnd = input.value.indexOf('__', pos + 2) + 2;
        }
        input.focus();
      }
      close();
    }
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', function (e) {
      if (!menu) return;
      if (e.key === 'Escape')    { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % filtered.length; render(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); cursor = (cursor - 1 + filtered.length) % filtered.length; render(); return; }
      if (e.key === 'Tab' && filtered[cursor]) { e.preventDefault(); accept(filtered[cursor]); return; }
      // Note: Enter intentionally falls through — user can always send literal text.
    });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
  }

  function wireComposer(contextSummary) {
    var input = document.getElementById('chat-input');
    var send  = document.getElementById('chat-send');
    if (!input || !send) return;

    var meta = PAGE_META[pageId()] || PAGE_META.dashboards;
    var promptLabel = document.querySelector('.composer-prompt');
    if (promptLabel) promptLabel.textContent = meta.composerLabel;
    // Short, calm placeholder — keyboard hints live in the .composer-hint row below.
    input.placeholder = 'Ask anything…';

    var busy = false;
    function setBusy(b) { busy = b; send.disabled = b || !input.value.trim(); updateStatus(b ? 'thinking' : 'idle'); }

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 144) + 'px';
      send.disabled = busy || !input.value.trim();
      // Toggle declutter state on the chat panel
      if (typeof window.__syncChatState === 'function') window.__syncChatState();
    });
    // Initial sync (in case there's persisted text or prior turns on load)
    if (typeof window.__syncChatState === 'function') window.__syncChatState();

    // Honour ?prompt=... query param so cross-page bridges (LGA drawer, etc.)
    // can land users straight into the composer with a prefilled question.
    try {
      var params = new URLSearchParams(window.location.search);
      var seed = params.get('prompt');
      if (seed) {
        input.value = seed;
        input.dispatchEvent(new Event('input'));
        input.focus();
        // Auto-send so the dashboard / HNA reply appears immediately
        setTimeout(function () { if (send && !send.disabled) send.click(); }, 80);
        // Strip the query so refresh doesn't re-fire
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, '', window.location.pathname);
        }
      }
    } catch (_) {}
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && document.querySelector('.slash-menu') == null) {
        e.preventDefault(); handleSend();
      }
    });
    send.addEventListener('click', handleSend);

    // Slash-menu power-user shortcut · "/" at start opens template picker
    wireSlashMenu(input, send);
    // Type-ahead · live suggestions as user types (2+ chars, no slash)
    wireTypeahead(input);

    async function handleSend() {
      var text = input.value.trim();
      if (!text || busy) return;
      input.value = ''; input.style.height = 'auto';

      var turns = getPageTurns(pageId());
      var turn = { prompt: text, avatar: 'D', summary: '', thinking: true };
      turns.push(turn);
      setPageTurns(pageId(), turns);
      renderFeed();
      setBusy(true);

      // AbortController · lets the user cancel the in-flight request via the
      // Stop button on the thinking indicator (rendered by buildTurnNode).
      var abort = new AbortController();
      window.__chatAbort = function () { try { abort.abort(); } catch (_) {} };

      try {
        var apiSlug = meta.api_slug;
        var historyMessages = turns
          .flatMap(function (t) {
            var arr = [{ role: 'user', content: t.prompt || '' }];
            if (t.summary) arr.push({ role: 'assistant', content: t.summary });
            return arr;
          })
          .filter(function (m) { return m.content; });

        var res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            step_slug: apiSlug,
            step_name: meta.name,
            messages: historyMessages,
            context_summary: contextSummary,
          }),
          signal: abort.signal,
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        var reply = (data && data.reply) || (data && data.error) || 'No response.';

        // On the Dashboards builder, the model may return a ```widget JSON
        // block. Extract it, render the tile on the canvas, and strip
        // it from the visible chat reply so the prose stays clean.
        var producedWidget = null;
        if (typeof window.__extractWidgets === 'function') {
          try {
            // Extract EVERY widget block in the reply (model may emit
            // multiple in one turn when user asks for a full dashboard).
            var parsed = window.__extractWidgets(reply);
            /* AI-claims-without-evidence detection · if the model wrote
             * "Added a chart" / "Built a tile" etc. but its reply has
             * ZERO widget blocks, that's a hallucination. Substitute a
             * clear warning so users don't think the AI worked when it
             * didn't. */
            if (parsed.widgets.length === 0 && /\b(added|built|created|drafted|mapped|generated|inserted)\b/i.test(reply)) {
              reply = '⚠ I claimed an action but didn\'t produce a widget. Try again or rephrase — e.g. include the widget type explicitly ("add a TABLE of …", "build a BAR CHART of …").';
            }
            if (parsed.widgets.length) {
              var page = pageId();
              var addedToMap = 0, addedAsTiles = 0, addedToDoc = 0;
              parsed.widgets.forEach(function (w) {
                var t = w.type;
                // On /maps/, choropleth-style widgets overlay onto the live
                // default map. The first one wins; later choropleths replace it.
                if (page === 'maps' && (t === 'choropleth' || t === 'map') && window.__defaultMapApi) {
                  window.__defaultMapApi.applyData(w);
                  addedToMap++;
                } else if (page === 'hna' && t === 'paragraph' && window.__applyHnaParagraph) {
                  // On /hna/, paragraph widgets are inserted into the doc
                  if (window.__applyHnaParagraph(w)) addedToDoc++;
                } else if (page === 'hna' && window.__applyHnaWidget &&
                           (t === 'bar' || t === 'line' || t === 'area' || t === 'donut' ||
                            t === 'kpi' || t === 'table' || t === 'choropleth' || t === 'map')) {
                  // On /hna/, data widgets become inline figures in the chapter
                  // (including choropleths · rendered as compact LGA tables/maps)
                  if (window.__applyHnaWidget(w)) addedToDoc++;
                } else if (t === 'paragraph') {
                  // paragraph widget on a non-HNA page → no-op (skip silently)
                } else {
                  window.__addWidget(w);
                  addedAsTiles++;
                }
              });
              producedWidget = parsed.widgets[parsed.widgets.length - 1];
              // ALWAYS use a generated one-line confirmation when widgets
              // were produced. The widgets ARE the answer — chat just
              // narrates what happened, not what's in each tile.
              // This is a frontend safeguard against the model ignoring
              // the "one sentence" rule in the system prompt.
              var bits = [];
              if (addedAsTiles) {
                bits.push('Added ' + addedAsTiles + ' tile' + (addedAsTiles === 1 ? '' : 's') + ' to your dashboard.');
              }
              if (addedToMap) {
                bits.push('Updated the map' + (producedWidget.title ? ' — ' + producedWidget.title : '') + '.');
              }
              if (addedToDoc) {
                bits.push('Drafted ' + addedToDoc + ' paragraph' + (addedToDoc === 1 ? '' : 's') + ' into Chapter 4.');
              }
              var generated = bits.join(' ');

              // If the model produced an extremely short prose (< 90 chars),
              // it followed the rule — keep it. Otherwise use ours.
              var stripped = (parsed.stripped || '').trim();
              if (stripped && stripped.length < 90 && stripped.indexOf('\n') < 0) {
                reply = stripped;
              } else {
                reply = generated || 'Done.';
              }
            }
          } catch (e) { console.error('[widget] extract/add failed', e); }
        }

        turn.summary = reply;
        turn.thinking = false;
        // Pick context-aware follow-up chips so the user always has a next move
        turn.followups = pickFollowups(turn, producedWidget);
        setPageTurns(pageId(), turns);
        renderFeed();
        renderSuggestStrip();    // refresh the persistent strip with new follow-ups
        updateLastSaved();
      } catch (err) {
        if (err && err.name === 'AbortError') {
          turn.summary = '_Stopped._';
          turn.thinking = false;
          setPageTurns(pageId(), turns);
          renderFeed();
          renderSuggestStrip();
          showToast('Stopped', 'warn');
        } else {
          turn.summary = 'Sorry — the assist is unreachable right now. Please retry.';
          turn.thinking = false;
          setPageTurns(pageId(), turns);
          renderFeed();
          renderSuggestStrip();
          showToast('Chat backend unreachable — retry', 'error');
        }
      } finally {
        window.__chatAbort = null;
        setBusy(false);
        send.disabled = !input.value.trim();
      }
    }
  }

  /* ============================================================
   * Status bar
   * ============================================================ */
  var statusBusy = null;
  function updateStatus(state) {
    var item = document.querySelector('.statusbar-item[data-status="ai"]');
    if (!item) return;
    if (state === 'thinking') {
      item.classList.add('live');
      item.textContent = '';
      item.appendChild(document.createTextNode(' AI thinking…'));
    } else {
      item.classList.remove('live');
      item.classList.add('live'); // keep dot
      item.textContent = '';
      item.appendChild(document.createTextNode(' AI · ready'));
    }
  }
  function updateLastSaved() {
    var el = document.querySelector('.statusbar-item[data-status="saved"]');
    if (!el) return;
    var u = readUI(); u.lastSaved = Date.now(); writeUI(u);
    el.textContent = '';
    el.appendChild(document.createTextNode('Saved just now'));
  }
  function refreshSavedLabel() {
    var el = document.querySelector('.statusbar-item[data-status="saved"]');
    if (!el) return;
    var u = readUI();
    if (!u.lastSaved) { el.textContent = ''; el.appendChild(document.createTextNode('All changes synced')); return; }
    var diff = (Date.now() - u.lastSaved) / 1000;
    var label;
    if (diff < 5) label = 'Saved just now';
    else if (diff < 60) label = 'Saved ' + Math.round(diff) + 's ago';
    else if (diff < 3600) label = 'Saved ' + Math.round(diff / 60) + 'm ago';
    else label = 'Saved ' + Math.round(diff / 3600) + 'h ago';
    el.textContent = '';
    el.appendChild(document.createTextNode(label));
  }

  /* ============================================================
   * Toast notifications
   * ============================================================ */
  function showToast(message, kind) {
    var bin = document.getElementById('toasts');
    if (!bin) {
      bin = document.createElement('div');
      bin.id = 'toasts';
      bin.className = 'toasts';
      document.body.appendChild(bin);
    }
    var t = document.createElement('div'); t.className = 'toast ' + (kind || 'success');
    var ico = document.createElement('span'); ico.className = 'ico';
    ico.textContent = kind === 'error' ? '!' : kind === 'warn' ? '!' : '✓';
    var txt = document.createElement('span'); txt.textContent = message;
    t.appendChild(ico); t.appendChild(txt);
    bin.appendChild(t);
    setTimeout(function () {
      t.classList.add('is-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 220);
    }, 2800);
  }

  /* ============================================================
   * Command palette (⌘K / Ctrl+K)
   * ============================================================ */
  var COMMANDS = [
    { section: 'Navigate',  ico: 'H', label: 'Go to HNA',         sub: 'Health Needs Assessment co-author',  shortcut: 'G then H', action: function () { location.href = '/hna/'; } },
    { section: 'Navigate',  ico: 'D', label: 'Go to Dashboards',  sub: 'Catchment KPIs + charts',           shortcut: 'G then D', action: function () { location.href = '/dashboards/'; } },
    { section: 'Navigate',  ico: 'M', label: 'Go to Maps',        sub: 'Choropleth + overlays',             shortcut: 'G then M', action: function () { location.href = '/maps/'; } },
    { section: 'Workbench', ico: '/', label: 'Focus chat composer', sub: 'Start typing immediately',       shortcut: '⌘ /',     action: function () { var i = document.getElementById('chat-input'); if (i) i.focus(); } },
    { section: 'Workbench', ico: '↔', label: 'Toggle chat panel', sub: 'Collapse or expand the left panel', shortcut: '⌘ \\',     action: function () { var btn = document.querySelector('.chat-collapse'); if (btn) btn.click(); } },
    { section: 'Workbench', ico: '×', label: 'Clear chat history (this page)', sub: 'Resets to seed turn',  shortcut: '',         action: function () { var s = readState(); s.byPage[pageId()] = null; writeState(s); renderFeed(); showToast('Chat cleared', 'success'); } },
    { section: 'Account',   ico: '↗', label: 'Sign out',          sub: 'End this session',                  shortcut: '',         action: function () { showToast('Signing out…', 'success'); setTimeout(function () { clearSession(); location.href = SIGNIN; }, 400); } },
  ];

  function openPalette() {
    if (document.querySelector('.cmdk-backdrop')) return;
    var bd = document.createElement('div'); bd.className = 'cmdk-backdrop';
    var pal = document.createElement('div'); pal.className = 'cmdk';
    var inWrap = document.createElement('div'); inWrap.className = 'cmdk-input-wrap';
    var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '⌘';
    var input = document.createElement('input'); input.type = 'text'; input.placeholder = 'Type a command or search…'; input.autocomplete = 'off';
    var esc = document.createElement('span'); esc.className = 'esc'; esc.textContent = 'Esc';
    inWrap.appendChild(ico); inWrap.appendChild(input); inWrap.appendChild(esc);
    pal.appendChild(inWrap);
    var list = document.createElement('ul'); list.className = 'cmdk-list';
    pal.appendChild(list);
    bd.appendChild(pal);
    document.body.appendChild(bd);

    var filtered = COMMANDS.slice();
    var cursor = 0;

    function render() {
      while (list.firstChild) list.removeChild(list.firstChild);
      if (filtered.length === 0) {
        var em = document.createElement('div'); em.className = 'cmdk-empty';
        em.textContent = 'No matches.';
        list.appendChild(em);
        return;
      }
      var lastSection = null;
      filtered.forEach(function (cmd, idx) {
        if (cmd.section !== lastSection) {
          var sec = document.createElement('div'); sec.className = 'cmdk-section';
          sec.textContent = cmd.section;
          list.appendChild(sec);
          lastSection = cmd.section;
        }
        var li = document.createElement('li');
        li.className = 'cmdk-item' + (idx === cursor ? ' is-on' : '');
        var ic = document.createElement('span'); ic.className = 'ico'; ic.textContent = cmd.ico;
        var lab = document.createElement('span'); lab.className = 'label';
        lab.appendChild(document.createTextNode(cmd.label));
        if (cmd.sub) { var sub = document.createElement('span'); sub.className = 'sub'; sub.textContent = cmd.sub; lab.appendChild(sub); }
        li.appendChild(ic); li.appendChild(lab);
        if (cmd.shortcut) { var sc = document.createElement('span'); sc.className = 'shortcut'; sc.textContent = cmd.shortcut; li.appendChild(sc); }
        li.addEventListener('mouseenter', function () { cursor = idx; updateCursor(); });
        li.addEventListener('click', function () { runAt(idx); });
        list.appendChild(li);
      });
    }
    function updateCursor() {
      list.querySelectorAll('.cmdk-item').forEach(function (el, idx) {
        el.classList.toggle('is-on', idx === cursor);
      });
    }
    function runAt(idx) {
      var cmd = filtered[idx];
      if (!cmd) return;
      close();
      try { cmd.action(); } catch (_) {}
    }
    function applyFilter() {
      var q = input.value.toLowerCase().trim();
      if (!q) { filtered = COMMANDS.slice(); cursor = 0; render(); return; }
      filtered = COMMANDS.filter(function (c) {
        return (c.label + ' ' + (c.sub || '') + ' ' + c.section).toLowerCase().indexOf(q) >= 0;
      });
      cursor = 0; render();
    }

    function close() {
      bd.removeEventListener('click', onBdClick);
      window.removeEventListener('keydown', onKey, true);
      if (bd.parentNode) bd.parentNode.removeChild(bd);
    }
    function onBdClick(e) { if (e.target === bd) close(); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); cursor = (cursor + 1) % filtered.length; updateCursor(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); cursor = (cursor - 1 + filtered.length) % filtered.length; updateCursor(); return; }
      if (e.key === 'Enter')     { e.preventDefault(); runAt(cursor); return; }
    }
    bd.addEventListener('click', onBdClick);
    window.addEventListener('keydown', onKey, true);
    input.addEventListener('input', applyFilter);

    render();
    setTimeout(function () { input.focus(); }, 0);
  }

  /* Wire the "Clear" button in the chat-toolbar.
   * Wipes the per-page turn list and re-renders the empty state.
   * Also supports the legacy `chat-new` id for any cached HTML. */
  function wireNewChatButton() {
    var btn = document.getElementById('chat-clear') || document.getElementById('chat-new');
    if (!btn) return;
    function syncDisabled() {
      var has = getPageTurns(pageId()).length > 0;
      btn.disabled = !has;
      btn.title = has ? 'Clear this chat' : 'Nothing to clear';
    }
    syncDisabled();
    // Re-run after every state change (feed re-render is a good proxy)
    window.__syncClearBtn = syncDisabled;
    btn.addEventListener('click', function () {
      var page = pageId();
      var turns = getPageTurns(page);
      if (turns.length === 0) {
        showToast('Chat is already empty', 'success');
        return;
      }
      if (!confirm('Clear this chat? The conversation in this panel will be deleted.')) return;
      var s = readState();
      s.byPage[page] = [];
      writeState(s);
      renderFeed();
      renderSuggestStrip();
      syncChatState();
      var input = document.getElementById('chat-input');
      if (input) { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
      showToast('Chat cleared', 'success');
    });
  }

  /* Wire the "Export" button · serialise the current page's turn list to
   * Markdown and trigger a browser download. Useful for HNA audit trail —
   * keep a record of how each chapter / dashboard was drafted. */
  function wireExportButton() {
    var btn = document.getElementById('chat-export');
    if (!btn) return;
    function syncDisabled() {
      var has = getPageTurns(pageId()).length > 0;
      btn.disabled = !has;
      btn.title = has ? 'Export chat as Markdown' : 'Nothing to export yet';
    }
    syncDisabled();
    window.__syncExportBtn = syncDisabled;
    btn.addEventListener('click', function () {
      var page = pageId();
      var turns = getPageTurns(page);
      if (!turns.length) { showToast('Nothing to export yet', 'warn'); return; }
      var date = new Date();
      var iso = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      var pageName = (PAGE_META[page] && PAGE_META[page].name) || page;
      var lines = [
        '# SEMPHN Workbench · ' + pageName + ' chat',
        '',
        '> Exported ' + date.toUTCString(),
        '> Workspace: SEMPHN (PHN108)',
        '> ' + turns.length + ' turn' + (turns.length === 1 ? '' : 's'),
        '',
        '---',
        '',
      ];
      turns.forEach(function (t, i) {
        lines.push('## Turn ' + (i + 1));
        lines.push('');
        lines.push('**You**');
        lines.push('');
        lines.push((t.prompt || '').trim());
        lines.push('');
        lines.push('**SEMPHN Workbench**');
        lines.push('');
        lines.push((t.summary || '_(no reply captured)_').trim());
        lines.push('');
        lines.push('---');
        lines.push('');
      });
      var md = lines.join('\n');
      var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'semphn-' + page + '-chat-' + iso + '.md';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { URL.revokeObjectURL(url); a.remove(); } catch (_) {} }, 1000);
      showToast('Exported ' + turns.length + '-turn chat', 'success');
    });
  }

  /* Sync the chat panel state for declutter:
   *   • Hide suggest strip while user is actively typing (typeahead takes over)
   *   • Hide composer hint after the first turn OR while typing
   *   • Keep msg count + clear-btn enabled state fresh
   * We toggle `hidden` directly instead of relying on attribute selectors
   * (which we saw misbehave in some environments). */
  function syncChatState() {
    var chat = document.querySelector('.chat');
    if (!chat) return;
    var input = document.getElementById('chat-input');
    var turns = getPageTurns(pageId());
    var composing = !!(input && input.value && input.value.trim().length > 0);
    chat.setAttribute('data-composing', composing ? 'true' : 'false');
    chat.setAttribute('data-has-turns', turns.length > 0 ? 'true' : 'false');

    // Suggest strip · only visible when feed is empty AND user isn't typing
    var suggest = document.getElementById('chat-suggest');
    if (suggest) {
      if (composing || turns.length > 0) suggest.setAttribute('hidden', '');
      else suggest.removeAttribute('hidden');
    }

    // Composer hint · only visible at the empty-state idle moment
    var hint = document.querySelector('.composer-hint');
    if (hint) {
      if (composing || turns.length > 0) hint.setAttribute('hidden', '');
      else hint.removeAttribute('hidden');
    }

    // Toolbar message count
    var count = document.getElementById('chat-msgcount');
    if (count) count.textContent = turns.length ? turns.length + (turns.length === 1 ? ' message' : ' messages') : '';
    if (typeof window.__syncClearBtn === 'function') window.__syncClearBtn();
    if (typeof window.__syncExportBtn === 'function') window.__syncExportBtn();
  }
  window.__syncChatState = syncChatState;

  /* ============================================================
   * Contextual suggestion strip · above the composer
   *
   * Before any turns: starter prompts from SUGGESTIONS dict (mixed
   *   across sections so the user sees variety in the first row).
   * After each turn: 4-5 follow-ups based on the last produced widget
   *   type (drawn from FOLLOWUPS + page-aware extras like
   *   'Map this on Maps' that bridge between pages).
   *
   * Re-renders whenever turns change (init, send complete, New chat).
   * ============================================================ */
  function flattenStarterChips(page, n) {
    n = n || 7;
    var sugs = SUGGESTIONS[page] || [];
    // SUGGESTIONS may be grouped sections OR a flat array.
    var flat = [];
    if (Array.isArray(sugs) && sugs.length && sugs[0].section) {
      // Interleave: take 2 from each section so first row shows diversity
      var perSection = Math.ceil(n / sugs.length);
      sugs.forEach(function (g) {
        (g.items || []).slice(0, perSection).forEach(function (s) { flat.push(s); });
      });
    } else {
      flat = (sugs || []).slice();
    }
    return flat.slice(0, n);
  }

  /* Cross-page follow-ups that bridge widgets to other surfaces. */
  function crossPageFollowups(page, lastWidget) {
    var arr = [];
    if (page === 'dashboards') {
      arr.push({ label: 'Map this on Maps',  prompt: 'Switch to the Maps page and map the same metric as a choropleth.' });
      arr.push({ label: 'Cite in HNA Ch 4',  prompt: 'Add a citation for this figure to HNA Chapter 4 (First Nations people).' });
    }
    if (page === 'maps') {
      arr.push({ label: 'Show as ranked bar', prompt: 'Add a ranked bar chart of the same metric by LGA.' });
      arr.push({ label: 'Cite in HNA',       prompt: 'Open the HNA page and draft a one-paragraph commentary on this map for Chapter 4.' });
    }
    if (page === 'hna') {
      arr.push({ label: 'Map cited metric',  prompt: 'Switch to the Maps page and choropleth the metric cited in this paragraph.' });
      arr.push({ label: 'KPI in dashboard',  prompt: 'Add a KPI tile to the dashboard for the headline figure in this paragraph.' });
    }
    return arr;
  }

  function renderSuggestStrip() {
    var el = document.getElementById('chat-suggest');
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
    var page = pageId();
    var turns = getPageTurns(page);
    var chips, labelText;
    if (turns.length === 0) {
      // Starter set — diverse mix from per-page SUGGESTIONS
      chips = flattenStarterChips(page, 7);
      labelText = 'Try';
    } else {
      // Follow-ups · per-turn FOLLOWUPS dict + cross-page bridges
      var last = turns[turns.length - 1];
      var base = (last && last.followups) || pickFollowups(last, null);
      chips = (base || []).slice(0, 3).concat(crossPageFollowups(page, last));
      labelText = 'Next';
    }
    if (!chips.length) { el.setAttribute('hidden', ''); return; }
    el.removeAttribute('hidden');
    var lab = document.createElement('span'); lab.className = 'chat-suggest-label';
    lab.textContent = labelText;
    el.appendChild(lab);
    chips.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-suggest-chip';
      var arrChar = s.template || s.mapTemplate ? '⚡'
                  : s.mapPoints ? '⊙'
                  : '→';
      var arr = document.createElement('span'); arr.className = 'arr'; arr.textContent = arrChar;
      var t = document.createElement('span'); t.textContent = s.label;
      btn.appendChild(arr); btn.appendChild(t);
      btn.addEventListener('click', function () {
        if (s.template && typeof window.__loadDashboardTemplate === 'function') {
          window.__loadDashboardTemplate(s.template);
          return;
        }
        if (s.mapTemplate && typeof window.__loadMapTemplate === 'function') {
          window.__loadMapTemplate(s.mapTemplate);
          return;
        }
        if (s.mapPoints && window.__defaultMapApi) {
          window.__defaultMapApi.applyPoints(s.mapPoints, { fit: true });
          var first = (s.mapPoints[0] || '').toString();
          showToast('Added ' + (SERVICE_STYLE[first] && SERVICE_STYLE[first].plural || first) + ' to the map', 'success');
          return;
        }
        var input = document.getElementById('chat-input');
        var send  = document.getElementById('chat-send');
        if (!input || !s.prompt) return;
        input.value = s.prompt;
        input.dispatchEvent(new Event('input'));
        input.focus();
        if (send && !send.disabled) send.click();
      });
      el.appendChild(btn);
    });
  }
  window.__renderSuggestStrip = renderSuggestStrip;

  function wireGlobalShortcuts() {
    window.addEventListener('keydown', function (e) {
      var meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      if (meta && e.key === '/') {
        e.preventDefault();
        var i = document.getElementById('chat-input');
        if (i) i.focus();
      }
      if (meta && e.key === '\\') {
        e.preventDefault();
        var btn = document.querySelector('.chat-collapse');
        if (btn) btn.click();
      }
    });
    var trigger = document.querySelector('.nav-cmdk');
    if (trigger) trigger.addEventListener('click', openPalette);
  }

  /* ============================================================
   * Entry
   * ============================================================ */
  function init() {
    var sess = gate();
    if (!sess) return;
    hydrateUserPill(sess);
    highlightNav(pageId());
    // Stamp the body with a print header label (page + locale date)
    try {
      var d = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
      document.body.setAttribute('data-page-print', pageId().toUpperCase() + ' · ' + d);
    } catch (_) {}
    renderFeed();
    var contextSummary = document.body.getAttribute('data-context')
      || 'SEMPHN catchment: 1.56M residents across 10 LGAs (Bayside, Cardinia, Casey, Frankston, Glen Eira, Greater Dandenong, Kingston, Mornington Peninsula, Port Phillip, Stonnington). First Nations IRSEO 25 vs Vic 14. MH prevalence above 18.3% in Port Phillip (23.3), Frankston (22.0), Greater Dandenong (21.4). Lowest bowel screening: Casey South 35.9%, Dandenong 38.3%, Frankston 39.3%. Frankston highest MH conditions at 116.1/1k.';
    wireComposer(contextSummary);
    wireResize();
    wireGlobalShortcuts();
    wireNewChatButton();
    wireExportButton();
    renderSuggestStrip();    // initial starter chips (or follow-ups if turns persisted)
    updateStatus('idle');
    refreshSavedLabel();
    setInterval(refreshSavedLabel, 30000);
    if (pageId() === 'dashboards' && typeof window.__renderWidgets === 'function') {
      window.__renderWidgets();
      window.__renderCatchmentInsights && window.__renderCatchmentInsights();
    }
    if (pageId() === 'hna' && typeof window.__renderHnaChapter === 'function') {
      // Render the current chapter (from hash) + wire hashchange to swap
      window.__renderHnaChapter();
      window.addEventListener('hashchange', function () {
        window.__renderHnaChapter();
      });
      // Wire toolbar export dropdown
      var expBtn = document.getElementById('hna-export-btn');
      var expPop = document.getElementById('hna-export-pop');
      if (expBtn && expPop) {
        expBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          var open = !expPop.hasAttribute('hidden');
          if (open) { expPop.setAttribute('hidden', ''); expBtn.setAttribute('aria-expanded', 'false'); }
          else { expPop.removeAttribute('hidden'); expBtn.setAttribute('aria-expanded', 'true'); }
        });
        Array.prototype.forEach.call(expPop.querySelectorAll('[data-export]'), function (item) {
          item.addEventListener('click', function () {
            var kind = item.getAttribute('data-export');
            expPop.setAttribute('hidden', '');
            expBtn.setAttribute('aria-expanded', 'false');
            if (kind === 'md' && typeof window.__exportHnaChapterMd === 'function') window.__exportHnaChapterMd();
            if (kind === 'doc' && typeof window.__exportHnaChapterDoc === 'function') window.__exportHnaChapterDoc();
            if (kind === 'full' && typeof window.__exportHnaFullMd === 'function') window.__exportHnaFullMd();
          });
        });
        // Click outside to close
        document.addEventListener('click', function (e) {
          if (!expPop.hasAttribute('hidden') &&
              !expBtn.contains(e.target) && !expPop.contains(e.target)) {
            expPop.setAttribute('hidden', '');
            expBtn.setAttribute('aria-expanded', 'false');
          }
        });
      }
      // Legacy single button (back-compat for stale HTML)
      var expLegacy = document.getElementById('hna-export-md');
      if (expLegacy) expLegacy.addEventListener('click', function () {
        if (typeof window.__exportHnaChapterMd === 'function') window.__exportHnaChapterMd();
      });
      var preflight = document.getElementById('hna-preflight-btn');
      if (preflight) preflight.addEventListener('click', function () {
        if (typeof window.__openPreflight === 'function') window.__openPreflight();
      });
      var preflightX = document.getElementById('hna-preflight-x');
      var preflightClose = document.getElementById('hna-preflight-close-2');
      if (preflightX) preflightX.addEventListener('click', function () {
        var m = document.getElementById('hna-preflight');
        if (m) m.setAttribute('hidden', '');
        document.body.style.overflow = '';
      });
      if (preflightClose) preflightClose.addEventListener('click', function () {
        var m = document.getElementById('hna-preflight');
        if (m) m.setAttribute('hidden', '');
        document.body.style.overflow = '';
      });
      // Close pre-flight by clicking outside the card
      var preflightModal = document.getElementById('hna-preflight');
      if (preflightModal) preflightModal.addEventListener('click', function (e) {
        if (e.target === preflightModal) {
          preflightModal.setAttribute('hidden', '');
          document.body.style.overflow = '';
        }
      });
      // Esc closes
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var m = document.getElementById('hna-preflight');
          if (m && !m.hasAttribute('hidden')) { m.setAttribute('hidden', ''); document.body.style.overflow = ''; }
        }
      });
      // Activity panel · toggle on tab click
      var actTab = document.getElementById('hna-activity-tab');
      var actPop = document.getElementById('hna-activity-pop');
      if (actTab && actPop) {
        actTab.addEventListener('click', function () {
          var open = !actPop.hasAttribute('hidden');
          if (open) actPop.setAttribute('hidden', '');
          else actPop.removeAttribute('hidden');
        });
        document.addEventListener('click', function (e) {
          if (!actPop.hasAttribute('hidden') &&
              !actTab.contains(e.target) && !actPop.contains(e.target)) {
            actPop.setAttribute('hidden', '');
          }
        });
      }
      var lodge = document.getElementById('hna-lodge');
      if (lodge) lodge.addEventListener('click', function () {
        var c = window.__HNA_CHAPTERS && window.__HNA_CHAPTERS[window.__currentChapter || '04-first-nations'];
        var msg = 'Lodge this HNA to the DoH via PPERS?\n\n' +
                  'You\'ll be redirected to ppers.health.gov.au with the ' +
                  'export bundle ready to upload. This is the final lodgement step ' +
                  'for the 2025-28 annual update.';
        if (confirm(msg)) {
          showToast('PPERS lodgement queued (demo)', 'success');
        }
      });
    } else if (pageId() === 'hna' && typeof window.__renderHnaEdits === 'function') {
      // Fallback for pages that haven't reloaded the new shell yet
      window.__renderHnaEdits();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.SEMPHN = {
    page: pageId,
    session: readSession,
    state: readState,
    clear: function () { writeState({ byPage: {} }); renderFeed(); },
    toast: showToast,
    openPalette: openPalette,
  };
})();
