// @ts-check
// play/map-pin: "find it on the map". A round names a place; the player puts a marker where it is, confirms, and sees the true
// place, the distance in km and miles, points by distance and a sourced fact.
//
// Two ways to place the marker, always both available and scored the same way:
//   1. pointing: the screen's `world` handle (engine/render, mode map or globe) carries a pending pick; the host answers through
//      input(controls) with controls.pick = { id, lat, lon, elevationM };
//   2. buttons only: a 3 x 3 grid of areas as choices, then a 3 x 3 grid inside the chosen area, and so on (settings.gridLevels
//      deep); the marker is the centre of the chosen area. This path needs no renderer, no pointer and no services, and it is how
//      the harness and the scenario tests play. Every screen also tells the whole round in text.
// The template never draws: it returns data. Structure follows the golden play/quiz template (numbered sections).
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

// ---- geometry on the mean sphere (radius as in engine/world: 6 371.0088 km). Degrees in and out. -------------------------------
const R_KM = 6371.0088;
const RAD = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrap180 = d => (d >= -180 && d < 180 ? d : d - 360 * Math.floor((d + 180) / 360));
const mod360 = d => d - 360 * Math.floor(d / 360);
const r1 = x => Math.round(x * 10) / 10;
const r4 = x => Math.round(x * 1e4) / 1e4;

/** Great-circle distance in km (haversine). */
function distanceKm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
/** Initial bearing from the first place to the second, 0..360, 0 = north, 90 = east. */
function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  return mod360(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD);
}
/** n + 1 points [lat, lon] along the great circle between two places (so that the line is right on a globe and on a map). */
function arc(lat1, lon1, lat2, lon2, n) {
  const v = (lat, lon) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const a = v(lat1, lon1), b = v(lat2, lon2), w = Math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1, 1)), sw = Math.sin(w);
  if (sw < 1e-6) return [[r4(lat1), r4(lon1)], [r4(lat2), r4(lon2)]];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, ka = Math.sin((1 - t) * w) / sw, kb = Math.sin(t * w) / sw;
    const x = ka * a[0] + kb * b[0], y = ka * a[1] + kb * b[1], z = ka * a[2] + kb * b[2];
    out.push([r4(Math.atan2(z, Math.hypot(x, y)) / RAD), r4(Math.atan2(y, x) / RAD)]);
  }
  return out;
}

// ---- areas: { s, n, w, e } in degrees; w and e are not wrapped (e = w + width), so an area may cross the 180 degree meridian ----
const child = (b, idx) => { const row = Math.floor(idx / 3), col = idx % 3, dy = (b.n - b.s) / 3, dx = (b.e - b.w) / 3; return { s: b.n - (row + 1) * dy, n: b.n - row * dy, w: b.w + col * dx, e: b.w + (col + 1) * dx }; };
const centreOf = b => ({ lat: r4((b.s + b.n) / 2), lon: r4(wrap180((b.w + b.e) / 2)) });
const contains = (b, lat, lon) => lat >= b.s - 1e-9 && lat <= b.n + 1e-9 && (b.e - b.w >= 360 - 1e-9 || mod360(lon - b.w) <= b.e - b.w + 1e-9);
const childIndex = (b, lat, lon) => clamp(Math.floor((b.n - lat) / ((b.n - b.s) / 3)), 0, 2) * 3 + clamp(Math.floor(mod360(lon - b.w) / ((b.e - b.w) / 3)), 0, 2);

// ---- text, deterministic (no locale) ---------------------------------------------------------------------------------------------
const group = x => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const amount = x => (x < 10 ? String(r1(x)) : group(x));
const distText = km => `${amount(km)} km (${amount(km * 0.621371)} mi)`;
const deg = (v, dec) => String(Number(Math.abs(v).toFixed(dec)));
const latText = (lat, dec = 1) => (Number(Math.abs(lat).toFixed(dec)) === 0 ? '0°' : `${deg(lat, dec)}°${lat > 0 ? 'N' : 'S'}`);
const lonText = (lon, dec = 1) => { const l = wrap180(lon), a = Number(Math.abs(l).toFixed(dec)); return a === 0 || a === 180 ? `${a}°` : `${deg(l, dec)}°${l > 0 ? 'E' : 'W'}`; };
const decFor = b => (b.n - b.s >= 6 ? 0 : b.n - b.s >= 0.6 ? 1 : 2);

const CELLS = ['northWest', 'north', 'northEast', 'west', 'centre', 'east', 'southWest', 'south', 'southEast'];
const CELL_TEXT = ['North-west', 'North', 'North-east', 'West', 'Centre', 'East', 'South-west', 'South', 'South-east'];
const SECTORS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const POINT_NOTE = {
  point: 'The marked point is the map reference point of this place.',
  city: 'The marked point is the map reference point of the city.',
  lake: 'The marked point is a reference point on this body of water; any place within the full-points distance counts as on it.',
  country: 'The marked point is the centre of the main landmass as drawn on the source map. It is a map reference point, not an official coordinate.',
  region: 'The marked point is a reference point inside this region.',
};
const COLOUR = { target: '#2fa866', player: '#f08a24', grid: '#ffffff99', line: '#ffffff', area: '#ffd24a', landmark: '#d8dee9' };

export default defineTemplate({
  id: 'play/map-pin',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'Find a named place on the map or globe: place a marker, then see the true place, the distance and a sourced fact.',

  create(pack, env) {
    const d = pack.data;
    const mode = d.mode || 'classic';
    const settings = { shuffle: true, labels: 'easy', gridLevels: 5, hints: 0, lives: 1, seconds: 30, attempts: 3, passScore: 0.6, ...(d.settings || {}) };
    const view = { kind: 'map', projection: 'equirect', ...(d.view || {}), centre: { lat: 0, lon: 0, ...((d.view || {}).centre || {}) }, span: { lat: 180, lon: 360, ...((d.view || {}).span || {}) } };
    const base = { s: Math.max(-90, view.centre.lat - view.span.lat / 2), n: Math.min(90, view.centre.lat + view.span.lat / 2), w: view.centre.lon - view.span.lon / 2, e: view.centre.lon + view.span.lon / 2 };
    const widthKm = Math.max(base.n - base.s, (base.e - base.w) * Math.cos(((base.s + base.n) / 2) * RAD)) * R_KM * RAD;
    const sc0 = d.scoring || {};
    const zeroKm = sc0.zeroKm || clamp(Math.round(widthKm * 0.2 / 50) * 50, 200, 2500);
    const scoring = {
      maxPoints: 100, falloff: 'linear', missKm: Math.round(zeroKm / 2), hintCost: 0.2, attemptFactor: 0.75, ...sc0, zeroKm,
      fullKm: { point: 25, city: 50, lake: 100, country: 250, region: 500, ...(sc0.fullKm || {}) },
      hintBandsKm: [...(sc0.hintBandsKm || [50, 100, 250, 500, 1000, 2500, 5000, 10000])].sort((a, b) => a - b),
    };
    const L = settings.gridLevels;
    const S = (k, fb, vars) => { let s = env.strings(k, fb); if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(String(b)); return s; };

    // A pack that cannot be played fairly fails here, at creation, with the reason (the pack gate reports it).
    { const seen = new Set();
      for (const r of d.rounds) {
        if (seen.has(r.id)) throw new Error(`map-pin pack: round id "${r.id}" is used twice`);
        seen.add(r.id);
        if (!contains(base, r.lat, r.lon)) throw new Error(`map-pin pack: round "${r.id}" (${r.lat}, ${r.lon}) lies outside the view area; widen view.span or move view.centre`);
        if (scoring.fullKm[r.sizeClass] >= scoring.zeroKm) throw new Error(`map-pin pack: scoring.fullKm.${r.sizeClass} must be smaller than scoring.zeroKm (${scoring.zeroKm})`);
      } }

    // 1. Randomness once, at creation: which places, in which order.
    const rng = env.rng.fork('map-pin');
    let order = d.rounds.map((_, i) => i);
    if (settings.shuffle) order = rng.shuffle(order);
    if (settings.count) order = order.slice(0, settings.count);

    // 2. The whole game is one object. `record` is the durable best-score record (handed back by the engine as env.progress.record).
    const cleanRecord = r => ({ plays: Number.isInteger(r?.plays) && r.plays > 0 ? r.plays : 0, bestScore: Number.isFinite(r?.bestScore) ? r.bestScore : 0, bestTotal: Number.isFinite(r?.bestTotal) ? r.bestTotal : 0, bestAverageKm: Number.isFinite(r?.bestAverageKm) ? r.bestAverageKm : null });
    const roundState = () => ({ path: /** @type {number[]} */ ([]), aim: /** @type {any} */ (null), hint: /** @type {any} */ (null), used: 0, tries: /** @type {any[]} */ ([]), left: settings.seconds });
    const fresh = () => ({ phase: 'pick', i: 0, ...roundState(), hintsLeft: settings.hints, lives: settings.lives, points: 0, answers: /** @type {any[]} */ ([]) });
    let st = { order, ...fresh(), record: cleanRecord(env.progress && env.progress.record) };

    const n = () => st.order.length;
    const max = () => n() * scoring.maxPoints;
    const round = () => d.rounds[st.order[st.i]];
    const prompt = r => r.prompt || S('whereIs', 'Where is {name}?', { name: r.name });
    const boxAt = path => path.reduce(child, base);
    const viewPath = () => (st.path.length === L ? st.path.slice(0, L - 1) : st.path);
    const over = () => mode === 'streak' && st.lives <= 0;
    const secondsLeft = () => Math.ceil(st.left - 1e-6);   // whole seconds shown; the small margin absorbs the rounding of many short ticks
    const played = () => st.answers.filter(a => a.km !== null);
    const averageKm = () => { const p = played(); return p.length ? r1(p.reduce((s, a) => s + a.km, 0) / p.length) : null; };
    const bestAnswer = () => played().reduce((b, a) => (!b || a.km < b.km ? a : b), null);
    const citeIds = r => [...new Set([r.source, ...(r.sources || [])])].filter(id => d.sources?.[id]);
    const cite = ids => [...new Set(ids)].map(id => ({ id, title: d.sources[id].title, url: d.sources[id].url }));
    const coord = (p, dec = 1) => `${latText(p.lat, dec)} ${lonText(p.lon, dec)}`;
    const areaText = b => { const k = decFor(b); return `${latText(b.s, k)} ${S('to', 'to')} ${latText(b.n, k)}, ${b.e - b.w >= 360 ? S('allLongitudes', 'all longitudes') : `${lonText(b.w, k)} ${S('to', 'to')} ${lonText(b.e, k)}`}`; };
    const sector = (from, to) => SECTORS[Math.round(bearingDeg(from.lat, from.lon, to.lat, to.lon) / 45) % 8];
    const bandOf = km => { const b = scoring.hintBandsKm; let k = 0; while (k < b.length && km >= b[k]) k++; return k; };
    const bandText = k => { const b = scoring.hintBandsKm; return k === 0 ? S('lessThan', 'less than {km} km', { km: group(b[0]) }) : k === b.length ? S('moreThan', 'more than {km} km', { km: group(b[k - 1]) }) : S('between', '{a} to {b} km', { a: group(b[k - 1]), b: group(b[k]) }); };
    const dirText = s => S(`dir.${s}`, s);
    /** 0..1: 1 inside the full-points radius of the place's size class, falling to 0 at scoring.zeroKm. */
    const closeness = (km, cls) => {
      const full = scoring.fullKm[cls], zero = scoring.zeroKm;
      if (km <= full) return 1;
      if (km >= zero) return 0;
      const x = (km - full) / (zero - full);
      return scoring.falloff === 'exp' ? (Math.exp(-3 * x) - Math.exp(-3)) / (1 - Math.exp(-3)) : 1 - x;
    };

    // ---- the world handle (engine/render): plain data, rebuilt from state on every screen() -------------------------------------
    const camera = (lat, lon, latSpan, lonSpan) => {
      const c = Math.cos(lat * RAD);
      if (view.kind === 'globe') {
        const theta = 1.2 * Math.max(latSpan, lonSpan * c);
        return { lat: r4(lat), lon: r4(wrap180(lon)), distanceM: theta >= 150 ? 2.2e7 : Math.round(clamp(R_KM * 1000 * theta * RAD * 1.9, 5e4, 2.2e7)) };
      }
      return { lat: r4(lat), lon: r4(wrap180(lon)), spanDeg: r4(clamp(1.15 * Math.max(lonSpan * c, latSpan * 1.6), 0.5, 360)), projection: view.projection };
    };
    const boxCamera = b => camera((b.s + b.n) / 2, (b.w + b.e) / 2, b.n - b.s, b.e - b.w);
    const layers = easy => (easy ? { vectors: ['coast', 'river', 'lake', 'border'], graticule: base.n - base.s > 90 ? 30 : 10 } : { vectors: ['coast'], graticule: false });
    // `priority` orders the names when the map is crowded (engine/render labels, higher first): 10 answer screen, 5 aim and attempts, landmarks 1 or their own.
    const marker = (id, p, icon, color, label, priority) => ({ type: 'marker', id, lat: p.lat, lon: p.lon, icon, color, label: String(label).slice(0, 120), ...(Number.isFinite(priority) ? { priority } : {}) });
    const handle = (cam, objects, extra = {}) => ({ v: 1, mode: view.kind, camera: cam, layers: layers(settings.labels === 'easy'), objects, ...extra });
    const gridLines = b => {
      const out = [], dy = (b.n - b.s) / 3, dx = (b.e - b.w) / 3, steps = clamp(Math.ceil((b.e - b.w) / 15), 1, 24), widthM = Math.max(200, Math.round((b.n - b.s) * 300));
      // a parallel that ends on the 180 degree meridian ends at +180, so that the line never jumps back across a flat map
      const along = i => { const x = r4(wrap180(b.w + (b.e - b.w) * i / steps)); return i > 0 && x === -180 ? 180 : x; };
      for (const k of [1, 2]) {
        out.push({ type: 'line', id: `grid-lat-${k}`, color: COLOUR.grid, widthM, points: Array.from({ length: steps + 1 }, (_, i) => [r4(b.s + k * dy), along(i)]) });
        out.push({ type: 'line', id: `grid-lon-${k}`, color: COLOUR.grid, widthM, points: [[r4(b.s), r4(wrap180(b.w + k * dx))], [r4((b.s + b.n) / 2), r4(wrap180(b.w + k * dx))], [r4(b.n), r4(wrap180(b.w + k * dx))]] });
      }
      return out;
    };
    const tryMarkers = (tries, priority) => tries.map((t, k) => marker(`try-${k + 1}`, t, 'dot', COLOUR.player, S('attemptN', 'Attempt {n}', { n: k + 1 }), priority));
    function pickHandle() {
      const r = round(), vb = boxAt(viewPath()), objects = gridLines(vb);
      if (settings.labels === 'easy') for (const [k, m] of (d.landmarks || []).entries()) objects.push(marker(`landmark-${k}`, m, 'dot', COLOUR.landmark, m.name, Number.isFinite(m.priority) ? m.priority : 1));
      objects.push(...tryMarkers(st.tries, 5));
      if (st.aim) objects.push(marker('aim', st.aim, 'cross', COLOUR.player, S('yourMarker', 'Your marker'), 5));
      const sel = st.aim && st.aim.by === 'grid' ? boxAt(st.path) : null;
      return handle(boxCamera(vb), objects, { pick: { id: r.id, prompt: prompt(r).slice(0, 120) }, ...(sel ? { highlight: [{ box: { south: r4(sel.s), west: r4(sel.w), north: r4(sel.n), east: r4(sel.e) }, color: COLOUR.area, fill: false }] } : {}) });
    }
    function revealHandle(a) {
      const r = d.rounds[st.order[a.o]], fullKm = scoring.fullKm[r.sizeClass];
      const objects = [{ type: 'ring', id: 'full', lat: r.lat, lon: r.lon, radiusM: fullKm * 1000, color: COLOUR.target }, marker('target', r, 'pin', COLOUR.target, r.name, 10)];
      let cam = camera(r.lat, r.lon, Math.max(4, fullKm / 30), Math.max(4, fullKm / 30));
      if (a.km !== null) {
        const sep = a.km / (R_KM * RAD), pts = arc(a.lat, a.lon, r.lat, r.lon, 16), mid = pts[Math.floor(pts.length / 2)];
        objects.push({ type: 'line', id: 'gap', color: COLOUR.line, widthM: Math.max(500, Math.round(a.km * 8)), dash: true, points: pts });
        if (a.tries.length > 1) objects.push(...tryMarkers(a.tries, 5));
        objects.push(marker('picked', a, 'cross', COLOUR.player, S('yourMarker', 'Your marker'), 10));
        cam = sep > 100 ? boxCamera(base) : camera(a.km < 1 ? r.lat : mid[0], a.km < 1 ? r.lon : mid[1], Math.max(4, sep * 1.5), Math.max(4, sep * 1.5));
      }
      return { ...handle(cam, objects), layers: layers(true) };
    }
    function resultHandle() {
      const objects = [];
      for (const a of st.answers) {
        const r = d.rounds[st.order[a.o]];
        objects.push(marker(`target-${a.o}`, r, 'pin', COLOUR.target, r.name));
        if (a.km !== null) objects.push({ type: 'line', id: `gap-${a.o}`, color: COLOUR.line, widthM: Math.max(500, Math.round(a.km * 8)), points: arc(a.lat, a.lon, r.lat, r.lon, 8) }, marker(`picked-${a.o}`, a, 'cross', COLOUR.player, ''));
      }
      return { ...handle(boxCamera(base), objects), layers: layers(true) };
    }

    // 3. screen(): pure function of state. The host asks for it on every frame, so the last one is kept until the state changes
    //    (act, a pick, a new second on the clock, restore) and a still frame costs nothing.
    /** @type {any} */ let shown = null;
    const screen = () => (shown ||= build());
    function build() {
      switch (st.phase) {
        case 'intro': {
          const how = { classic: S('how.classic', 'Every place scores by how close your marker is.'), streak: S('how.streak', 'A marker more than {km} km from the place costs a life. The run ends when no life is left.', { km: group(scoring.missKm) }),
            timed: S('how.timed', 'You have {s} seconds for each place.', { s: settings.seconds }), hotcold: S('how.hotcold', 'You have {n} attempts for each place. After a miss you learn the direction and roughly how far away the place is.', { n: settings.attempts }) }[mode];
          return { kind: 'intro', title: d.title || pack.manifest.title,
            body: [...(d.intro ? [{ text: d.intro }] : []),
              { text: S('howTo', 'Each round names a place. Choose the area that holds it, then a smaller area inside it, and confirm when your marker is where you want it. Where the map is shown you can also point at the place.') },
              { text: how },
              ...(settings.hints ? [{ text: S('how.hints', 'Hints: {n}. A hint tells the direction and roughly how far away the place is, and lowers the points of that round.', { n: settings.hints }) }] : []),
              { kv: [[S('rounds', 'Places'), String(n())], [S('fullPoints', 'Points each'), String(scoring.maxPoints)]] }],
            actions: [{ id: 'start', label: S('start', 'Start') }], world: handle(boxCamera(base), []), meta: { mode, rounds: n(), max: max(), view: view.kind, labels: settings.labels } };
        }
        case 'pick': {
          const r = round(), vp = viewPath(), vb = boxAt(vp), k = decFor(child(vb, 0));
          const body = [{ text: `${S('areaInView', 'Area in view')}: ${areaText(vb)}.` },
            { text: st.aim ? `${S('yourMarker', 'Your marker')}: ${coord(st.aim, Math.max(1, k))}.` : S('noMarker', 'No marker yet. Choose an area below, or point at the place on the map.') }];
          if (mode === 'timed') body.push({ text: `${S('timeLeft', 'Time left')}: ${secondsLeft()} s` });
          if (st.tries.length) body.push({ list: st.tries.map((t, i) => `${S('attemptN', 'Attempt {n}', { n: i + 1 })}: ${coord(t)}. ${S('tryAway', 'The place is {band} away, to the {dir}.', { band: bandText(bandOf(t.km)), dir: dirText(sector(t, r)) })}${i > 0 ? ' ' + (t.km < st.tries[i - 1].km ? S('warmer', 'Warmer.') : t.km > st.tries[i - 1].km ? S('colder', 'Colder.') : S('same', 'No closer.')) : ''}`) });
          if (st.hint) body.push({ text: S('hintText', 'Hint: from {from} the place is {band} away, to the {dir}.', { from: coord(st.hint), band: bandText(st.hint.band), dir: dirText(st.hint.dir) }) });
          const kv = [[S('points', 'Points'), String(st.points)]];
          if (settings.hints) kv.push([S('hintsLeft', 'Hints'), String(st.hintsLeft)]);
          if (mode === 'streak') kv.push([S('lives', 'Lives'), String(st.lives)]);
          if (mode === 'hotcold') kv.push([S('tries', 'Tries'), `${st.tries.length} / ${settings.attempts}`]);
          body.push({ kv });
          const selected = st.path.length === L ? st.path[L - 1] : -1;
          const actions = [];
          if (st.aim) actions.push({ id: 'confirm', label: S('confirm', 'Confirm this place') });
          if (st.path.length) actions.push({ id: 'back', label: S('wider', 'Wider area') });
          if (st.hintsLeft > 0) actions.push({ id: 'hint', label: S('hint', 'Hint') });
          return { kind: 'pick', title: prompt(r), progress: { i: st.i + 1, n: n() }, body,
            choices: CELLS.map((key, idx) => ({ id: `c${idx}`, label: `${S(`cell.${key}`, CELL_TEXT[idx])}, ${S('around', 'around')} ${coord(centreOf(child(vb, idx)), k)}`, ...(idx === selected ? { state: 'selected' } : {}) })),
            actions, world: pickHandle(),
            meta: { roundId: r.id, level: vp.length, aim: st.aim ? { lat: st.aim.lat, lon: st.aim.lon } : null, points: st.points, hintsLeft: st.hintsLeft, lives: st.lives, tries: st.tries.length, secondsLeft: mode === 'timed' ? secondsLeft() : null } };
        }
        case 'reveal': {
          const a = st.answers[st.answers.length - 1], r = d.rounds[st.order[a.o]], none = a.km === null, last = over() || st.i + 1 >= n();
          const body = [none ? { text: S('noPick', 'No marker was placed in time.') }
            : { text: S('revealLine', 'Your marker at {at} was {dist} from {name}.', { at: coord(a), dist: distText(a.km), name: r.name }) + (a.km >= 1 ? ' ' + S('revealDir', 'The place lies to the {dir} of it.', { dir: dirText(sector(a, r)) }) : '') },
            { text: `${r.name}: ${coord(r, 2)}. ${S(`pointNote.${r.sizeClass}`, POINT_NOTE[r.sizeClass])}` },
            ...(r.fact ? [{ fact: r.fact, source: (r.sources && r.sources[0]) || r.source }] : []),
            { kv: [[S('distance', 'Distance'), none ? S('none', 'none') : distText(a.km)], [S('points', 'Points'), `${a.pts} / ${scoring.maxPoints}`], [S('total', 'Total'), String(st.points)]] }];
          if (a.hints) body.push({ text: S('hintsUsed', 'Hints used in this round: {n}.', { n: a.hints }) });
          if (a.tries.length > 1) body.push({ text: S('triesUsed', 'Attempts: {n}. The closest one counts.', { n: a.tries.length }) });
          if (mode === 'streak' && a.missed) body.push({ text: over() ? S('runEnds', 'That is more than {km} km away: the run ends here.', { km: group(scoring.missKm) }) : S('lifeLost', 'That is more than {km} km away: one life lost.', { km: group(scoring.missKm) }) });
          return { kind: 'reveal', title: none ? S('timeUp', 'Time is up') : a.pts >= scoring.maxPoints ? S('onTheSpot', 'On the spot') : S('kmAway', '{km} km away', { km: amount(a.km) }), progress: { i: st.i + 1, n: n() }, body,
            citations: cite(citeIds(r)), actions: [{ id: 'next', label: last ? S('finish', 'See result') : S('next', 'Next') }], world: revealHandle(a),
            meta: { roundId: r.id, distanceKm: a.km, distanceMi: none ? null : r1(a.km * 0.621371), points: a.pts, total: st.points, picked: none ? null : { lat: a.lat, lon: a.lon }, target: { lat: r.lat, lon: r.lon }, missed: a.missed, hints: a.hints, tries: a.tries.length } };
        }
        case 'result': {
          const pct = max() ? st.points / max() : 0, avg = averageKm(), best = bestAnswer(), rec = st.record;
          const name = a => d.rounds[st.order[a.o]].name;
          return { kind: 'result', title: pct >= settings.passScore ? S('passed', 'Well placed') : S('tryAgain', 'Keep exploring'),
            body: [{ kv: [[S('score', 'Points'), `${st.points} / ${max()}`], [S('average', 'Average'), avg === null ? S('none', 'none') : distText(avg)], [S('best', 'Best'), best ? `${name(best)}, ${amount(best.km)} km` : S('none', 'none')]] },
              ...(st.answers.length < n() ? [{ text: S('endedEarly', 'The run ended after {a} of {n} places.', { a: st.answers.length, n: n() }) }] : []),
              { text: S('yourRounds', 'Your places') },
              { list: st.answers.map(a => `${name(a)}: ${a.km === null ? S('noMarkerShort', 'no marker') : distText(a.km)}, ${S('pointsN', '{n} points', { n: a.pts })}`) },
              { text: S('record', 'Best score on this device: {s} of {t}.', { s: rec.bestScore, t: rec.bestTotal }) }],
            citations: cite(st.answers.flatMap(a => citeIds(d.rounds[st.order[a.o]]))),
            actions: [{ id: 'restart', label: S('restart', 'Play again') }], world: resultHandle(),
            meta: { points: st.points, max: max(), pct: Math.round(pct * 100), passed: pct >= settings.passScore, averageKm: avg, bestKm: best ? best.km : null, best: best ? name(best) : null, rounds: st.answers.length, bestScore: rec.bestScore } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. State changes: act(id) for buttons, input(controls) for a pick on the map, tick(dt) for the clock of the timed mode.
    const gridAim = () => { st.aim = st.path.length ? { ...centreOf(boxAt(st.path)), by: 'grid' } : null; };
    /** The round is over: score the closest attempt (or nothing, when time ran out with no marker). */
    function finish() {
      const r = round();
      let bi = -1;
      st.tries.forEach((t, k) => { if (bi < 0 || t.km < st.tries[bi].km) bi = k; });
      const b = bi < 0 ? null : st.tries[bi];
      const pts = b ? Math.round(scoring.maxPoints * closeness(b.km, r.sizeClass) * Math.max(0, 1 - scoring.hintCost * st.used) * Math.pow(scoring.attemptFactor, bi)) : 0;
      const a = { o: st.i, lat: b ? b.lat : null, lon: b ? b.lon : null, km: b ? b.km : null, pts, hints: st.used, tries: st.tries, missed: !b || b.km > scoring.missKm };
      st.points += pts; st.answers.push(a);
      if (mode === 'streak' && a.missed) st.lives--;
      st.phase = 'reveal';
    }
    /** Lock in the marker as an attempt. */
    function confirm() {
      const r = round();
      st.tries.push({ lat: st.aim.lat, lon: st.aim.lon, km: r1(distanceKm(st.aim.lat, st.aim.lon, r.lat, r.lon)) });
      st.hint = null;
      const t = st.tries[st.tries.length - 1];
      if (mode === 'hotcold' && t.km > scoring.fullKm[r.sizeClass] && st.tries.length < settings.attempts) return;   // another attempt, with feedback
      finish();
    }
    function toResult() {
      const rec = { ...st.record }, avg = averageKm();
      if (!rec.plays || st.points > rec.bestScore) { rec.bestScore = st.points; rec.bestTotal = max(); }
      if (avg !== null && (rec.bestAverageKm === null || avg < rec.bestAverageKm)) rec.bestAverageKm = avg;
      rec.plays++;
      st.record = rec; st.phase = 'result';
    }
    function act(id) {
      shown = null;
      if (st.phase === 'pick') {
        if (/^c[0-8]$/.test(id)) { const idx = Number(id.slice(1)); st.path = [...viewPath(), idx]; gridAim(); return; }
        if (id === 'back' && st.path.length) { st.path = st.path.slice(0, -1); gridAim(); return; }
        if (id === 'confirm' && st.aim) { confirm(); return; }
        if (id === 'hint' && st.hintsLeft > 0) {
          const r = round(), from = st.aim ? { lat: st.aim.lat, lon: st.aim.lon } : centreOf(boxAt(viewPath()));
          st.hintsLeft--; st.used++;
          st.hint = { ...from, band: bandOf(distanceKm(from.lat, from.lon, r.lat, r.lon)), dir: sector(from, r) };
          return;
        }
        return;
      }
      if (st.phase === 'reveal' && id === 'next') {
        if (over() || st.i + 1 >= n()) { toResult(); return; }
        st = { ...st, ...roundState(), i: st.i + 1, phase: 'pick' };
        return;
      }
      if (st.phase === 'result' && id === 'restart') { st = { order: st.order, ...fresh(), record: st.record }; return; }
    }
    /** A place picked on the map or globe (engine/ui/controls.mjs): it moves the marker; `confirm` locks it in. */
    function input(controls) {
      const p = controls && controls.pick;
      if (st.phase !== 'pick' || !p || p.id !== round().id || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return;
      st.aim = { lat: r4(clamp(p.lat, -90, 90)), lon: r4(wrap180(p.lon)), by: 'pick' };
      shown = null;
    }
    function tick(dt) {
      if (st.phase !== 'pick' || mode !== 'timed' || !(dt > 0)) return;
      const was = secondsLeft();
      st.left = Math.max(0, st.left - dt);
      if (secondsLeft() !== was) shown = null;
      if (st.left > 0) return;
      shown = null;
      if (st.aim) confirm(); else finish();
    }

    return {
      screen, act, input, tick,
      result: () => { const b = bestAnswer(); return { completed: st.phase === 'result', score: st.points, total: max(), passed: max() ? st.points / max() >= settings.passScore : false, averageKm: averageKm(), bestKm: b ? b.km : null, rounds: st.answers.length, record: st.record }; },
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); shown = null; },
      progress: () => st.record,
      // 5. Oracles (tests only), one button at a time. $correct walks the grid to the finest area that holds the place and confirms;
      //    $wrong chooses the first-level area farthest from the place and confirms.
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'reveal') return 'next';
        if (st.phase === 'result') return 'restart';
        const r = round(), vp = viewPath(), vb = boxAt(vp);
        if (name === 'correct') {
          if (!contains(vb, r.lat, r.lon)) return 'back';
          const c = childIndex(vb, r.lat, r.lon);
          return st.path.length === L && st.path[L - 1] === c && st.aim && st.aim.by === 'grid' ? 'confirm' : `c${c}`;
        }
        if (name === 'wrong') {
          if (st.aim) return 'confirm';
          let far = 0, best = -1;
          for (let k = 0; k < 9; k++) { const c = centreOf(child(vb, k)), km = distanceKm(c.lat, c.lon, r.lat, r.lon); if (km > best) { best = km; far = k; } }
          return `c${far}`;
        }
        return undefined;
      },
    };
  },
});
