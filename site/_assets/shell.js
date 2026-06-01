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

  var AUTH_KEY  = 'domato.semphn.session';
  var STORE_KEY = 'semphn.workbench.turns.v3';
  var UI_KEY    = 'semphn.workbench.ui.v2';
  var SIGNIN    = '/signin/';

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
      { section: 'KPI tiles', items: [
        { icon: '#', label: 'Catchment population',     prompt: 'Add a KPI tile showing the SEMPHN catchment population (2024) with the growth-pa delta.' },
        { icon: '#', label: 'Bowel screening rate',     prompt: 'Add a KPI tile for the catchment bowel cancer screening rate with the delta indicator.' },
        { icon: '#', label: 'GP encounter rate',        prompt: 'Add a KPI tile for catchment GP encounters per resident per year, with the delta to Victorian average.' },
      ]},
      { section: 'Compare LGAs', items: [
        { icon: '▮', label: 'MH conditions',            prompt: 'Build a bar chart of MH conditions per 1,000 by LGA, ranked highest to lowest. Highlight Frankston as the standout.' },
        { icon: '▮', label: 'Bulk-billing',             prompt: 'Build a bar chart of bulk-billing percentage by LGA, ranked highest to lowest.' },
        { icon: '▮', label: 'Homelessness rate',        prompt: 'Build a bar chart of homeless + marginal housing rate per 10k by LGA, ranked highest to lowest. Highlight Greater Dandenong.' },
        { icon: '▮', label: 'GP practices',             prompt: 'Build a bar chart of GP practice counts by LGA, ranked highest to lowest. Title: "GP practices · 31 Jul 2024".' },
      ]},
      { section: 'Commissioning', items: [
        { icon: '◐', label: 'Funding schedules · donut', prompt: 'Build a donut chart of FY26 funding schedules by program category. Unit: aud.' },
        { icon: '▤', label: 'Recent activity · table',  prompt: 'Build a table widget showing recent commissioning activity — columns: Activity, LGA, Schedule, Value, Status.' },
        { icon: '↗', label: 'Trend · 5-year area',      prompt: 'Build an area chart of total SEMPHN funding (AUD) by financial year for the last 5 years.' },
      ]},
    ],
    maps: [
      { section: 'Health & wellbeing', items: [
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

  var WIDGET_KEY = 'semphn.workbench.widgets.v1';
  // Match ANY fenced code block (```widget, ```json, ```js, or bare ```)
  // — global flag so we extract every block, not just the first.
  // Validity is checked downstream: content must JSON-parse + have a
  // recognised widget type. Non-widget code blocks pass through to prose.
  var WIDGET_RE_ALL    = /```(?:widget|json|js)?\s*\n?([\s\S]*?)```/g;
  var WIDGET_RE_SINGLE = /```widget\s*\n([\s\S]*?)```/;
  var WIDGET_TYPES = { bar: 1, line: 1, area: 1, donut: 1, pie: 1, kpi: 1, table: 1, choropleth: 1, map: 1, paragraph: 1 };

  function readWidgets(page) {
    try {
      var raw = localStorage.getItem(WIDGET_KEY);
      var s = raw ? JSON.parse(raw) : {};
      return Array.isArray(s[page]) ? s[page] : [];
    } catch (_) { return []; }
  }
  function writeWidgets(page, widgets) {
    try {
      var raw = localStorage.getItem(WIDGET_KEY);
      var s = raw ? JSON.parse(raw) : {};
      s[page] = widgets;
      localStorage.setItem(WIDGET_KEY, JSON.stringify(s));
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
          shadowBlur:    8,
          shadowColor:   'rgba(10,10,10,0.10)',
          shadowOffsetY: 1.5,
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
        backgroundColor: '#0A0A0A',
        borderColor: 'transparent',
        textStyle: { color: '#FFFFFF', fontSize: 12, fontFamily: '"Geist", system-ui' },
        padding: [8, 12],
        extraCssText: 'box-shadow: 0 8px 24px -8px rgba(0,0,0,0.2); border-radius: 8px;',
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
        trigger: 'item',          // hover a specific bar, not the row band
        confine: true,            // keep tooltip inside the chart bounds
        appendToBody: false,
        formatter: function (p) {
          return '<span style="font-weight:500;">' + p.name + '</span>'
               + '<br/><span style="opacity:0.8;">' + formatValue(p.value, widget.unit) + '</span>';
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
          return '<span style="font-weight:500;">' + row.axisValue + '</span>'
               + '<br/><span style="opacity:0.8;">' + formatValue(row.value, widget.unit) + '</span>';
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
          return '<span style="font-weight:500;">' + p.name + '</span>'
               + '<br/><span style="opacity:0.8;">' + formatValue(p.value, widget.unit) + ' · ' + p.percent.toFixed(1) + '%</span>';
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

  /* Service-type → marker color + glyph */
  var SERVICE_STYLE = {
    acchs:     { color: '#0A0A0A', glyph: 'A', label: 'ACCHS' },
    headspace: { color: '#55BFAF', glyph: 'h', label: 'headspace' },
    hospital:  { color: '#04264E', glyph: '+', label: 'Hospital' },
    gp:        { color: '#82D9C4', glyph: 'G', label: 'GP practice' },
    racf:      { color: '#6B7280', glyph: 'R', label: 'RACF' },
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
              mouseout: function (e) { lgaLayer.resetStyle(e.target); },
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
          // Remove any additive point overlays too
          mapApi.extraLayers.forEach(function (l) { try { map.removeLayer(l); } catch (_) {} });
          mapApi.extraLayers = [];
        }

        mapApi.applyData = function (w) {
          if (!w) return;
          if (w.type === 'choropleth' || w.type === 'map') applyChoropleth(w);
          // (Future: handle 'points' type for additive marker layers)
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
  var HNA_EDITS_KEY = 'semphn.hna.edits.v1';
  function readHnaEdits() {
    try { return JSON.parse(localStorage.getItem(HNA_EDITS_KEY) || '[]'); }
    catch (_) { return []; }
  }
  function writeHnaEdits(arr) {
    try { localStorage.setItem(HNA_EDITS_KEY, JSON.stringify(arr)); }
    catch (_) {}
  }

  /* Safe HTML for paragraph text · strip tags except <strong>/<em>.
   * Defense in depth — paragraph text comes from the model. */
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

  function buildHnaEditNode(edit, index) {
    var wrap = document.createElement('div');
    wrap.className = 'hna-ai-edit-wrap';
    wrap.setAttribute('data-edit-index', String(index));
    if (edit.heading) {
      var h = document.createElement('h2');
      h.textContent = edit.heading;
      wrap.appendChild(h);
    }
    var p = document.createElement('p');
    p.className = 'hna-ai-edit';
    p.innerHTML = sanitiseParagraphHtml(edit.text || '');
    wrap.appendChild(p);
    // Actions bar
    var bar = document.createElement('div');
    bar.className = 'hna-ai-edit-actions';
    function btn(label, opts, handler) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (opts && opts.danger) b.className = 'danger';
      b.addEventListener('click', handler);
      bar.appendChild(b);
    }
    btn('Keep', {}, function () {
      // Remove the AI badge styling — promote to "seed" content
      p.classList.remove('hna-ai-edit');
      bar.remove();
      // Mark as accepted in storage (still persisted)
      var arr = readHnaEdits();
      if (arr[index]) { arr[index].accepted = true; writeHnaEdits(arr); }
      showToast('Paragraph kept', 'success');
    });
    btn('Discard', { danger: true }, function () {
      var arr = readHnaEdits();
      arr.splice(index, 1);
      writeHnaEdits(arr);
      renderHnaEdits();
      showToast('Paragraph removed', 'success');
    });
    wrap.appendChild(bar);
    return wrap;
  }

  function renderHnaEdits() {
    var body = document.getElementById('hna-doc-body');
    if (!body) return;
    // Remove all previously-rendered AI edits
    Array.prototype.slice.call(body.querySelectorAll('.hna-ai-edit-wrap'))
      .forEach(function (el) { el.remove(); });
    var edits = readHnaEdits();
    edits.forEach(function (e, idx) {
      var node = buildHnaEditNode(e, idx);
      if (e.accepted) {
        // Render without the highlight class
        var p = node.querySelector('.hna-ai-edit');
        if (p) p.classList.remove('hna-ai-edit');
        var bar = node.querySelector('.hna-ai-edit-actions');
        if (bar) bar.remove();
      }
      body.appendChild(node);
    });
  }

  function applyHnaParagraph(widget) {
    if (!widget || widget.type !== 'paragraph') return false;
    var edit = {
      heading: widget.heading || '',
      text:    widget.text || widget.value || '',
      title:   widget.title || '',
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
      var raw = localStorage.getItem(STORE_KEY);
      var s = raw ? JSON.parse(raw) : null;
      return (s && s.byPage) ? s : { byPage: {} };
    } catch (_) { return { byPage: {} }; }
  }
  function writeState(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {} }
  function readUI() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function writeUI(u) { try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch (_) {} }

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
    if (av  && session.email) av.textContent = session.email.charAt(0).toUpperCase();
    if (who && session.email) who.textContent = session.email;
    if (sub) sub.textContent = (session.tenantName || 'SEMPHN') + ' · ' + (session.tenantCode || 'PHN108');
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

    var collapseBtn = document.querySelector('.chat-collapse');
    if (collapseBtn) {
      var refresh = function () {
        var collapsed = split.getAttribute('data-chat-collapsed') === 'true';
        collapseBtn.textContent = collapsed ? '›' : '‹';
        collapseBtn.title = collapsed ? 'Expand chat panel' : 'Collapse chat panel';
      };
      refresh();
      collapseBtn.addEventListener('click', function () {
        var collapsed = split.getAttribute('data-chat-collapsed') === 'true';
        if (collapsed) split.removeAttribute('data-chat-collapsed');
        else           split.setAttribute('data-chat-collapsed', 'true');
        var u = readUI(); u.chatCollapsed = !collapsed; writeUI(u);
        refresh();
        showToast(collapsed ? 'Chat panel expanded' : 'Chat panel collapsed', 'success');
      });
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
    pr.appendChild(pTxt); pr.appendChild(pAv);
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
      ['👍', '👎', '↻'].forEach(function (sym) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = sym;
        b.addEventListener('click', function () {
          b.classList.toggle('is-on');
          if (sym === '↻') showToast('Regenerating…', 'success');
          else if (sym === '👍') showToast('Thanks — saved as helpful', 'success');
          else if (sym === '👎') showToast('Noted — saved as not helpful', 'warn');
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
  function pickFollowups(turn, widget) {
    var page = pageId();
    if (page === 'dashboards') {
      return getFollowups(widget);
    }
    if (page === 'hna') {
      // If we just produced a paragraph widget, suggest follow-ups that
      // build on it. Otherwise (critique replies), suggest drafting next.
      if (widget && widget.type === 'paragraph') {
        return [
          { label: 'Tighten by 25%',        prompt: 'Draft a tightened version of the paragraph you just wrote — 25% shorter without losing any figure. New paragraph, append to doc.' },
          { label: 'Strengths-based rewrite', prompt: 'Draft a strengths-based rewrite of the paragraph you just wrote. Same figures, more agency-centred framing. New paragraph.' },
          { label: 'Add a methods footnote', prompt: 'Draft a methods footnote paragraph for the figures in the paragraph you just wrote. Heading: "Methods · sources + caveats".' },
        ];
      }
      return [
        { label: 'Draft next section',   prompt: 'Draft the next section of Chapter 4 — pick the area that is weakest in the current draft.' },
        { label: 'Executive summary',    prompt: 'Draft a 3-sentence executive summary of Chapter 4 — paragraph, heading: "Executive summary".' },
        { label: 'DoH critique',         prompt: 'Critique the current draft against the DoH Performance Rubric. Reply in prose, no widget.' },
      ];
    }
    if (page === 'maps') {
      return [
        { label: 'Add point overlay',       prompt: 'Add the 9 headspace centres + 2 ACCHS as a point overlay on the current map.' },
        { label: 'Switch palette',          prompt: 'Switch the palette to navy-to-teal sequential.' },
        { label: 'Export as PNG',           prompt: 'Stage the current map for export as PNG.' },
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
        btn.addEventListener('click', function () { fireSuggestion(s.prompt); });
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
      return;
    }
    turns.forEach(function (t) { feed.appendChild(buildTurnNode(t)); });
    feed.scrollTop = feed.scrollHeight;
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

  function wireComposer(contextSummary) {
    var input = document.getElementById('chat-input');
    var send  = document.getElementById('chat-send');
    if (!input || !send) return;

    var meta = PAGE_META[pageId()] || PAGE_META.dashboards;
    var promptLabel = document.querySelector('.composer-prompt');
    if (promptLabel) promptLabel.textContent = meta.composerLabel;
    input.placeholder = meta.placeholder + ' · type "/" for templates';

    var busy = false;
    function setBusy(b) { busy = b; send.disabled = b || !input.value.trim(); updateStatus(b ? 'thinking' : 'idle'); }

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 144) + 'px';
      send.disabled = busy || !input.value.trim();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && document.querySelector('.slash-menu') == null) {
        e.preventDefault(); handleSend();
      }
    });
    send.addEventListener('click', handleSend);

    // Slash-menu power-user shortcut · "/" at start opens template picker
    wireSlashMenu(input, send);

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
        turn.summary = 'Sorry — the assist is unreachable right now. Please retry.';
        turn.thinking = false;
        setPageTurns(pageId(), turns);
        renderFeed();
        renderSuggestStrip();
        showToast('Chat backend unreachable — retry', 'error');
      } finally {
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

  /* Wire the "New chat" button in the chat-toolbar.
   * Clears the per-page turn list and re-renders the empty state. */
  function wireNewChatButton() {
    var btn = document.getElementById('chat-new');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var page = pageId();
      var turns = getPageTurns(page);
      if (turns.length === 0) {
        showToast('Chat is already empty', 'success');
        return;
      }
      if (!confirm('Start a new chat? The conversation in this panel will be cleared.')) return;
      var s = readState();
      s.byPage[page] = [];
      writeState(s);
      renderFeed();
      renderSuggestStrip();
      var input = document.getElementById('chat-input');
      if (input) { input.value = ''; input.dispatchEvent(new Event('input')); input.focus(); }
      showToast('Chat cleared', 'success');
    });
  }

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
      var arr = document.createElement('span'); arr.className = 'arr'; arr.textContent = '→';
      var t = document.createElement('span'); t.textContent = s.label;
      btn.appendChild(arr); btn.appendChild(t);
      btn.addEventListener('click', function () {
        var input = document.getElementById('chat-input');
        var send  = document.getElementById('chat-send');
        if (!input) return;
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
    renderSuggestStrip();    // initial starter chips (or follow-ups if turns persisted)
    updateStatus('idle');
    refreshSavedLabel();
    setInterval(refreshSavedLabel, 30000);
    if (pageId() === 'dashboards' && typeof window.__renderWidgets === 'function') {
      window.__renderWidgets();
    }
    if (pageId() === 'hna' && typeof window.__renderHnaEdits === 'function') {
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
