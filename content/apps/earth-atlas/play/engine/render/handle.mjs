// @ts-check
// The world handle: what a template returns in `screen.world` every frame. Plain data, no functions, no drawing.
// WORLD_HANDLE_SCHEMA is the contract, worldHandleProblems() checks a handle, normalise() fills defaults for the renderer
// (it never throws: a broken handle draws a default view instead of stopping the frame loop).
import { validate } from '../core/schema.mjs';
import { clamp, num, wrap180, destination } from './geo.mjs';

const N = { type: 'number' }, B = { type: 'boolean' }, S = { type: 'string', maxLength: 120 };
const LAT = { type: 'number', minimum: -90, maximum: 90 }, LON = { type: 'number', minimum: -540, maximum: 540 };
const COLOUR = { type: ['string', 'array'] };
const RECT = { type: 'array', minItems: 4, maxItems: 4, items: N };
const POINTS = { type: 'array', minItems: 2, maxItems: 2000, items: { type: 'array', minItems: 2, maxItems: 3, items: N } };
const obj = (properties, required = []) => ({ type: 'object', properties, required });

export const OVERLAY_TYPES = ['horizon', 'tape', 'heading', 'vsi', 'gauge', 'bar', 'deviation', 'text', 'arrow', 'box3d', 'dir', 'shape', 'dock', 'banner', 'cockpit'];
export const OBJECT_TYPES = ['traffic', 'marker', 'ring', 'zone', 'thermal', 'line'];
export const VEHICLE_MODELS = ['airplane', 'glider', 'jet', 'helicopter', 'bird', 'balloon', 'capsule'];
export const VECTOR_LAYERS = ['coast', 'river', 'lake', 'road', 'rail', 'border'];

const ATTITUDE = { headingDeg: N, pitchDeg: N, rollDeg: N };
const BANDS = { type: 'array', maxItems: 8, items: obj({ from: N, to: N, color: COLOUR }, ['from', 'to']) };

/** JSON Schema (engine/core/schema.mjs subset) of the world handle. Unknown properties are allowed and ignored. */
export const WORLD_HANDLE_SCHEMA = {
  type: 'object',
  required: ['mode', 'camera'],
  properties: {
    v: { const: 1 },
    mode: { enum: ['flight', 'globe', 'map'] },
    time: N,                                    // UTC milliseconds: sun, moon, stars, day and night
    t: N,                                       // seconds of animation time (spin, pulses); the template adds up its tick(dt)
    camera: obj({
      lat: LAT, lon: LON,
      altM: N, ...ATTITUDE, fovDeg: { type: 'number', minimum: 10, maximum: 120 }, fovMinHDeg: { type: 'number', minimum: 10, maximum: 170 },   // flight: eye position and attitude; fovMinHDeg: the vertical field of view widens until this many degrees show across
      chase: obj({ distanceM: N, azimuthDeg: N, elevationDeg: N }),                                      // flight: look at `vehicle` from outside instead
      distanceM: { type: 'number', minimum: 1000 }, tiltDeg: N, spinDegPerS: N,                           // globe: height above the surface, orbit
      spanDeg: { type: 'number', exclusiveMinimum: 0, maximum: 360 }, projection: { enum: ['equirect', 'stereo'] }, rotationDeg: N,   // map
    }, ['lat', 'lon']),
    light: { type: 'object' },                  // engine/sim/weather lighting() output (any subset); missing parts come from `time`
    clouds: { type: 'array', maxItems: 4, items: obj({ cover: { type: 'number', minimum: 0, maximum: 1 }, baseM: N, topM: N }, ['cover', 'baseM']) },
    weather: obj({ visibilityM: N, hazeScaleM: N, inCloud: N }),
    vehicle: obj({ model: { enum: VEHICLE_MODELS }, lat: LAT, lon: LON, altM: N, ...ATTITUDE, lengthM: N, color: COLOUR, visible: B, flap: N }, ['lat', 'lon', 'altM']),
    objects: {
      type: 'array', maxItems: 256,
      items: obj({
        type: { enum: OBJECT_TYPES }, id: S, label: S, color: COLOUR, lat: LAT, lon: LON, altM: N,
        priority: N,                                                                                      // marker: which place names are kept when they do not all fit (higher first)
        model: { enum: VEHICLE_MODELS }, ...ATTITUDE, lengthM: N,                                         // traffic
        icon: { enum: ['pin', 'dot', 'square', 'triangle', 'cross', 'ring'] },                            // marker
        radiusM: N, widthM: N, baseM: N, topM: N, strength: N,                                            // ring, zone, thermal
        points: POINTS, drape: B,                                                                         // line: [lat, lon, altM?]
        dash: { type: ['boolean', 'array'], minItems: 2, maxItems: 2, items: { type: 'number', exclusiveMinimum: 0 } },   // line: true, or [dash, gap] in metres
      }, ['type']),
    },
    runways: obj({ emphasis: { enum: ['none', 'all', 'target'] }, target: obj({ lat: LAT, lon: LON }, ['lat', 'lon']), color: COLOUR, lights: B }),
    layers: obj({ vectors: { type: ['boolean', 'array'], items: { enum: VECTOR_LAYERS } }, graticule: { type: ['boolean', 'number'] }, terminator: B, clouds: B, stars: B, runways: B, labels: B }),
    highlight: {
      type: 'array', maxItems: 32,
      items: obj({ id: S, ring: POINTS, circle: obj({ lat: LAT, lon: LON, radiusKm: N }, ['lat', 'lon', 'radiusKm']), box: obj({ south: LAT, west: LON, north: LAT, east: LON }, ['south', 'west', 'north', 'east']), color: COLOUR, fill: B,
        label: S, priority: N }),                                                                         // the name of the region, placed with the marker labels
    },
    pick: obj({ id: S, prompt: S, cursor: { type: 'array', minItems: 2, maxItems: 2, items: N } }, ['id']),
    overlays: {
      type: 'array', maxItems: 64,
      items: obj({
        type: { enum: OVERLAY_TYPES }, rect: RECT, color: COLOUR, label: S, unit: S, text: S,
        pitchDeg: N, rollDeg: N, slip: N, director: obj({ pitchDeg: N, rollDeg: N }),                      // horizon
        value: N, span: N, major: N, minor: N, side: { enum: ['left', 'right'] }, bug: N, trend: N, bands: BANDS, digits: N,   // tape, heading, vsi, gauge, bar
        min: N, max: N, lateral: N, vertical: N,                                                          // gauge, bar, deviation (-1..1)
        level: { enum: ['info', 'advisory', 'caution', 'warning'] }, at: { type: 'array', minItems: 2, maxItems: 2, items: N }, size: N, align: { enum: ['left', 'center', 'right'] },
        from: { type: 'array', minItems: 2, maxItems: 2, items: N }, to: { type: 'array', minItems: 2, maxItems: 2, items: N }, toward: obj({ lat: LAT, lon: LON, altM: N }, ['lat', 'lon']),   // arrow
        lat: LAT, lon: LON, altM: N, headingDeg: N, lengthM: N, widthM: N, heightM: N,                    // box3d (runway box, gate), dir
        shape: { enum: ['circle', 'cross', 'diamond', 'fpv', 'square'] },
        kind: { enum: ['airliner', 'light', 'helicopter'] }, stick: { type: 'array', minItems: 3, maxItems: 3, items: N }, lever: N, flaps: N, trim: N, gear: N,   // cockpit: the frame and the controls the pilot's hands are on
        items: { type: 'array', maxItems: 64, items: { type: 'object' } }, aspect: N, maxW: N, maxH: N, cap: N, dy: N, row: N, panel: B, anchor: S, only: S, clip: B, alt: { type: 'object' },   // dock, banner
        lines: { type: 'array', maxItems: 64, items: obj({ points: POINTS, color: COLOUR, width: N, closed: B, fill: COLOUR }, ['points']) },
        texts: { type: 'array', maxItems: 64, items: obj({ at: { type: 'array', minItems: 2, maxItems: 2, items: N }, text: S, size: N, color: COLOUR, align: { enum: ['left', 'center', 'right'] } }, ['at', 'text']) },
      }, ['type']),
    },
    controls: { type: 'object' },               // flight input declared by the template: engine/ui/controls.mjs (CONTROLS_SCHEMA)
  },
};

const NEED = {
  horizon: ['rect', 'pitchDeg', 'rollDeg'], tape: ['rect', 'value'], heading: ['rect', 'value'], vsi: ['rect', 'value'], gauge: ['rect', 'value'], bar: ['rect', 'value'],
  deviation: ['rect'], text: ['text'], dock: ['items'], banner: ['text'], cockpit: [], arrow: [], box3d: ['lat', 'lon', 'lengthM', 'widthM'], dir: ['headingDeg', 'pitchDeg'], shape: [],
  traffic: ['lat', 'lon', 'altM'], marker: ['lat', 'lon'], ring: ['lat', 'lon', 'radiusM'], zone: ['lat', 'lon', 'lengthM', 'widthM'], thermal: ['lat', 'lon', 'radiusM'], line: ['points'],
};

/**
 * Problems of a world handle as text lines; an empty list means the handle is valid. Templates call this in their own tests.
 * @param {any} handle @returns {string[]}
 */
export function worldHandleProblems(handle) {
  if (!handle || typeof handle !== 'object') return ['$: expected an object'];
  try { handle = JSON.parse(JSON.stringify(handle)); } catch { return ['$: not plain data']; }      // as it would arrive after being saved or sent
  const out = validate(WORLD_HANDLE_SCHEMA, handle).map(e => `${e.path}: ${e.message}`);
  if (out.length) return out;
  const c = handle.camera, need = (o, keys, path) => { for (const k of keys) if (o[k] === undefined) out.push(`${path}: missing "${k}"`); };
  if (handle.mode === 'flight' && !c.chase) need(c, ['altM'], '$.camera');
  if (handle.mode === 'flight' && c.chase && !handle.vehicle) out.push('$.camera.chase: needs "vehicle"');
  if (handle.mode === 'globe') need(c, ['distanceM'], '$.camera');
  if (handle.mode === 'map') need(c, ['spanDeg'], '$.camera');
  (handle.objects || []).forEach((o, i) => need(o, NEED[o.type], `$.objects[${i}]`));
  (handle.overlays || []).forEach((o, i) => need(o, NEED[o.type], `$.overlays[${i}]`));
  (handle.highlight || []).forEach((r, i) => { if (!r.id && !r.ring && !r.circle && !r.box) out.push(`$.highlight[${i}]: needs one of id, ring, circle, box`); });
  return out;
}

const arr = v => (Array.isArray(v) ? v : []);
/** Vertical field of view (degrees) that also shows at least `minH` degrees across a canvas of this width / height (portrait phones); never above 110. */
const widen = (fov, minH, aspect) => {
  if (!(Number.isFinite(minH) && minH > 0 && Number.isFinite(aspect) && aspect > 0)) return fov;
  const v = 2 * Math.atan(Math.tan(clamp(minH, 10, 170) * Math.PI / 360) / aspect) * 180 / Math.PI;
  return clamp(Math.max(fov, v), 10, 110);
};
const o = v => (v && typeof v === 'object' ? v : {});

/**
 * A handle with every default filled in and every number finite. Never throws.
 * @param {any} handle @param {{ reducedMotion?: boolean, aspect?: number }} [opts] aspect: canvas width / height (for `camera.fovMinHDeg`)
 */
export function normalise(handle, opts = {}) {
  const h = o(handle), c = o(h.camera), mode = h.mode === 'globe' || h.mode === 'map' ? h.mode : 'flight';
  const t = opts.reducedMotion ? 0 : num(h.t, 0), v = h.vehicle && typeof h.vehicle === 'object' ? h.vehicle : null;
  /** @type {any} */
  let cam;
  if (mode === 'map') {
    cam = { lat: clamp(num(c.lat, 0), -90, 90), lon: wrap180(num(c.lon, 0)), spanDeg: clamp(num(c.spanDeg, 360), 1e-4, 360), stereo: c.projection === 'stereo', rotationDeg: num(c.rotationDeg, 0) };
  } else if (mode === 'globe') {
    cam = { lat: clamp(num(c.lat, 0), -89.999, 89.999), lon: wrap180(num(c.lon, 0) + num(c.spinDegPerS, 0) * t), altM: clamp(num(c.distanceM, 2e7), 1000, 4e8),
      headingDeg: num(c.headingDeg, 0), pitchDeg: -90 + clamp(num(c.tiltDeg, 0), 0, 85), rollDeg: 0, fovDeg: clamp(num(c.fovDeg, 30), 10, 120) };
  } else if (c.chase && v) {
    const ch = o(c.chase), d = Math.max(1, num(ch.distanceM, 60)), el = clamp(num(ch.elevationDeg, 12), -89, 89) * Math.PI / 180, brg = num(v.headingDeg, 0) + 180 + num(ch.azimuthDeg, 0);
    const p = destination(clamp(num(v.lat, 0), -89.999, 89.999), num(v.lon, 0), brg, d * Math.cos(el));
    cam = { lat: p[0], lon: p[1], altM: num(v.altM, 0) + d * Math.sin(el), headingDeg: brg + 180, pitchDeg: -el * 180 / Math.PI, rollDeg: 0, fovDeg: widen(clamp(num(c.fovDeg, 60), 10, 120), c.fovMinHDeg, opts.aspect) };
  } else {
    cam = { lat: clamp(num(c.lat, 0), -89.999, 89.999), lon: wrap180(num(c.lon, 0)), altM: clamp(num(c.altM, num(c.alt, 1000)), -500, 4e8),
      headingDeg: num(c.headingDeg, 0), pitchDeg: clamp(num(c.pitchDeg, 0), -90, 90), rollDeg: num(c.rollDeg, 0), fovDeg: clamp(num(c.fovDeg, 60), 10, 120) };
    cam.fovDeg = widen(cam.fovDeg, c.fovMinHDeg, opts.aspect);
  }
  const L = o(h.layers), W = o(h.weather), rw = o(h.runways), light = h.light && typeof h.light === 'object' ? h.light : null;
  const clouds = mode === 'flight' || L.clouds === true ? arr(h.clouds).filter(k => k && num(k.cover, 0) > 0.02 && Number.isFinite(k.baseM)).slice(0, 4).map(k => ({ cover: clamp(k.cover, 0, 1), baseM: k.baseM, topM: Math.max(k.baseM + 50, num(k.topM, k.baseM + 600)) })) : [];
  // inside a layer and nobody said how thick the cloud is here: go by the layer's cover, thinning towards its base and top
  let inCloud = clamp(num(W.inCloud, light ? num(light.inCloud, NaN) : NaN), 0, 1);
  if (inCloud !== inCloud) { inCloud = 0; if (mode === 'flight') for (const k of clouds) inCloud = Math.max(inCloud, k.cover * clamp(Math.min(cam.altM - k.baseM, k.topM - cam.altM) / 60, 0, 1)); }
  return {
    mode, time: num(h.time, NaN), t, cam, light, clouds,
    visibilityM: num(W.visibilityM, NaN), hazeScaleM: Number.isFinite(W.hazeScaleM) ? clamp(W.hazeScaleM, 100, 20000) : 0, inCloud,
    vehicle: v && v.visible !== false && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null,
    objects: arr(h.objects).filter(x => x && typeof x === 'object'),
    runways: { emphasis: rw.emphasis === 'all' || rw.emphasis === 'target' ? rw.emphasis : 'none', target: rw.target && Number.isFinite(rw.target.lat) && Number.isFinite(rw.target.lon) ? rw.target : null, color: rw.color, lights: rw.lights !== false, show: L.runways !== false && mode !== 'globe' },
    layers: {
      vectors: L.vectors === false ? [] : Array.isArray(L.vectors) ? L.vectors : mode === 'flight' ? ['river', 'road', 'rail'] : ['coast', 'river', 'lake', 'border'],
      graticule: L.graticule === true ? (mode === 'flight' ? 1 : 15) : num(L.graticule, 0), terminator: mode === 'flight' ? true : L.terminator !== false && Number.isFinite(h.time),
      stars: L.stars !== false, labels: L.labels !== false,
    },
    highlight: arr(h.highlight).filter(x => x && typeof x === 'object'),
    pick: h.pick && typeof h.pick === 'object' ? h.pick : null,
    overlays: arr(h.overlays),
  };
}
