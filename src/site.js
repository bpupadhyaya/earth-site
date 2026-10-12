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

  // Header mark: a small canvas globe that really rotates (same direction and speed as the main globe).
  // The static <img class="mark"> stays as the fallback if scripts, fetch or canvas are unavailable.
  (function () {
    var img = document.querySelector('.brand img.mark');
    if (!img || !window.fetch || !document.createElement('canvas').getContext) return;
    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var rings = null, lon0 = (-new Date().getTimezoneOffset() / 60) * 15, TILT = 18 * Math.PI / 180, lastLon = null, lastTilt = null, canvas, ctx, S, D, lastT = 0, started = false;
    function frame(t) {
      var dt = lastT ? Math.min(100, t - lastT) : 0; lastT = t;
      var g = window.earthGlobe; // main globe on this page: mirror its longitude and tilt exactly
      if (g) { lon0 = g.lon; TILT = Math.max(-60, Math.min(60, g.lat)) * Math.PI / 180; }
      else if (!reduce) lon0 -= dt * 0.0055; // otherwise spin on our own, eastward like the main globe
      if (lon0 === lastLon && TILT === lastTilt) return;
      lastLon = lon0; lastTilt = TILT; draw();
    }
    function draw() {
      var R = S / 2 - 1, c = S / 2, lam0 = lon0 * Math.PI / 180, sT = Math.sin(TILT), cT = Math.cos(TILT);
      ctx.setTransform(D, 0, 0, D, 0, 0); ctx.clearRect(0, 0, S, S);
      var g = ctx.createRadialGradient(c - R * .35, c - R * .4, R * .1, c, c, R);
      g.addColorStop(0, '#4aa9cc'); g.addColorStop(1, '#0b4560');
      ctx.beginPath(); ctx.arc(c, c, R, 0, 6.2832); ctx.fillStyle = g; ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(c, c, R, 0, 6.2832); ctx.clip();
      ctx.beginPath();
      for (var i = 0; i < rings.length; i++) {
        var r = rings[i], first = true;
        for (var j = 0; j < r.length; j += 2) {
          var phi = r[j + 1] * Math.PI / 180, dl = r[j] * Math.PI / 180 - lam0, cp = Math.cos(phi);
          var x = cp * Math.sin(dl), y = cT * Math.sin(phi) - sT * cp * Math.cos(dl), z = sT * Math.sin(phi) + cT * cp * Math.cos(dl);
          if (z < 0) { var h = Math.hypot(x, y) || 1; x /= h; y /= h; } // hidden points slide to the limb
          if (first) { ctx.moveTo(c + R * x, c - R * y); first = false; } else ctx.lineTo(c + R * x, c - R * y);
        }
        ctx.closePath();
      }
      ctx.fillStyle = '#7bd896'; ctx.fill();
      var sh = ctx.createRadialGradient(c - R * .25, c - R * .3, R * .3, c, c, R * 1.02);
      sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(.75, 'rgba(0,10,20,.12)'); sh.addColorStop(1, 'rgba(0,10,20,.5)');
      ctx.fillStyle = sh; ctx.fillRect(0, 0, S, S);
      var sp = ctx.createRadialGradient(c - R * .4, c - R * .45, 0, c - R * .4, c - R * .45, R * .65);
      sp.addColorStop(0, 'rgba(255,255,255,.35)'); sp.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sp; ctx.fillRect(0, 0, S, S);
      ctx.restore();
      ctx.beginPath(); ctx.arc(c, c, R, 0, 6.2832); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1; ctx.stroke();
    }
    function loop(t) { if (!document.hidden && (!lastT || t - lastT > 30)) frame(t); requestAnimationFrame(loop); }
    fetch(BASE + 'assets/mark-land.json').then(function (r) { return r.json(); }).then(function (j) {
      rings = j.rings; S = Math.round(img.getBoundingClientRect().width) || 32; D = Math.min(window.devicePixelRatio || 1, 2);
      canvas = document.createElement('canvas'); canvas.className = img.className; canvas.setAttribute('aria-hidden', 'true');
      canvas.width = S * D; canvas.height = S * D; canvas.style.width = S + 'px'; canvas.style.height = S + 'px';
      ctx = canvas.getContext('2d'); draw(); img.parentNode.replaceChild(canvas, img);
      requestAnimationFrame(loop);
    }).catch(function () {});
  })();

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
