/* Earth site: interactive globe.
   Canvas globe built on d3-geo + topojson-client (vendored, ISC) and Natural Earth country shapes
   (world-atlas, public domain). Two views the visitor can switch between: Sphere (orthographic, drag to spin with
   inertia) and Flat (Natural Earth projection, drag to pan, wraps around the dateline). Pinch / Ctrl-scroll / buttons
   to zoom, tap markers or countries, filter by kind, real-time day/night terminator. Falls back to the static SVG if
   anything fails to load. Places come from assets/places.json (curated, sourced; see content/places.json). */
(function () {
  'use strict';
  var host = document.getElementById('globe');
  if (!host || !window.d3 || !window.topojson || !d3.geoOrthographic) return;
  var root = document.documentElement;
  var BASE = root.getAttribute('data-base') || '/';
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var RAD = Math.PI / 180, TAU = Math.PI * 2;

  var KIND_COLOR = { heritage: '#f5b82e', nature: '#ee5a4c', wildlife: '#8f68f0', extremes: '#e2408f' };
  var KIND_LIGHT = { heritage: '#ffe08a', nature: '#ff9d92', wildlife: '#c4a9ff', extremes: '#ff8fc3' };
  var KIND_DARK = { heritage: '#b27a00', nature: '#b52b1f', wildlife: '#5a34c4', extremes: '#a8185f' };
  var KIND_INK = { heritage: '#4a3000', nature: '#fff', wildlife: '#fff', extremes: '#fff' };
  var KIND_LABEL = { heritage: 'Heritage', nature: 'Nature', wildlife: 'Wildlife', extremes: 'Extremes' };

  var savedView = 'sphere';
  try { savedView = localStorage.getItem('earth.globeView') === 'flat' ? 'flat' : 'sphere'; } catch (e) { /* storage unavailable */ }
  try { var qv = new URLSearchParams(location.search).get('view'); if (qv === 'flat' || qv === 'sphere') savedView = qv; } catch (e) { /* no query support */ }

  var st = {
    view: savedView,
    rot: [-(-new Date().getTimezoneOffset() / 60) * 15, -22], // start facing roughly your longitude (from time zone, no location request)
    pan: 0, // flat view: vertical pan in px
    zoom: 1, minZoom: 0.85, maxZoom: 14,
    places: [], kinds: [], world: null, borders: null, land: null, countries: [],
    filter: 'all', selected: null, selCountry: null, hoverCountry: null, hoverPlace: null, pointer: null,
    auto: !reduce, night: true, size: 0, h: 0, dpr: 1, hi: false, hiLoading: false, visible: true, dirty: true
  };
  var canvas, ctx, panel, tools, views, projection, flat, path, graticule = d3.geoGraticule10(), colors = {};
  var anim = null, vel = [0, 0], last = 0, raf = 0;
  var isFlat = function () { return st.view === 'flat'; };
  var curProj = function () { return isFlat() ? flat : projection; };

  // ---------- Load ----------
  function getJSON(u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  Promise.all([getJSON(host.dataset.places), getJSON(host.dataset.world)]).then(function (res) {
    st.places = res[0].places; st.kinds = res[0].kinds; st.sources = res[0].sources || [];
    setWorld(res[1]);
    build();
  }).catch(function () { /* keep the static SVG globe */ });

  function setWorld(topo) {
    st.world = topo;
    var c = topo.objects.countries;
    st.countries = topojson.feature(topo, c).features;
    st.land = topojson.merge(topo, c.geometries);
    st.borders = topojson.mesh(topo, c, function (a, b) { return a !== b; });
    st.dirty = true;
  }

  // ---------- DOM ----------
  function el(tag, cls, attrs) {
    var e = document.createElement(tag); if (cls) e.className = cls;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function build() {
    host.textContent = '';
    host.classList.add('is-live');
    canvas = el('canvas', 'globe-cv', { tabindex: '0', role: 'application',
      'aria-label': 'Interactive map of the Earth, shown as a globe or a flat map. Drag or use the arrow keys to move, plus and minus to zoom, V to switch between globe and flat, Enter to open the nearest place.' });
    ctx = canvas.getContext('2d');
    host.appendChild(canvas);
    views = el('div', 'globe-views', { role: 'group', 'aria-label': 'Map view' });
    [['sphere', 'Globe'], ['flat', 'Flat map']].forEach(function (v) {
      var b = el('button', 'gv', { type: 'button', 'data-view': v[0], 'aria-pressed': st.view === v[0] ? 'true' : 'false' });
      b.textContent = v[1]; views.appendChild(b);
    });
    host.appendChild(views);
    panel = el('div', 'globe-panel', { 'aria-live': 'polite' }); panel.hidden = true;
    host.appendChild(panel);
    tools = el('div', 'globe-tools', { role: 'group', 'aria-label': 'Map controls' });
    [['zin', '+', 'Zoom in'], ['zout', '−', 'Zoom out'], ['spin', '↻', 'Turn automatic movement on or off'],
     ['night', '☾', 'Show or hide night'], ['home', '⌂', 'Reset the view']].forEach(function (b) {
      var btn = el('button', 'gt', { type: 'button', 'data-act': b[0], 'aria-label': b[2], title: b[2] });
      btn.textContent = b[1]; tools.appendChild(btn);
    });
    host.appendChild(tools);
    syncTools();

    projection = d3.geoOrthographic().clipAngle(90).precision(0.35);
    flat = d3.geoNaturalEarth1().precision(0.35);
    readColors();
    resize();
    bind();
    announceDefault();
    loop();
  }

  function readColors() {
    var cs = getComputedStyle(host), g = function (n, d) { return (cs.getPropertyValue(n) || d).trim() || d; };
    colors = {
      oceanHi: g('--g-ocean-hi', '#2b94b8'), oceanLo: g('--g-ocean-lo', '#0b4560'), land: g('--g-land', '#6bcf8c'),
      landEdge: g('--g-land-edge', 'rgba(8,60,40,.55)'), grat: g('--g-grat', 'rgba(255,255,255,.14)'),
      glow: g('--g-glow', 'rgba(120,220,170,.55)'), night: g('--g-night', 'rgba(4,14,30,.42)'),
      text: g('--g-text', '#102a1e'), halo: g('--g-halo', 'rgba(255,255,255,.92)'), font: getComputedStyle(document.body).fontFamily
    };
    st.dirty = true;
  }
  new MutationObserver(function () { setTimeout(readColors, 0); }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { setTimeout(readColors, 0); });

  function resize() {
    var w = Math.max(240, Math.min(host.clientWidth || 360, 760));
    st.size = w; st.dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (isFlat()) {
      var bb = d3.geoPath(d3.geoNaturalEarth1().scale(100).translate([0, 0])).bounds({ type: 'Sphere' }), ratio = (bb[1][0] - bb[0][0]) / (bb[1][1] - bb[0][1]);
      st.h = Math.round((w - PAD - (w > 420 ? 58 : PAD)) / ratio + 2 * PAD);
    } else st.h = w;
    canvas.width = Math.round(w * st.dpr); canvas.height = Math.round(st.h * st.dpr);
    canvas.style.width = w + 'px'; canvas.style.height = st.h + 'px';
    canvas.classList.toggle('is-flat', isFlat()); host.classList.toggle('is-flat', isFlat());
    st.dirty = true;
  }
  if (window.ResizeObserver) new ResizeObserver(function () { if (canvas) resize(); }).observe(host);
  else window.addEventListener('resize', function () { if (canvas) resize(); });
  if (window.IntersectionObserver) new IntersectionObserver(function (e) { st.visible = e[0].isIntersecting; if (st.visible) { last = performance.now(); st.dirty = true; } }).observe(host);

  // ---------- Geometry helpers ----------
  function baseR() { return st.size * 0.43; }
  function cy() { return st.size * 0.47; }
  var PAD = 10;
  function padRight() { return st.size > 420 ? 58 : PAD; } // keep the flat map clear of the control column
  function flatExtent() { return [[PAD, PAD], [st.size - padRight(), st.h - PAD]]; }
  function flatBase() { // fitted projection at zoom 1, no pan: returns [scale, translate]
    var p = d3.geoNaturalEarth1().fitExtent(flatExtent(), { type: 'Sphere' });
    return [p.scale(), p.translate()];
  }
  function panLimit() { return Math.max(0, (st.h - 2 * PAD) * st.zoom - st.h) / 2 + 24; }
  function setProj() {
    if (isFlat()) {
      st.pan = Math.max(-panLimit(), Math.min(panLimit(), st.pan));
      var b = flatBase();
      flat.rotate([st.rot[0], 0, 0]).scale(b[0] * st.zoom).translate([b[1][0], b[1][1] + st.pan]);
      return b[0] * st.zoom;
    }
    var s = baseR() * st.zoom;
    projection.translate([st.size / 2, cy()]).scale(s).rotate([st.rot[0], st.rot[1], 0]);
    return s;
  }
  function center() { return [-st.rot[0], -st.rot[1]]; }
  function visibleAt(lon, lat) { return d3.geoDistance([lon, lat], center()) < Math.PI / 2 - 0.02; }
  function filtered() { return st.filter === 'all' ? st.places : st.places.filter(function (p) { return p.kind === st.filter; }); }
  function sunPoint() { // sub-solar point from the current UTC time (low-precision, plenty for a visual terminator)
    var now = new Date(), d = now / 86400000 + 2440587.5 - 2451545.0;
    var g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
    var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
    var dec = Math.asin(Math.sin(e) * Math.sin(L)), ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24, lon = ((ra / RAD) - gmst * 15) % 360;
    if (lon < -180) lon += 360; if (lon > 180) lon -= 360;
    return [lon, dec / RAD];
  }
  // where a place sits on the canvas right now, or null when it is hidden (far side of the globe, or off the flat map)
  function pointOf(p) {
    if (!isFlat() && !visibleAt(p.lon, p.lat)) return null;
    var q = curProj()([p.lon, p.lat]); if (!q || !isFinite(q[0])) return null;
    if (isFlat() && (q[0] < -12 || q[0] > st.size + 12 || q[1] < -12 || q[1] > st.h + 12)) return null;
    return q;
  }

  // ---------- Drawing: markers ----------
  // A marker is a round badge: soft shadow, white ring, tinted gradient body, thin darker edge and a small glyph that
  // tells the kind apart even without colour (arch = heritage, peaks = nature, paw = wildlife, bolt = extremes).
  var glyphs = {
    heritage: function (c, g) { c.beginPath(); c.moveTo(-g, g * .95); c.lineTo(-g, -g * .1); c.arc(0, -g * .1, g, Math.PI, 0); c.lineTo(g, g * .95); c.closePath(); c.fill(); },
    nature: function (c, g) { c.beginPath(); c.moveTo(-g * 1.15, g * .8); c.lineTo(-g * .3, -g * .75); c.lineTo(g * .2, g * .05); c.lineTo(g * .55, -g * .35); c.lineTo(g * 1.15, g * .8); c.closePath(); c.fill(); },
    wildlife: function (c, g) {
      c.beginPath(); c.ellipse(0, g * .45, g * .62, g * .5, 0, 0, TAU); c.fill();
      [[-g * .78, -g * .1], [-g * .26, -g * .62], [g * .26, -g * .62], [g * .78, -g * .1]].forEach(function (t) { c.beginPath(); c.arc(t[0], t[1], g * .26, 0, TAU); c.fill(); });
    },
    extremes: function (c, g) { c.beginPath(); c.moveTo(g * .25, -g * 1.1); c.lineTo(-g * .75, g * .15); c.lineTo(-g * .05, g * .15); c.lineTo(-g * .3, g * 1.1); c.lineTo(g * .8, -g * .25); c.lineTo(g * .1, -g * .25); c.closePath(); c.fill(); }
  };
  function drawMarker(x, y, kind, r, fade) {
    var c = ctx;
    c.save(); c.translate(x, y); c.globalAlpha = fade;
    c.beginPath(); c.arc(0, r * .32, r + 2.2, 0, TAU); c.fillStyle = 'rgba(2,14,24,.34)'; c.fill(); // soft drop shadow
    c.beginPath(); c.arc(0, 0, r + 1.7, 0, TAU); c.fillStyle = '#fff'; c.fill(); // white ring
    var g = c.createRadialGradient(-r * .38, -r * .42, r * .08, 0, 0, r);
    g.addColorStop(0, KIND_LIGHT[kind] || '#fff'); g.addColorStop(.55, KIND_COLOR[kind] || '#ccc'); g.addColorStop(1, KIND_DARK[kind] || '#888');
    c.beginPath(); c.arc(0, 0, r, 0, TAU); c.fillStyle = g; c.fill();
    c.fillStyle = KIND_INK[kind] || '#fff'; c.globalAlpha = fade * .96;
    (glyphs[kind] || glyphs.heritage)(c, r * .5);
    c.restore();
  }
  function pill(text, x, y) { // dark rounded label centred above (x, y)
    var fs = 12.5, c = ctx; c.font = '600 ' + fs + 'px ' + colors.font; c.textAlign = 'center'; c.textBaseline = 'middle';
    var w = c.measureText(text).width + 16, h = fs + 10, S = st.size;
    var bx = Math.max(4, Math.min(S - w - 4, x - w / 2)), by = Math.max(4, y - h);
    c.beginPath(); c.moveTo(bx + h / 2, by); c.arcTo(bx + w, by, bx + w, by + h, h / 2); c.arcTo(bx + w, by + h, bx, by + h, h / 2);
    c.arcTo(bx, by + h, bx, by, h / 2); c.arcTo(bx, by, bx + w, by, h / 2); c.closePath();
    c.fillStyle = 'rgba(10,22,32,.86)'; c.fill(); c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,.55)'; c.stroke();
    c.fillStyle = '#fff'; c.fillText(text, bx + w / 2, by + h / 2 + .5);
  }
  function drawMarkers(t) {
    var list = filtered(), mr = 6 + Math.min(st.zoom, 4) * 0.9, sel = st.selected, labelled = [];
    var cen = isFlat() ? null : center();
    // draw unselected first so a selected marker is never covered
    var order = list.slice().sort(function (a, b) { return (sel && a.id === sel.id ? 1 : 0) - (sel && b.id === sel.id ? 1 : 0); });
    for (var i = 0; i < order.length; i++) {
      var p = order[i], xy = pointOf(p); if (!xy) continue;
      var isSel = sel && sel.id === p.id, isHov = st.hoverPlace && st.hoverPlace.id === p.id;
      var fade = 1;
      if (cen) { var d = d3.geoDistance([p.lon, p.lat], cen); fade = Math.max(.35, Math.min(1, (Math.PI / 2 - d) / .32)); }
      var k = (isSel || isHov) ? 1.25 : 1;
      if (isSel && !reduce) {
        var ph = ((t / 1400) % 1);
        ctx.beginPath(); ctx.arc(xy[0], xy[1], mr * k + 5 + ph * 18, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * (1 - ph)).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.stroke();
      }
      drawMarker(xy[0], xy[1], p.kind, mr * k, fade);
      if (isSel || isHov || (st.zoom > 3.2 && list.length < 40)) labelled.push([p.name, xy[0], xy[1] - mr * k - 6]);
    }
    labelled.forEach(function (l) { pill(l[0], l[1], l[2]); });
    if (st.hoverCountry && st.pointer && !st.hoverPlace && st.pointerType === 'mouse') pill(st.hoverCountry.name, st.pointer[0] + 4, st.pointer[1] - 10);
  }

  // ---------- Drawing: the two views ----------
  function drawNight() {
    if (!st.night) return;
    var sp = sunPoint(), anti = [sp[0] + 180, -sp[1]];
    [[80, .16], [88, .16], [96, .14]].forEach(function (rr) {
      ctx.beginPath(); path(d3.geoCircle().center(anti).radius(rr[0])()); ctx.fillStyle = colors.night; ctx.globalAlpha = rr[1]; ctx.fill();
    });
    ctx.globalAlpha = 1;
  }
  function drawCountrySel() {
    var hc = st.selCountry || st.hoverCountry;
    if (hc) { ctx.beginPath(); path(hc.f); ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1.4; ctx.stroke(); }
  }
  function drawSphere(t) {
    var S = st.size, R = setProj();
    path = d3.geoPath(projection, ctx);
    var cx = S / 2, y = cy();
    var gl = ctx.createRadialGradient(cx, y, R * 0.97, cx, y, R * 1.2); // atmosphere glow
    gl.addColorStop(0, colors.glow); gl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, y, R * 1.2, 0, TAU); ctx.fill();
    var oc = ctx.createRadialGradient(cx - R * .35, y - R * .4, R * .1, cx, y, R); // ocean
    oc.addColorStop(0, colors.oceanHi); oc.addColorStop(1, colors.oceanLo);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = oc; ctx.fill();
    ctx.save(); ctx.beginPath(); path({ type: 'Sphere' }); ctx.clip();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = colors.grat; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); path(st.land); ctx.fillStyle = colors.land; ctx.fill();
    ctx.beginPath(); path(st.borders); ctx.strokeStyle = colors.landEdge; ctx.lineWidth = Math.min(1.1, 0.4 + st.zoom * 0.06); ctx.stroke();
    drawCountrySel(); drawNight();
    var sh = ctx.createRadialGradient(cx - R * .25, y - R * .3, R * .35, cx, y, R * 1.02); // limb darkening + specular
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(.75, 'rgba(0,10,20,.10)'); sh.addColorStop(1, 'rgba(0,10,20,.48)');
    ctx.fillStyle = sh; ctx.fillRect(cx - R, y - R, R * 2, R * 2);
    var sp2 = ctx.createRadialGradient(cx - R * .42, y - R * .48, 0, cx - R * .42, y - R * .48, R * .62);
    sp2.addColorStop(0, 'rgba(255,255,255,.26)'); sp2.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sp2; ctx.fillRect(cx - R, y - R, R * 2, R * 2);
    ctx.restore();
    ctx.beginPath(); ctx.arc(cx, y, R, 0, TAU); ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.stroke();
    drawMarkers(t);
  }
  function drawFlat(t) {
    var W = st.size, H = st.h; setProj();
    path = d3.geoPath(flat, ctx);
    var oc = ctx.createLinearGradient(0, 0, 0, H); // ocean: lighter at the top, deeper at the bottom
    oc.addColorStop(0, colors.oceanHi); oc.addColorStop(1, colors.oceanLo);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = oc; ctx.fill();
    ctx.save(); ctx.beginPath(); path({ type: 'Sphere' }); ctx.clip();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = colors.grat; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); path(st.land); ctx.fillStyle = colors.land; ctx.fill();
    ctx.beginPath(); path(st.borders); ctx.strokeStyle = colors.landEdge; ctx.lineWidth = Math.min(1.1, 0.35 + st.zoom * 0.07); ctx.stroke();
    drawCountrySel(); drawNight();
    var sh = ctx.createLinearGradient(0, 0, 0, H); // gentle vignette
    sh.addColorStop(0, 'rgba(255,255,255,.10)'); sh.addColorStop(.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,10,20,.22)');
    ctx.fillStyle = sh; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1.2; ctx.stroke();
    drawMarkers(t);
  }
  function draw(t) {
    var D = st.dpr;
    ctx.setTransform(D, 0, 0, D, 0, 0);
    ctx.clearRect(0, 0, st.size, st.h);
    if (isFlat()) drawFlat(t); else drawSphere(t);
  }

  // ---------- Loop ----------
  function loop() {
    raf = requestAnimationFrame(loop);
    var t = performance.now(); // one clock for animations, whatever timestamp rAF supplies
    if (!st.visible || document.hidden) { last = t; return; }
    var dt = Math.min(64, t - (last || t)); last = t;
    var moved = false;
    if (anim) {
      if (anim.t0 === null) anim.t0 = t;
      var k = Math.max(0, Math.min(1, (t - anim.t0) / anim.dur)), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      st.rot[0] = anim.r0[0] + (anim.r1[0] - anim.r0[0]) * e; st.rot[1] = anim.r0[1] + (anim.r1[1] - anim.r0[1]) * e;
      st.zoom = anim.z0 + (anim.z1 - anim.z0) * e;
      st.pan = (anim.p0 || 0) + ((anim.p1 || 0) - (anim.p0 || 0)) * e; moved = true;
      if (k >= 1) anim = null;
    } else if (st.drag) {
      // position is driven by the pointer
    } else if (Math.abs(vel[0]) > 0.002 || Math.abs(vel[1]) > 0.002) {
      st.rot[0] += vel[0] * dt / 16;
      if (isFlat()) st.pan += vel[1] * dt / 16; else st.rot[1] = clampLat(st.rot[1] + vel[1] * dt / 16);
      vel[0] *= 0.94; vel[1] *= 0.94; moved = true;
    } else if (st.auto && !reduce && !st.selected) {
      st.rot[0] += dt * 0.0055 / Math.max(1, st.zoom * 0.7); moved = true;
    }
    if (moved) st.dirty = true;
    if (st.zoom > 2.6 && !st.hi && !st.hiLoading) loadHi();
    if (st.dirty || (st.selected && !reduce)) { st.dirty = false; draw(t); }
  }
  function clampLat(v) { return Math.max(-88, Math.min(88, v)); }
  function loadHi() {
    st.hiLoading = true;
    getJSON(host.dataset.worldHi).then(function (topo) { st.hi = true; setWorld(topo); }).catch(function () { st.hiLoading = false; st.hi = true; });
  }

  function flyTo(lon, lat, zoomTo) {
    var r1 = [-lon, isFlat() ? st.rot[1] : -lat], r0 = st.rot.slice();
    var d = r1[0] - r0[0]; d = ((d + 540) % 360) - 180; r1[0] = r0[0] + d;
    var z1 = Math.max(st.zoom, zoomTo || 2.2), p1 = st.pan;
    if (isFlat()) { // bring the place to the vertical centre of the flat map
      var b = flatBase(), ref = d3.geoNaturalEarth1().fitExtent(flatExtent(), { type: 'Sphere' })([0, lat])[1];
      p1 = st.h / 2 - b[1][1] - z1 * (ref - b[1][1]);
    }
    st.auto = false; syncTools(); vel = [0, 0];
    if (reduce) { st.rot = r1; st.zoom = z1; st.pan = p1; st.dirty = true; return; }
    anim = { t0: null, dur: Math.min(1500, 600 + Math.abs(d) * 6), r0: r0, r1: r1, z0: st.zoom, z1: z1, p0: st.pan, p1: p1 };
  }
  function setZoom(z) { st.zoom = Math.max(isFlat() ? 1 : st.minZoom, Math.min(st.maxZoom, z)); st.dirty = true; }

  // ---------- View switch ----------
  function setView(v) {
    if (v === st.view) return;
    st.view = v; st.pan = 0; anim = null; vel = [0, 0];
    if (v === 'flat') st.zoom = Math.max(1, st.zoom);
    try { localStorage.setItem('earth.globeView', v); } catch (e) { /* storage unavailable */ }
    Array.prototype.forEach.call(views.querySelectorAll('.gv'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-view') === v ? 'true' : 'false'); });
    st.hoverPlace = null; st.hoverCountry = null;
    resize(); setProj(); syncTools();
  }

  // ---------- Hit testing ----------
  function xyOf(e) { var r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * (st.size / r.width), (e.clientY - r.top) * (st.h / r.height)]; }
  function placeAt(xy) {
    var best = null, bd = 18, list = filtered();
    for (var i = 0; i < list.length; i++) {
      var q = pointOf(list[i]); if (!q) continue;
      var d = Math.hypot(q[0] - xy[0], q[1] - xy[1]); if (d < bd) { bd = d; best = list[i]; }
    }
    return best;
  }
  function countryAt(xy) {
    var pr = curProj(), ll = pr.invert(xy); if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return null;
    if (isFlat()) { var back = pr(ll); if (!back || Math.hypot(back[0] - xy[0], back[1] - xy[1]) > 2 || Math.abs(ll[1]) > 90) return null; }
    else if (d3.geoDistance(ll, center()) > Math.PI / 2) return null;
    for (var i = 0; i < st.countries.length; i++) {
      var f = st.countries[i]; if (d3.geoContains(f, ll)) return { name: (f.properties && f.properties.name) || 'Unnamed territory', f: f };
    }
    return null;
  }

  // ---------- Selection + panel ----------
  function announceDefault() {
    panel.hidden = true; panel.textContent = '';
  }
  function showPlace(p) {
    st.selected = p; st.selCountry = null;
    panel.textContent = ''; panel.hidden = false;
    var top = el('div', 'gp-top');
    var badge = el('span', 'gp-kind gp-kind--' + p.kind); badge.textContent = KIND_LABEL[p.kind] || p.kind; top.appendChild(badge);
    if (p.unesco) { var u = el('span', 'gp-unesco'); u.textContent = 'UNESCO World Heritage Site'; top.appendChild(u); }
    var x = el('button', 'gp-close', { type: 'button', 'aria-label': 'Close place details' }); x.textContent = '×'; top.appendChild(x);
    var h = el('h3', 'gp-name'); h.textContent = p.name;
    var w = el('p', 'gp-where muted'); w.textContent = p.where + ' · ' + Math.abs(p.lat).toFixed(1) + '°' + (p.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(p.lon).toFixed(1) + '°' + (p.lon >= 0 ? 'E' : 'W');
    var b = el('p', 'gp-blurb'); b.textContent = p.blurb;
    var a = el('div', 'gp-actions');
    var l1 = el('a', 'btn', { href: BASE + 'topics/' + p.topic + '/' }); l1.textContent = 'Explore ' + (p.topicTitle || p.topic);
    var l2 = el('a', 'btn btn--ghost', { href: BASE + 'search/?q=' + encodeURIComponent(p.name) }); l2.textContent = 'Search projects';
    a.appendChild(l1); a.appendChild(l2);
    [top, h, w, b, a].forEach(function (n) { panel.appendChild(n); });
    x.addEventListener('click', clearSel);
    st.dirty = true;
  }
  function showCountry(c) {
    st.selected = null; st.selCountry = c;
    panel.textContent = ''; panel.hidden = false;
    var top = el('div', 'gp-top');
    var badge = el('span', 'gp-kind gp-kind--country'); badge.textContent = 'Country or territory'; top.appendChild(badge);
    var x = el('button', 'gp-close', { type: 'button', 'aria-label': 'Close details' }); x.textContent = '×'; top.appendChild(x);
    var h = el('h3', 'gp-name'); h.textContent = c.name;
    var a = el('div', 'gp-actions');
    var l2 = el('a', 'btn', { href: BASE + 'search/?q=' + encodeURIComponent(c.name) }); l2.textContent = 'Search projects';
    var l3 = el('a', 'btn btn--ghost', { href: BASE + 'topics/countries/' }); l3.textContent = 'Countries topic';
    a.appendChild(l2); a.appendChild(l3);
    [top, h, a].forEach(function (n) { panel.appendChild(n); });
    x.addEventListener('click', clearSel);
    st.dirty = true;
  }
  function clearSel() { st.selected = null; st.selCountry = null; panel.hidden = true; st.dirty = true; canvas.focus(); }
  function selectPlace(p, fly) { showPlace(p); if (fly !== false) flyTo(p.lon, p.lat, 2.4); }

  // ---------- Tools + filters ----------
  function syncTools() {
    var spin = tools.querySelector('[data-act="spin"]'), nt = tools.querySelector('[data-act="night"]');
    spin.setAttribute('aria-pressed', st.auto ? 'true' : 'false'); nt.setAttribute('aria-pressed', st.night ? 'true' : 'false');
  }
  function home() {
    st.selected = null; st.selCountry = null; panel.hidden = true; vel = [0, 0];
    anim = { t0: null, dur: reduce ? 1 : 900, r0: st.rot.slice(), r1: [st.rot[0], isFlat() ? 0 : -22], z0: st.zoom, z1: 1, p0: st.pan, p1: 0 };
    st.auto = !reduce; syncTools(); st.dirty = true;
  }

  // ---------- Input ----------
  function bind() {
    var pts = {}, pinch = null, down = null;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId); pts[e.pointerId] = xyOf(e);
      var ids = Object.keys(pts);
      anim = null; vel = [0, 0];
      if (ids.length === 2) { var a = pts[ids[0]], b = pts[ids[1]]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: st.zoom }; st.drag = null; }
      else { st.drag = { x: pts[e.pointerId][0], y: pts[e.pointerId][1], t: performance.now() }; down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; st.auto = false; syncTools(); }
      canvas.classList.add('is-grab');
    });
    canvas.addEventListener('pointermove', function (e) {
      var xy = xyOf(e); st.pointer = xy; st.pointerType = e.pointerType;
      if (pts[e.pointerId]) {
        pts[e.pointerId] = xy;
        var ids = Object.keys(pts);
        if (ids.length === 2 && pinch) { var a = pts[ids[0]], b = pts[ids[1]]; setZoom(pinch.z * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d); return; }
        if (st.drag) {
          var dx = xy[0] - st.drag.x, dy = xy[1] - st.drag.y;
          if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true;
          if (isFlat()) { // flat: horizontal drag changes the longitude (wraps), vertical drag pans
            var dpp = 360 / Math.max(1, (st.size - PAD - padRight()) * st.zoom);
            st.rot[0] += dx * dpp; st.pan += dy; vel = [dx * dpp, dy];
          } else {
            var s = projection.scale() / 57.2958;
            st.rot[0] += dx / s; st.rot[1] = clampLat(st.rot[1] - dy / s); vel = [dx / s, -dy / s];
          }
          st.drag.x = xy[0]; st.drag.y = xy[1]; st.dirty = true;
        }
      } else if (e.pointerType === 'mouse') {
        var hp = placeAt(xy), hc = hp ? null : countryAt(xy);
        if (hp !== st.hoverPlace || (hc && hc.name) !== (st.hoverCountry && st.hoverCountry.name)) { st.hoverPlace = hp; st.hoverCountry = hc; }
        st.dirty = true; canvas.style.cursor = hp || hc ? 'pointer' : 'grab';
      }
    });
    function up(e) {
      if (!pts[e.pointerId]) return;
      var xy = pts[e.pointerId]; delete pts[e.pointerId];
      if (Object.keys(pts).length < 2) pinch = null;
      if (!Object.keys(pts).length) {
        canvas.classList.remove('is-grab'); st.drag = null;
        if (down && !down.moved && e.type === 'pointerup') {
          vel = [0, 0];
          var p = placeAt(xy);
          if (p) selectPlace(p, true);
          else { var c = countryAt(xy); if (c) showCountry(c); else if (st.selected || st.selCountry) clearSel(); }
        }
        down = null;
      }
    }
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { st.hoverPlace = null; st.hoverCountry = null; st.pointer = null; st.dirty = true; } });
    canvas.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey)) return; // plain scrolling keeps scrolling the page
      e.preventDefault(); setZoom(st.zoom * Math.exp(-e.deltaY * 0.01));
    }, { passive: false });
    canvas.addEventListener('dblclick', function (e) { e.preventDefault(); setZoom(st.zoom * 1.7); });
    canvas.addEventListener('keydown', function (e) {
      var step = 9 / st.zoom, k = e.key, used = true;
      if (k === 'ArrowLeft') st.rot[0] += step; else if (k === 'ArrowRight') st.rot[0] -= step;
      else if (k === 'ArrowUp') { if (isFlat()) st.pan += step * 4; else st.rot[1] = clampLat(st.rot[1] + step); }
      else if (k === 'ArrowDown') { if (isFlat()) st.pan -= step * 4; else st.rot[1] = clampLat(st.rot[1] - step); }
      else if (k === '+' || k === '=') setZoom(st.zoom * 1.3); else if (k === '-' || k === '_') setZoom(st.zoom / 1.3);
      else if (k === 'v' || k === 'V') setView(isFlat() ? 'sphere' : 'flat');
      else if (k === 'Escape') clearSel();
      else if (k === 'Enter' || k === ' ') {
        var best = null, bd = 1e9, cc = center(), cx = st.size / 2, cyy = st.h / 2;
        filtered().forEach(function (p) {
          var d = isFlat() ? (function () { var q = pointOf(p); return q ? Math.hypot(q[0] - cx, q[1] - cyy) : 1e9; })() : d3.geoDistance([p.lon, p.lat], cc) * 100;
          if (d < bd) { bd = d; best = p; }
        });
        if (best && bd < 1e8) selectPlace(best, true);
      }
      else used = false;
      if (used) { e.preventDefault(); st.auto = false; syncTools(); anim = null; st.dirty = true; }
    });
    tools.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var a = b.getAttribute('data-act');
      if (a === 'zin') setZoom(st.zoom * 1.5); else if (a === 'zout') setZoom(st.zoom / 1.5);
      else if (a === 'spin') { st.auto = !st.auto; if (st.auto) { st.selected = null; st.selCountry = null; panel.hidden = true; } }
      else if (a === 'night') st.night = !st.night; else if (a === 'home') home();
      syncTools(); st.dirty = true;
    });
    views.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setView(b.getAttribute('data-view')); });
    // filter chips
    var chips = document.querySelectorAll('.globe-chips .chip');
    Array.prototype.forEach.call(chips, function (c) {
      c.addEventListener('click', function () {
        st.filter = c.getAttribute('data-kind');
        Array.prototype.forEach.call(chips, function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        if (st.selected && st.filter !== 'all' && st.selected.kind !== st.filter) clearSel();
        st.dirty = true;
      });
    });
    // the accessible place list flies the globe instead of navigating
    var links = document.querySelectorAll('.globe-list a[data-place]');
    Array.prototype.forEach.call(links, function (a) {
      a.addEventListener('click', function (e) {
        var id = a.getAttribute('data-place'), p = st.places.filter(function (x) { return x.id === id; })[0];
        if (!p) return; e.preventDefault();
        if (st.filter !== 'all' && st.filter !== p.kind) { var all = document.querySelector('.globe-chips .chip[data-kind="all"]'); if (all) all.click(); }
        selectPlace(p, true);
        var stage = document.getElementById('globe-stage'); if (stage && stage.scrollIntoView) stage.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      });
    });
  }
})();
