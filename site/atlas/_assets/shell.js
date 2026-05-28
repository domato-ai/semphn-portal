/*
 * SEMPHN HNA Workbench — shared shell JavaScript.
 *
 * Responsibilities:
 *   1. Auth gate         — redirect to /signin/ if no session, hydrate the
 *                          user pill in the header otherwise.
 *   2. Per-step state    — narrative drafts + decision selections + "ready"
 *                          flag stored in localStorage under DOMATO_KEY.
 *   3. Progress tracking — calculates "n of 13 steps ready" and exposes it
 *                          via window.HNAState for the progress bar.
 *   4. Chat assist mock  — wires .chat-prompts buttons and the input to
 *                          append fake bot replies. The bot replies are
 *                          intentionally generic — real Claude integration
 *                          is a follow-up.
 *
 * No innerHTML anywhere — every dynamic insertion goes through textContent
 * or createElement so the page is safe even if step names ever come from
 * user-supplied input.
 */
(function () {
  'use strict';

  var AUTH_KEY = 'domato.semphn.session';
  var STATE_KEY = 'semphn.hna.state.v1';
  var SIGNIN = '/signin/';

  /* The canonical 13 steps. Order here drives the progress bar + nav. */
  var STEPS = [
    { num: 1,  slug: '01-introduction',     name: 'About this assessment' },
    { num: 2,  slug: '02-region',           name: 'Our region' },
    { num: 3,  slug: '03-cald',             name: 'CALD' },
    { num: 4,  slug: '04-first-nations',    name: 'First Nations people' },
    { num: 5,  slug: '05-older-people',     name: 'Older people (65+)' },
    { num: 6,  slug: '06-homelessness',     name: 'Homelessness' },
    { num: 7,  slug: '07-mental-health',    name: 'Mental health' },
    { num: 8,  slug: '08-aod',              name: 'Alcohol & other drugs' },
    { num: 9,  slug: '09-chronic-disease',  name: 'Chronic disease' },
    { num: 10, slug: '10-workforce',        name: 'Health workforce' },
    { num: 11, slug: '11-recommendations',  name: 'Recommendations' },
    { num: 12, slug: '12-preflight',        name: 'Pre-flight check' },
    { num: 13, slug: '13-lodgement',        name: 'Lodge to PPERS' },
  ];

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
      var raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function writeState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  function readStep(slug) {
    var s = readState();
    return s[slug] || { narrative: '', decisions: {}, ready: false, savedAt: null };
  }

  function writeStep(slug, partial) {
    var s = readState();
    s[slug] = Object.assign({}, readStep(slug), partial, { savedAt: new Date().toISOString() });
    writeState(s);
  }

  function readyCount() {
    var s = readState();
    var n = 0;
    STEPS.forEach(function (st) {
      if (s[st.slug] && s[st.slug].ready) n += 1;
    });
    return n;
  }

  function gate() {
    if (window.location.pathname.indexOf('/atlas/') !== 0) return null;
    var sess = readSession();
    if (!sess) {
      var next = window.location.pathname + window.location.search + window.location.hash;
      window.location.replace(SIGNIN + '?next=' + encodeURIComponent(next));
      return null;
    }
    return sess;
  }

  function hydrateUserPill(session) {
    var pill = document.querySelector('.shell-user');
    if (!pill) return;
    var name = pill.querySelector('.shell-user-meta .name');
    if (name) name.textContent = session.tenantName || 'SEMPHN';
    var sub = pill.querySelector('.shell-user-meta .sub');
    if (sub) sub.textContent = session.email || '';
    var mark = pill.querySelector('.shell-user-mark');
    if (mark && session.email) mark.textContent = session.email.charAt(0).toUpperCase();
    var out = pill.querySelector('.shell-user-out');
    if (out && !out.dataset.bound) {
      out.dataset.bound = '1';
      out.addEventListener('click', function (e) {
        e.preventDefault();
        clearSession();
        window.location.href = SIGNIN;
      });
    }
  }

  function hydrateProgressBar() {
    var bar = document.querySelector('.shell-progress');
    if (!bar) return; // page is not a numbered step (Welcome, Lodgement)
    var stepNum = parseInt(bar.dataset.step || '0', 10);
    if (!stepNum) return;
    var spec = STEPS[stepNum - 1];
    if (!spec) return;
    var done = readyCount();
    var pct = Math.round((done / STEPS.length) * 100);
    var meta = bar.querySelector('.shell-progress-meta');
    if (meta) {
      // Build "Step N of 13" + step name via safe DOM nodes (no innerHTML).
      while (meta.firstChild) meta.removeChild(meta.firstChild);
      meta.appendChild(document.createTextNode('Step '));
      var strong = document.createElement('strong');
      strong.textContent = stepNum + ' of ' + STEPS.length;
      meta.appendChild(strong);
      var nameSpan = document.createElement('span');
      nameSpan.className = 'step-name';
      nameSpan.textContent = spec.name;
      meta.appendChild(nameSpan);
    }
    var fill = bar.querySelector('.shell-progress-fill');
    if (fill) fill.style.width = pct + '%';
    var pctEl = bar.querySelector('.shell-progress-pct');
    if (pctEl) pctEl.textContent = pct + '%';

    var nav = bar.querySelector('.shell-progress-nav');
    if (nav && !nav.dataset.bound) {
      nav.dataset.bound = '1';
      var prev = STEPS[stepNum - 2];
      var next = STEPS[stepNum];
      var prevLink = nav.querySelector('a[data-nav="prev"]');
      var nextLink = nav.querySelector('a[data-nav="next"]');
      if (prevLink) {
        if (prev) {
          prevLink.href = '/atlas/' + prev.slug + '/';
          prevLink.textContent = '← Back';
        } else {
          prevLink.href = '/atlas/';
          prevLink.textContent = '← Welcome';
        }
      }
      if (nextLink) {
        if (next) {
          nextLink.href = '/atlas/' + next.slug + '/';
          nextLink.textContent = 'Skip →';
        } else {
          nextLink.setAttribute('aria-disabled', 'true');
          nextLink.textContent = 'Final step';
        }
      }
    }
  }

  function bindNarrative() {
    var ta = document.querySelector('textarea.narrative');
    if (!ta) return;
    var slug = ta.dataset.slug;
    if (!slug) return;
    var saved = readStep(slug);
    if (saved.narrative) ta.value = saved.narrative;
    var meta = document.querySelector('.narrative-meta .saved');
    if (saved.savedAt && meta) meta.textContent = 'Saved ' + new Date(saved.savedAt).toLocaleString();

    var t;
    ta.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        writeStep(slug, { narrative: ta.value });
        if (meta) meta.textContent = 'Saved ' + new Date().toLocaleString();
      }, 600);
    });
  }

  function bindDecisions() {
    var list = document.querySelector('ul.decisions');
    if (!list) return;
    var slug = list.dataset.slug;
    if (!slug) return;
    var saved = readStep(slug).decisions || {};
    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (saved[cb.value]) {
        cb.checked = true;
        cb.closest('li').classList.add('is-on');
      }
      cb.addEventListener('change', function () {
        var cur = readStep(slug).decisions || {};
        cur[cb.value] = cb.checked;
        writeStep(slug, { decisions: cur });
        cb.closest('li').classList.toggle('is-on', cb.checked);
      });
    });
  }

  function bindReadyButton() {
    var btn = document.querySelector('[data-action="mark-ready"]');
    if (!btn) return;
    var slug = btn.dataset.slug;
    var nextSlug = btn.dataset.next;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      writeStep(slug, { ready: true });
      if (nextSlug) {
        window.location.href = '/atlas/' + nextSlug + '/';
      } else {
        window.location.reload();
      }
    });
  }

  /*
   * Chat assist — calls /api/chat (Azure SWA Function backed by Azure AI Foundry).
   *
   * Per-step context comes from two places on each step page:
   *   - data-step-context attribute on the .chat element (optional summary string)
   *   - data-replies attribute (fallback canned replies when /api/chat is down)
   *
   * The chat history is in-memory only — not persisted to localStorage, since
   * the context grows fast and the step's narrative is already saved separately.
   *
   * On API failure (cold start, Foundry outage, key missing) we surface a clear
   * "temporarily unavailable" notice and degrade to a single canned reply so
   * the page still feels alive.
   */
  function bindChat() {
    var chat = document.querySelector('.chat');
    if (!chat) return;
    var body = chat.querySelector('.chat-body');
    var input = chat.querySelector('.chat-input input');
    var send = chat.querySelector('.chat-input button');
    var prompts = chat.querySelectorAll('.chat-prompts button');

    var history = [];     // [{role, content}] — in-memory only
    var inFlight = false; // prevent stacked sends

    // Derive step slug/name from the progress bar metadata
    var progBar = document.querySelector('.shell-progress');
    var stepNum = progBar ? parseInt(progBar.dataset.step || '0', 10) : 0;
    var stepSpec = stepNum ? window.HNAState.steps[stepNum - 1] : null;
    var stepSlug = stepSpec ? stepSpec.slug : (chat.dataset.stepSlug || '');
    var stepName = stepSpec ? stepSpec.name : (chat.dataset.stepName || '');
    var contextSummary = chat.dataset.stepContext || '';

    function addMsg(text, who, cls) {
      var div = document.createElement('div');
      div.className = 'chat-msg ' + (who === 'user' ? 'user' : 'bot') + (cls ? ' ' + cls : '');
      div.textContent = text;
      body.appendChild(div);
      body.scrollTop = body.scrollHeight;
      return div;
    }

    function fallbackReply() {
      // Used when /api/chat errors. Pre-canned per-step replies for graceful degrade.
      var canned = chat.dataset.replies ? chat.dataset.replies.split('||') : null;
      if (canned && canned.length) {
        return canned[Math.floor(Math.random() * canned.length)];
      }
      return "Chat assist is temporarily unavailable. Try again in a moment.";
    }

    function callApi(latestUserText) {
      var thinkingNode = addMsg('Thinking…', 'bot', 'thinking');
      thinkingNode.style.opacity = '0.6';
      thinkingNode.style.fontStyle = 'italic';

      return fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step_slug: stepSlug,
          step_name: stepName,
          context_summary: contextSummary,
          messages: history,
        }),
      })
      .then(function (r) {
        return r.json().then(function (data) { return { status: r.status, data: data }; });
      })
      .then(function (res) {
        if (thinkingNode && thinkingNode.parentNode) thinkingNode.parentNode.removeChild(thinkingNode);
        if (res.status === 200 && res.data && res.data.reply) {
          var reply = res.data.reply;
          history.push({ role: 'assistant', content: reply });
          addMsg(reply, 'bot');
        } else {
          var msg = (res.data && res.data.error) || 'Chat assist temporarily unavailable.';
          addMsg(msg, 'bot');
          // Also add a graceful canned reply so the user sees something useful
          setTimeout(function () { addMsg(fallbackReply(), 'bot'); }, 200);
        }
      })
      .catch(function () {
        if (thinkingNode && thinkingNode.parentNode) thinkingNode.parentNode.removeChild(thinkingNode);
        addMsg('Network error — chat assist offline.', 'bot');
        setTimeout(function () { addMsg(fallbackReply(), 'bot'); }, 200);
      });
    }

    function handleSubmit(text) {
      if (!text || inFlight) return;
      addMsg(text, 'user');
      history.push({ role: 'user', content: text });
      inFlight = true;
      callApi(text).finally(function () { inFlight = false; });
    }

    if (send) send.addEventListener('click', function () {
      handleSubmit(input.value.trim());
      input.value = '';
    });
    if (input) input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit(input.value.trim());
        input.value = '';
      }
    });
    prompts.forEach(function (b) {
      b.addEventListener('click', function () {
        handleSubmit(b.textContent.trim());
      });
    });
  }

  function init() {
    var sess = gate();
    if (!sess) return;
    hydrateUserPill(sess);
    hydrateProgressBar();
    bindNarrative();
    bindDecisions();
    bindReadyButton();
    bindChat();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.HNAState = {
    session: readSession,
    state: readState,
    step: readStep,
    readyCount: readyCount,
    steps: STEPS,
    signOut: function () { clearSession(); window.location.href = SIGNIN; },
  };
})();
