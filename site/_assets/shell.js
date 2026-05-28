/*
 * SEMPHN Workbench — shared shell behaviour
 *
 * Per-page (loaded by /hna, /dashboards, /maps). Each page sets
 * <body data-page="hna|dashboards|maps"> and the shell does the rest:
 *
 *   1. Auth gate — bounce to /signin/ without session, hydrate user pill.
 *   2. Nav highlight — mark the current page link active.
 *   3. Sign-out — wired on the .nav-user .nav-user-out button.
 *   4. Chat feed — renders persisted turns for THIS page only.
 *   5. Composer — type a message, hit Send (or Enter) → POSTs /api/chat
 *      with the page's chat history + page-specific context.
 *
 * All DOM dynamic via createElement/textContent — no innerHTML.
 */
(function () {
  'use strict';

  var AUTH_KEY  = 'domato.semphn.session';
  var STORE_KEY = 'semphn.workbench.turns.v3';
  var SIGNIN    = '/signin/';

  /* Per-page metadata — keys MUST match body[data-page] values */
  var PAGE_META = {
    hna: {
      name:    'HNA co-author',
      api_slug: 'workbench-hna',
      composerLabel: 'Ask for changes · HNA',
      placeholder: 'Draft, revise, or critique any chapter…',
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

  /* Per-page seed turn (matches Figma Make pattern — prompt, reasoning,
   * files, summary, version, optional warnings). These are the
   * "introductory build" so the chat panel isn't empty on first view. */
  var SEED = {
    dashboards: {
      prompt: 'Build a simple catchment dashboard with the headline SEMPHN metrics.',
      avatar: 'D',
      reasoning: "I'll build a 4-card KPI strip plus two charts (monthly GP consultations + bowel screening trend) plus a recent commissioning table. All anchored on real catchment data.",
      filesLabel: 'Worked with 4 files',
      files: ['site/dashboards/index.html', 'data/snapshot.json', 'lga/concordance.csv', 'crm/commissioning_30d.json'],
      summary: "I've built a catchment dashboard featuring four KPI cards (catchment population, active MH referrals, bowel screening rate, HNA chapters complete), a monthly GP consultations bar chart, a bowel cancer screening trend line, and a table of recent commissioning activity. Everything's themed in SEMPHN navy and teal and uses SVG so it renders instantly with no external chart library.",
      version: { title: 'Catchment dashboard', tag: 'Version 1' },
      warnings: { count: 3, label: '3 warnings · sample data only' },
    },
    hna: {
      prompt: 'Draft Chapter 4 (First Nations) opening — anchor on IRSEO and MH prevalence.',
      avatar: 'D',
      reasoning: 'I read the Ch 4 source bullets from SEMPHN HNA 2025-28. The two strongest cross-LGA findings are IRSEO 25 vs Vic 14, and MH prevalence > 18.3% in three LGAs. I anchored the deck on those two and wrote one supporting paragraph for each.',
      filesLabel: 'Worked with 3 files',
      files: ['site/hna/index.html', 'data/hna/ch04-spec.json', 'sources/abs-census-2021.csv'],
      summary: "I've drafted the Chapter 4 opening — a deck paragraph plus two H2 subsections (Socioeconomic determinants, Mental health). All figures are sourced from ABS Census 2021 + AIHW IRSEO by IARE + POLAR. Three chip-highlighted LGAs flag where MH prevalence exceeds the Victorian average.",
      version: { title: 'Chapter 4 opening', tag: 'Version 1' },
      warnings: null,
    },
    maps: {
      prompt: 'Map MH conditions per 1,000 residents by LGA — choropleth, navy-to-teal scale.',
      avatar: 'D',
      reasoning: 'Built as a schematic tile grid first (not geographically accurate but data-faithful). Frankston is the standout at 116.1 — flagged with the darkest tile and a teal-mint number for emphasis. Real GeoJSON choropleth ships in the next iteration.',
      filesLabel: 'Worked with 2 files',
      files: ['site/maps/index.html', 'data/polar/mh-conditions-by-lga.csv'],
      summary: 'Schematic catchment map rendered as SVG tiles. Frankston (116.1) is the deepest navy, Stonnington (76.9) the palest. Scale legend below. Real ABS LGA boundaries pending the GeoJSON loader.',
      version: { title: 'MH choropleth · schematic', tag: 'Version 1' },
      warnings: { count: 1, label: 'Schematic — not geographically accurate' },
    },
  };

  /* ============================================================
   * Session + state helpers
   * ============================================================ */
  function readSession() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return p && p.email ? p : null;
    } catch (_) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(AUTH_KEY); } catch (_) {}
  }
  function readState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      var s = raw ? JSON.parse(raw) : null;
      return (s && s.byPage) ? s : { byPage: {} };
    } catch (_) { return { byPage: {} }; }
  }
  function writeState(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  /* ============================================================
   * Init
   * ============================================================ */
  function pageId() {
    return document.body.getAttribute('data-page') || 'dashboards';
  }

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
        clearSession();
        location.href = SIGNIN;
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
   * Chat feed
   * ============================================================ */
  function getPageTurns(page) {
    var s = readState();
    if (!s.byPage[page]) s.byPage[page] = SEED[page] ? [JSON.parse(JSON.stringify(SEED[page]))] : [];
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
      turn.files.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = f;
        ul.appendChild(li);
      });
      fBody.appendChild(ul);
      fBtn.addEventListener('click', function () {
        var open = fBtn.getAttribute('aria-expanded') === 'true';
        fBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
        fBody.hidden = open;
      });
      wrap.appendChild(fBtn);
      wrap.appendChild(fBody);
    }

    if (turn.summary || turn.streaming) {
      var bod = document.createElement('div'); bod.className = 'turn-body';
      String(turn.summary || '').split(/\n\n+/).forEach(function (para) {
        var p = document.createElement('p');
        p.textContent = para;
        bod.appendChild(p);
      });
      if (turn.streaming) bod.classList.add('streaming');
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
        b.type = 'button';
        b.textContent = sym;
        b.addEventListener('click', function () { b.classList.toggle('is-on'); });
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
      var close = document.createElement('button'); close.type = 'button'; close.className = 'close'; close.textContent = '×';
      close.addEventListener('click', function () { wn.remove(); });
      right.appendChild(fix); right.appendChild(close);
      wn.appendChild(lbl); wn.appendChild(right);
      wrap.appendChild(wn);
    }

    return wrap;
  }

  function renderFeed() {
    var feed = document.getElementById('chat-feed');
    if (!feed) return;
    while (feed.firstChild) feed.removeChild(feed.firstChild);
    var turns = getPageTurns(pageId());
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

    // Set composer prompt + placeholder per page
    var meta = PAGE_META[pageId()] || PAGE_META.dashboards;
    var promptLabel = document.querySelector('.composer-prompt');
    if (promptLabel) promptLabel.textContent = meta.composerLabel;
    input.placeholder = meta.placeholder;

    var busy = false;

    function setBusy(b) {
      busy = b;
      send.disabled = b || !input.value.trim();
    }

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 144) + 'px';
      send.disabled = busy || !input.value.trim();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });
    send.addEventListener('click', handleSend);

    async function handleSend() {
      var text = input.value.trim();
      if (!text || busy) return;
      input.value = ''; input.style.height = 'auto';

      var turns = getPageTurns(pageId());
      var turn = { prompt: text, avatar: 'D', summary: '', streaming: true };
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

        turn.summary = reply;
        turn.streaming = false;
        setPageTurns(pageId(), turns);
        renderFeed();
      } catch (err) {
        turn.summary = 'Sorry — the assist is unreachable right now. Please retry.';
        turn.streaming = false;
        setPageTurns(pageId(), turns);
        renderFeed();
      } finally {
        setBusy(false);
        send.disabled = !input.value.trim();
      }
    }
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose tiny namespace for debugging from console
  window.SEMPHN = {
    page: pageId,
    session: readSession,
    state: readState,
    clear: function () { writeState({ byPage: {} }); renderFeed(); },
  };
})();
