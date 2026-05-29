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
   * Dashboards suggestions are BUILD prompts — they ask the chat to
   * generate a widget that lands on the right canvas as a tile. */
  var SUGGESTIONS = {
    hna: [
      { icon: '✎', label: 'Draft Chapter 4 opening',     prompt: 'Draft the opening paragraph for Chapter 4: First Nations people, anchored on IRSEO 25 (vs Victoria 14) and MH prevalence above 18.3% in Port Phillip, Frankston and Greater Dandenong.' },
      { icon: '✎', label: 'Summarise strongest finding', prompt: 'In 3 sentences I can drop into the executive summary, what is the strongest cross-chapter finding for SEMPHN this cycle?' },
      { icon: '⟳', label: 'Soften a paragraph',          prompt: 'Rewrite the Greater Dandenong housing-strain paragraph in a more strengths-based voice while keeping every figure.' },
      { icon: '⚑', label: 'Compliance critique',         prompt: 'Looking at the current Chapter 4 draft, what data or framing is the DoH Performance Rubric most likely to flag as missing or thin?' },
      { icon: '↔', label: 'Cross-reference chapters',    prompt: 'Where does the First Nations chapter (4) need a cross-reference to the Mental health chapter (7) for coherence?' },
      { icon: '◉', label: 'Pre-flight check',            prompt: 'Run the DoH Compliance Checklist + Performance Rubric on the current Chapter 4 draft. Flag warnings.' },
    ],
    dashboards: [
      { icon: '#', label: 'KPI · catchment population',        prompt: 'Add a KPI tile showing the SEMPHN catchment population (2024) with the growth-pa delta.' },
      { icon: '▮', label: 'Bar · MH conditions by LGA',        prompt: 'Build a bar chart of MH conditions per 1,000 by LGA, ranked highest to lowest. Highlight Frankston as the standout.' },
      { icon: '▮', label: 'Bar · Bulk-billing by LGA',         prompt: 'Build a bar chart of bulk-billing percentage by LGA, ranked highest to lowest.' },
      { icon: '▮', label: 'Bar · GP practices by LGA',         prompt: 'Build a bar chart of GP practice counts by LGA, ranked highest to lowest. Title: "GP practices · 31 Jul 2024".' },
      { icon: '▮', label: 'Bar · FY26 funding schedules',      prompt: 'Build a bar chart of FY26 funding schedules by value (AUD), ranked highest to lowest. Unit: aud.' },
      { icon: '▤', label: 'Table · Recent commissioning',      prompt: 'Build a table widget showing the recent commissioning activity — columns: Activity, LGA, Schedule, Value, Status.' },
      { icon: '#', label: 'KPI · Bowel screening rate',        prompt: 'Add a KPI tile for the catchment bowel cancer screening rate with the delta indicator.' },
      { icon: '▮', label: 'Bar · Homeless rate by LGA',        prompt: 'Build a bar chart of homeless + marginal housing rate per 10k by LGA, ranked highest to lowest. Highlight Greater Dandenong.' },
    ],
    maps: [
      { icon: '◐', label: 'MH choropleth',                prompt: 'Map MH conditions per 1,000 residents across the 10 SEMPHN LGAs. Choropleth, navy-to-teal scale. Frankston should be the darkest at 116.1.' },
      { icon: '◉', label: 'Locate every ACCHS',           prompt: 'Plot the 2 ACCHS in the SEMPHN catchment as points on a map. Add the catchment LGA outlines for context.' },
      { icon: '▦', label: 'SEIFA disadvantage',           prompt: 'Choropleth of SEIFA disadvantage by LGA. Annotate Greater Dandenong, Casey, Frankston as the top three disadvantaged.' },
      { icon: '↗', label: 'Growth corridor',              prompt: 'Highlight the South East Growth Corridor — Cardinia, Casey, Greater Dandenong — with their projected 2030 population overlaid.' },
      { icon: '●', label: 'Service points overlay',       prompt: 'Plot all 9 headspace centres + 2 ACCHS + 155 RACFs on the catchment map. Colour-code by service type.' },
      { icon: '◌', label: 'Refugee settlement density',   prompt: 'Heat-map the humanitarian-arrival settlement density across the catchment. Casey + Greater Dandenong should dominate.' },
    ],
  };

  /* ============================================================
   * Widget rendering (Dashboards builder)
   *
   * When the chat reply contains a ```widget JSON block,
   * we extract the spec, append it to the persisted widget list
   * for this page, and render it as a tile on the canvas grid.
   * The JSON block is stripped from the visible chat reply.
   * ============================================================ */
  var WIDGET_KEY = 'semphn.workbench.widgets.v1';
  var WIDGET_RE = /```widget\s*\n([\s\S]*?)```/;

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
  function extractWidget(text) {
    if (!text) return { stripped: '', widget: null };
    var m = text.match(WIDGET_RE);
    if (!m) return { stripped: text, widget: null };
    try {
      var w = JSON.parse(m[1].trim());
      return { stripped: text.replace(WIDGET_RE, '').trim(), widget: w };
    } catch (e) {
      return { stripped: text, widget: null };
    }
  }

  function buildBarSVG(widget) {
    var data = widget.data || [];
    if (!data.length) return null;
    var w = 520, h = 260, padL = 130, padR = 24, padT = 16, padB = 24;
    var max = Math.max.apply(null, data.map(function (d) { return Number(d.value) || 0; }));
    if (max <= 0) max = 1;
    var barH = Math.max(14, Math.floor((h - padT - padB) / data.length) - 6);
    var rowH = Math.floor((h - padT - padB) / data.length);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'wgt-svg');
    svg.setAttribute('preserveAspectRatio', 'none');
    // axis line
    var axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', padL); axis.setAttribute('x2', w - padR);
    axis.setAttribute('y1', padT); axis.setAttribute('y2', padT);
    axis.setAttribute('stroke', '#E6EBF3');
    svg.appendChild(axis);
    data.forEach(function (d, i) {
      var y = padT + i * rowH + 3;
      var lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', padL - 8); lbl.setAttribute('y', y + barH * 0.7);
      lbl.setAttribute('text-anchor', 'end');
      lbl.setAttribute('font-family', 'Jost,sans-serif');
      lbl.setAttribute('font-size', '11'); lbl.setAttribute('fill', '#324354');
      lbl.textContent = d.label || '';
      svg.appendChild(lbl);
      var isHi = widget.highlight && d.label === widget.highlight;
      var bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      var bw = ((Number(d.value) || 0) / max) * (w - padL - padR - 50);
      bar.setAttribute('x', padL); bar.setAttribute('y', y);
      bar.setAttribute('width', Math.max(2, bw)); bar.setAttribute('height', barH);
      bar.setAttribute('rx', '3'); bar.setAttribute('fill', isHi ? '#55BFAF' : '#04264E');
      svg.appendChild(bar);
      var vlbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      vlbl.setAttribute('x', padL + bw + 6); vlbl.setAttribute('y', y + barH * 0.7);
      vlbl.setAttribute('font-family', 'JetBrains Mono,monospace');
      vlbl.setAttribute('font-size', '10'); vlbl.setAttribute('fill', '#04264E');
      vlbl.setAttribute('font-weight', '600');
      vlbl.textContent = formatValue(d.value, widget.unit);
      svg.appendChild(vlbl);
    });
    return svg;
  }
  function buildLineSVG(widget) {
    var data = widget.data || [];
    if (!data.length) return null;
    var w = 520, h = 240, padL = 40, padR = 16, padT = 16, padB = 32;
    var values = data.map(function (d) { return Number(d.value) || 0; });
    var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
    if (max === min) max = min + 1;
    var innerW = w - padL - padR, innerH = h - padT - padB;
    function x(i) { return padL + (i / (data.length - 1 || 1)) * innerW; }
    function y(v) { return padT + (1 - (v - min) / (max - min)) * innerH; }
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h); svg.setAttribute('class', 'wgt-svg');
    var grid = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    grid.setAttribute('x1', padL); grid.setAttribute('x2', w - padR);
    grid.setAttribute('y1', h - padB); grid.setAttribute('y2', h - padB);
    grid.setAttribute('stroke', '#D6DFEB'); svg.appendChild(grid);
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    path.setAttribute('points', data.map(function (d, i) { return x(i) + ',' + y(Number(d.value) || 0); }).join(' '));
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#55BFAF');
    path.setAttribute('stroke-width', '2.5'); path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    data.forEach(function (d, i) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', x(i)); c.setAttribute('cy', y(Number(d.value) || 0));
      c.setAttribute('r', '4'); c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#55BFAF'); c.setAttribute('stroke-width', '2.5');
      svg.appendChild(c);
      var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.setAttribute('x', x(i)); t.setAttribute('y', h - 10);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', 'Jost,sans-serif'); t.setAttribute('font-size', '10'); t.setAttribute('fill', '#6B7B8C');
      t.textContent = d.label || '';
      svg.appendChild(t);
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
  function buildKpiNode(widget) {
    var data = (widget.data || [])[0] || {};
    var wrap = document.createElement('div'); wrap.className = 'wgt-kpi';
    var v = document.createElement('div'); v.className = 'v';
    v.textContent = formatValue(data.value, widget.unit);
    var d = document.createElement('div'); d.className = 'd';
    if (widget.delta) {
      var down = String(widget.delta).startsWith('-');
      var dchip = document.createElement('span'); dchip.className = 'delta ' + (down ? 'down' : 'up');
      dchip.textContent = widget.delta;
      d.appendChild(dchip);
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

  function buildWidgetCard(widget, onDelete) {
    var card = document.createElement('div'); card.className = 'wgt-card wgt-type-' + (widget.type || 'unknown');
    // Head
    var head = document.createElement('div'); head.className = 'wgt-head';
    var title = document.createElement('div'); title.className = 'wgt-title';
    var t = document.createElement('div'); t.className = 'wgt-t'; t.textContent = widget.title || 'Untitled widget';
    var s = document.createElement('div'); s.className = 'wgt-s'; s.textContent = widget.subtitle || '';
    title.appendChild(t); if (widget.subtitle) title.appendChild(s);
    var actions = document.createElement('div'); actions.className = 'wgt-actions';
    var del = document.createElement('button'); del.type = 'button'; del.title = 'Delete widget'; del.textContent = '×';
    del.addEventListener('click', onDelete);
    actions.appendChild(del);
    head.appendChild(title); head.appendChild(actions);
    card.appendChild(head);
    // Body
    var body = document.createElement('div'); body.className = 'wgt-body';
    var node = null;
    if (widget.type === 'bar')       node = buildBarSVG(widget);
    else if (widget.type === 'line') node = buildLineSVG(widget);
    else if (widget.type === 'kpi')  node = buildKpiNode(widget);
    else if (widget.type === 'table')node = buildTableNode(widget);
    if (!node) { node = document.createElement('div'); node.className = 'wgt-empty'; node.textContent = 'Unable to render widget of type "' + (widget.type || '?') + '".'; }
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

  function renderWidgets() {
    var grid = document.getElementById('widget-grid');
    console.log('[widget] renderWidgets · grid found:', !!grid);
    if (!grid) return;
    var page = pageId();
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    var widgets = readWidgets(page);
    console.log('[widget] renderWidgets · widgets count:', widgets.length);
    var empty = document.getElementById('widget-empty');
    if (empty) empty.hidden = widgets.length > 0;
    widgets.forEach(function (w, idx) {
      try {
        var card = buildWidgetCard(w, function () {
          var arr = readWidgets(page);
          arr.splice(idx, 1);
          writeWidgets(page, arr);
          renderWidgets();
          showToast('Widget removed', 'success');
        });
        if (!card) { console.error('[widget] buildWidgetCard returned null for widget', idx, w); return; }
        grid.appendChild(card);
      } catch (e) {
        console.error('[widget] failed to render widget', idx, e, w);
      }
    });
    console.log('[widget] renderWidgets · cards in grid:', grid.children.length);
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
  window.__extractWidget = extractWidget;

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
      th.appendChild(document.createTextNode('Thinking'));
      var dots = document.createElement('span'); dots.className = 'dots';
      dots.appendChild(document.createElement('span'));
      dots.appendChild(document.createElement('span'));
      dots.appendChild(document.createElement('span'));
      th.appendChild(dots);
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

    return wrap;
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

    var sugsLabel = document.createElement('div');
    sugsLabel.className = 'chat-empty-suglabel';
    sugsLabel.textContent = 'Try one of these';
    wrap.appendChild(sugsLabel);

    var grid = document.createElement('div'); grid.className = 'chat-empty-sugs';
    sugs.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-empty-sug';
      var ic = document.createElement('span'); ic.className = 'ico'; ic.textContent = s.icon;
      var lab = document.createElement('span'); lab.className = 'label'; lab.textContent = s.label;
      btn.appendChild(ic); btn.appendChild(lab);
      btn.addEventListener('click', function () {
        var input = document.getElementById('chat-input');
        if (!input) return;
        input.value = s.prompt;
        input.dispatchEvent(new Event('input'));
        input.focus();
        // Auto-send the suggestion (same behaviour as Send button)
        var send = document.getElementById('chat-send');
        if (send && !send.disabled) send.click();
      });
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);

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
  function wireComposer(contextSummary) {
    var input = document.getElementById('chat-input');
    var send  = document.getElementById('chat-send');
    if (!input || !send) return;

    var meta = PAGE_META[pageId()] || PAGE_META.dashboards;
    var promptLabel = document.querySelector('.composer-prompt');
    if (promptLabel) promptLabel.textContent = meta.composerLabel;
    input.placeholder = meta.placeholder;

    var busy = false;
    function setBusy(b) { busy = b; send.disabled = b || !input.value.trim(); updateStatus(b ? 'thinking' : 'idle'); }

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 144) + 'px';
      send.disabled = busy || !input.value.trim();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    });
    send.addEventListener('click', handleSend);

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
        if (pageId() === 'dashboards') {
          console.log('[widget] reply length:', reply.length, '· has ```widget:', reply.indexOf('```widget') >= 0);
          if (typeof window.__extractWidget === 'function') {
            try {
              var parsed = window.__extractWidget(reply);
              console.log('[widget] extracted:', parsed.widget);
              if (parsed.widget) {
                window.__addWidget(parsed.widget);
                console.log('[widget] addWidget called, persisted widgets:', JSON.parse(localStorage.getItem('semphn.workbench.widgets.v1') || '{}').dashboards || []);
                reply = parsed.stripped || ('Added the widget "' + (parsed.widget.title || 'untitled') + '" to your dashboard.');
              } else {
                console.warn('[widget] no ```widget block found in reply');
              }
            } catch (e) {
              console.error('[widget] extract/add failed', e);
            }
          } else {
            console.error('[widget] window.__extractWidget is not a function:', typeof window.__extractWidget);
          }
        }

        turn.summary = reply;
        turn.thinking = false;
        setPageTurns(pageId(), turns);
        renderFeed();
        updateLastSaved();
      } catch (err) {
        turn.summary = 'Sorry — the assist is unreachable right now. Please retry.';
        turn.thinking = false;
        setPageTurns(pageId(), turns);
        renderFeed();
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
    renderFeed();
    var contextSummary = document.body.getAttribute('data-context')
      || 'SEMPHN catchment: 1.56M residents across 10 LGAs (Bayside, Cardinia, Casey, Frankston, Glen Eira, Greater Dandenong, Kingston, Mornington Peninsula, Port Phillip, Stonnington). First Nations IRSEO 25 vs Vic 14. MH prevalence above 18.3% in Port Phillip (23.3), Frankston (22.0), Greater Dandenong (21.4). Lowest bowel screening: Casey South 35.9%, Dandenong 38.3%, Frankston 39.3%. Frankston highest MH conditions at 116.1/1k.';
    wireComposer(contextSummary);
    wireResize();
    wireGlobalShortcuts();
    updateStatus('idle');
    refreshSavedLabel();
    setInterval(refreshSavedLabel, 30000);
    if (pageId() === 'dashboards' && typeof window.__renderWidgets === 'function') {
      window.__renderWidgets();
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
