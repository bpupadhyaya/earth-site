/* Earth site: theme + text-size controls, and a sharded client-side search that scales to very large catalogs. */
(function () {
  var root = document.documentElement;
  var BASE = root.getAttribute('data-base') || '/';
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // Theme: auto + named themes, chosen from a menu (the stored value is the data-theme attribute).
  var themes = ['auto', 'light', 'dark', 'clinical', 'sepia', 'ocean', 'forest', 'contrast'];
  function applyTheme(t) { if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t); }
  var theme = load('earth.theme'); if (themes.indexOf(theme) < 0) theme = 'auto'; applyTheme(theme);
  var tb = document.getElementById('theme-ctl');
  if (tb) { tb.value = theme; tb.addEventListener('change', function () { theme = tb.value; applyTheme(theme); store('earth.theme', theme === 'auto' ? null : theme); }); }

  // Text size: normal -> large -> xlarge
  var sizes = ['normal', 'large', 'xlarge'];
  function applySize(s) { if (s === 'normal') root.removeAttribute('data-size'); else root.setAttribute('data-size', s); }
  var size = load('earth.size') || 'normal'; applySize(size);
  var sb = document.getElementById('size-ctl');
  if (sb) sb.addEventListener('click', function () { size = sizes[(sizes.indexOf(size) + 1) % sizes.length]; applySize(size); store('earth.size', size === 'normal' ? null : size); });

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
