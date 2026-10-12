/* Earth site: theme + text-size controls, and a sharded client-side search that scales to very large catalogs. */
(function () {
  var root = document.documentElement;
  var BASE = root.getAttribute('data-base') || '/';
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // Theme menu: default Nutrisize; 'auto' follows the device. Options are rendered by build.mjs.
  var tb = document.getElementById('theme-ctl');
  var tl = document.getElementById('theme-list');
  var opts = tl ? Array.prototype.slice.call(tl.querySelectorAll('[data-theme-value]')) : [];
  var themes = opts.map(function (o) { return o.getAttribute('data-theme-value'); });
  if (!themes.length) themes = ['nutrisize', 'auto'];
  function applyTheme(t) { if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t); }
  var theme = load('earth.theme'); if (themes.indexOf(theme) < 0) theme = 'nutrisize'; applyTheme(theme);
  function mark() {
    opts.forEach(function (o) {
      var on = o.getAttribute('data-theme-value') === theme;
      o.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && tb) {
        var cur = tb.querySelector('.sw'), src = o.querySelector('.sw');
        if (cur && src) cur.setAttribute('style', src.getAttribute('style'));
        tb.setAttribute('aria-label', 'Colour theme: ' + o.querySelector('.t-name').textContent);
      }
    });
  }
  function closeMenu(refocus) { if (!tl || tl.hidden) return; tl.hidden = true; tb.setAttribute('aria-expanded', 'false'); if (refocus) tb.focus(); }
  function openMenu() {
    tl.hidden = false; tb.setAttribute('aria-expanded', 'true');
    var sel = opts.filter(function (o) { return o.getAttribute('aria-selected') === 'true'; })[0] || opts[0];
    if (sel) sel.focus();
  }
  function choose(o) { theme = o.getAttribute('data-theme-value'); applyTheme(theme); store('earth.theme', theme); mark(); closeMenu(true); }
  mark();
  if (tb && tl) {
    tb.addEventListener('click', function () { if (tl.hidden) openMenu(); else closeMenu(false); });
    tb.addEventListener('keydown', function (e) { if (e.key === 'ArrowDown' && tl.hidden) { e.preventDefault(); openMenu(); } });
    opts.forEach(function (o, i) {
      o.addEventListener('click', function () { choose(o); });
      o.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowDown') { e.preventDefault(); opts[(i + 1) % opts.length].focus(); }
        else if (k === 'ArrowUp') { e.preventDefault(); opts[(i - 1 + opts.length) % opts.length].focus(); }
        else if (k === 'Home') { e.preventDefault(); opts[0].focus(); }
        else if (k === 'End') { e.preventDefault(); opts[opts.length - 1].focus(); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); choose(o); }
        else if (k === 'Escape') { e.preventDefault(); closeMenu(true); }
        else if (k === 'Tab') { closeMenu(false); }
      });
    });
    document.addEventListener('click', function (e) { if (!tl.hidden && !tl.contains(e.target) && !tb.contains(e.target)) closeMenu(false); });
  }

  // Text size: zoom 50% to 300% in steps (A- smaller, A+ larger, middle button resets to 100%).
  var STEPS = [50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
  var zoom = parseInt(load('earth.zoom'), 10); if (STEPS.indexOf(zoom) < 0) zoom = 100;
  var zi = document.getElementById('zoom-in'), zo = document.getElementById('zoom-out'), zv = document.getElementById('zoom-val');
  function applyZoom() {
    if (zoom === 100) root.style.removeProperty('--zoom'); else root.style.setProperty('--zoom', String(zoom / 100));
    if (zv) { zv.textContent = zoom + '%'; zv.setAttribute('aria-label', 'Text size ' + zoom + '%. Press to reset to 100%'); }
    if (zo) zo.disabled = zoom <= STEPS[0];
    if (zi) zi.disabled = zoom >= STEPS[STEPS.length - 1];
  }
  function stepZoom(d) { var i = STEPS.indexOf(zoom) + d; if (i < 0 || i >= STEPS.length) return; zoom = STEPS[i]; applyZoom(); store('earth.zoom', zoom === 100 ? null : String(zoom)); }
  if (zo) zo.addEventListener('click', function () { stepZoom(-1); });
  if (zi) zi.addEventListener('click', function () { stepZoom(1); });
  if (zv) zv.addEventListener('click', function () { zoom = 100; applyZoom(); store('earth.zoom', null); });
  applyZoom();

  // Search. Index layout (built by build.mjs):
  //   search/manifest.json      { docsPerChunk, chunks, shards: ["ab", ...] }
  //   search/t/<ab>.json        { "<token>": [docId, ...] }  tokens starting with "ab"
  //   search/d/<n>.json         [ {id, t, b, u, k, s}, ... ]  docs chunk n (by numeric id)
  var form = document.getElementById('search-form');
  if (!form) return;
  var input = form.querySelector('input[type="search"]');
  var list = document.getElementById('search-results');
  var status = document.getElementById('search-status');
  var manifest = null, shardCache = {}, chunkCache = {};
  function fetchJSON(u) { return fetch(u, { cache: 'force-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
  function getManifest() { return manifest ? Promise.resolve(manifest) : fetchJSON(BASE + 'search/manifest.json').then(function (m) { manifest = m; return m; }); }
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, ' '); }
  function tokens(q) { return norm(q).split(/[\s-]+/).filter(function (t) { return t.length >= 2; }); }
  function shardFor(tok) { return tok.slice(0, 2); }
  function getShard(id) { if (shardCache[id]) return shardCache[id]; shardCache[id] = fetchJSON(BASE + 'search/t/' + id + '.json').catch(function () { return {}; }); return shardCache[id]; }
  function getChunk(n) { if (chunkCache[n]) return chunkCache[n]; chunkCache[n] = fetchJSON(BASE + 'search/d/' + n + '.json').catch(function () { return []; }); return chunkCache[n]; }

  function search(q) {
    var toks = tokens(q);
    if (!toks.length) { render([], ''); return; }
    getManifest().then(function (m) {
      var shardIds = {}; toks.forEach(function (t) { var s = shardFor(t); if (m.shards.indexOf(s) !== -1) shardIds[s] = true; });
      return Promise.all(Object.keys(shardIds).map(getShard)).then(function (shards) {
        var merged = {}; shards.forEach(function (s) { for (var k in s) merged[k] = s[k]; });
        // Per query token: union of docs whose indexed token starts with it; then intersect across tokens.
        var sets = toks.map(function (t) {
          var hits = {};
          for (var k in merged) if (k.indexOf(t) === 0) { var w = k === t ? 2 : 1; merged[k].forEach(function (id) { hits[id] = Math.max(hits[id] || 0, w); }); }
          return hits;
        });
        var scores = {};
        for (var id in sets[0]) { var ok = true, sc = 0; for (var i = 0; i < sets.length; i++) { if (!(id in sets[i])) { ok = false; break; } sc += sets[i][id]; } if (ok) scores[id] = sc; }
        var ids = Object.keys(scores).map(Number).sort(function (a, b) { return scores[b] - scores[a] || a - b; }).slice(0, 60);
        var chunks = {}; ids.forEach(function (id) { chunks[Math.floor(id / m.docsPerChunk)] = true; });
        return Promise.all(Object.keys(chunks).map(getChunk)).then(function (loaded) {
          var byId = {}; loaded.forEach(function (c) { c.forEach(function (d) { byId[d.id] = d; }); });
          render(ids.map(function (id) { return byId[id]; }).filter(Boolean), q);
        });
      });
    }).catch(function () { render([], q, true); });
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render(docs, q, failed) {
    list.innerHTML = '';
    if (!q) { status.textContent = ''; return; }
    if (failed) { status.textContent = 'Search is unavailable right now.'; return; }
    status.textContent = docs.length ? docs.length + (docs.length === 60 ? '+' : '') + ' result' + (docs.length === 1 ? '' : 's') : 'Nothing found for "' + q + '".';
    docs.forEach(function (d) {
      var li = document.createElement('li');
      li.innerHTML = '<a href="' + BASE + esc(d.u) + '">' + esc(d.t) + '</a>' + (d.s ? ' <span class="badge badge--' + esc(d.s) + '">' + esc(d.s) + '</span>' : '') + '<div class="kind">' + esc(d.k) + '</div>' + (d.b ? '<div class="blurb">' + esc(d.b) + '</div>' : '');
      list.appendChild(li);
    });
  }
  var timer;
  input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { search(input.value.trim()); }, 160); });
  form.addEventListener('submit', function (e) { e.preventDefault(); search(input.value.trim()); });
  var params = new URLSearchParams(location.search); var q0 = params.get('q'); if (q0) { input.value = q0; search(q0); }
})();
