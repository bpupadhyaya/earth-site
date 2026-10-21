// @ts-check
// createRenderer: the object engine/ui drives. One per canvas. WebGL2 when the device has it, Canvas2D otherwise; the same
// handle, the same overlays, the same pick() and project() on both.
import { normalise, OVERLAY_TYPES } from './handle.mjs';
import { createView } from './camera.mjs';
import { frameLight } from './light.mjs';
import { createScene } from './scene.mjs';
import { layoutOverlays } from './overlays.mjs';
import { createGovernor } from './governor.mjs';
import { createGL } from './webgl.mjs';
import { create2D } from './canvas2d.mjs';
import { toEcef, clamp } from './geo.mjs';

/** A world with no tile set: a calm sea everywhere. Used when the app passes no engine/world instance. */
const SEA = { elevation: () => 0, landCover: () => 1, normal: () => [0, 0, 1], meshPatch: null };

/**
 * @typedef {object} RendererOptions
 * @property {'auto'|'low'|'medium'|'high'} [quality]   'auto' adapts to the measured frame time (needs `now`)
 * @property {boolean} [reducedMotion]   no spin, no pulsing
 * @property {any} [world]   the engine/world instance (createWorld) or the built-in base map (engine/world createBaseMap); without either the renderer draws an empty sea
 * @property {() => number} [now]   clock in milliseconds, for frame times and build budgets (the renderer never reads a clock itself)
 * @property {(id: string) => ({ rings: ArrayLike<number>[] }|null)} [regions]   outline of a region by id (lat, lon pairs), for `highlight: [{ id }]`
 * @property {'auto'|'webgl'|'2d'} [backend]   default 'auto'
 * @property {boolean} [allowSoftware]   accept a software WebGL implementation (tests on machines without a GPU); default false: use Canvas2D there
 * @property {boolean} [driveWorld]   call world.update() as the camera moves (default true)
 * @property {number} [textScale]   overlay text size factor; default: from the page's text zoom
 * @property {(m: any) => void} [log]
 * @property {(w: number, h: number) => any} [createCanvas]   makes a scratch canvas (text and highlight pictures); default: document.createElement('canvas')
 */

/**
 * The object an app hands to engine/ui as `render`: `{ createRenderer }` with the world already bound.
 * @param {RendererOptions} base
 */
export function createRenderFactory(base) {
  return { /** @param {any} canvas @param {RendererOptions} [opts] */ createRenderer: (canvas, opts) => createRenderer(canvas, { ...base, ...opts }) };
}

/**
 * @param {any} canvas @param {RendererOptions} [o]
 */
export function createRenderer(canvas, o = {}) {
  const log = o.log || (() => {}), now = typeof o.now === 'function' ? o.now : null;
  const world = o.world && typeof o.world.meshPatch === 'function' ? o.world : null, source = world || SEA;
  /** The built-in base map (engine/world createBaseMap): flat, so terrain patches need no fine levels; areas come from its own picture. */
  const basemap = Boolean(world && world.info && world.info() && world.info().basemap);
  const governor = createGovernor({ quality: now ? o.quality || 'auto' : o.quality && o.quality !== 'auto' ? o.quality : 'medium' });
  /** @type {any} */
  let gl = null, draw = null, view = null, lastHandle = null, dropping = false;
  /** Which side of its symbol each place name was on in the last frame, so that names do not jump about while the view moves. */
  /** @type {Map<string, number>} */ const labelMemory = new Map();
  let lost = false, broken = false, frames = 0, lastT = NaN, frameMs = 0, intervalMs = 0, zoom = 1, last = { drawCalls: 0, triangles: 0, uploads: 0 }, uploads = 0, maxUploads = 0;
  if (o.backend !== '2d' && world) {
    try { gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: !o.allowSoftware }); } catch (e) { log(e); }
    if (gl) try { draw = createGL(gl, { log, createCanvas: o.createCanvas, baseMap: basemap ? world : null }); } catch (e) { log(e); broken = true; }
  }
  const scene = gl && world ? createScene({ world, clock: now || undefined, regions: o.regions, maxZ: basemap ? 5 : undefined, lineBudget: basemap ? 2 : 0, onEvict: item => { if (dropping) item.gpu = null; else if (draw) draw.release(item); } }) : null;
  if (!gl) { const ctx = canvas.getContext('2d'); if (ctx) draw = create2D(ctx, { world: source, regions: o.regions, createCanvas: o.createCanvas }); else broken = true; }

  const onLost = e => { if (e && e.preventDefault) e.preventDefault(); lost = true; };
  const onRestored = () => { try { dropping = true; if (scene) scene.reset(); dropping = false; draw.init(); lost = false; broken = false; } catch (e) { log(e); broken = true; } };
  if (gl && canvas.addEventListener) { canvas.addEventListener('webglcontextlost', onLost, false); canvas.addEventListener('webglcontextrestored', onRestored, false); }

  const size = () => ({ w: Math.max(1, canvas.width | 0), h: Math.max(1, canvas.height | 0) });
  const makeView = handle => {
    const s = size(), n = normalise(handle, { reducedMotion: Boolean(o.reducedMotion), aspect: s.w / s.h });
    let near = Infinity;
    if (n.mode === 'flight' && n.vehicle) { const a = toEcef(n.cam.lat, n.cam.lon, n.cam.altM), b = toEcef(n.vehicle.lat, n.vehicle.lon, Number(n.vehicle.altM) || 0), d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); if (d > 1) near = d; }
    return { n, v: createView(n, s.w, s.h, source, near) };
  };

  return {
    /** 'webgl2' or 'canvas2d'. */
    backend: gl ? 'webgl2' : 'canvas2d',
    /**
     * Draw one frame. @param {any} handle the screen's `world` @param {any[]} [extra] more overlay items (the host adds the pick cursor here); other entries are ignored
     * @param {{ l?: number, t?: number, r?: number, b?: number, ts?: number }} [layout] the part of the canvas (fractions) the host's controls and the safe areas take; `dock` and `banner` items stay out of it
     */
    frame(handle, extra, layout) {
      lastHandle = handle;
      if (lost || broken || !draw) return;
      const t0 = now ? now() : 0;
      try {
        const { n, v } = makeView(handle), tier = governor.params;
        view = v;
        // a narrow field of view is a zoom: ask the world for the detail of a closer camera
        if (world && o.driveWorld !== false && frames % 10 === 0) world.update({ lat: v.lat, lon: v.lon, altM: Math.max(0, v.altM) * (v.map ? 0.6 : clamp(v.tanY / 0.577, 0.25, 1.5)) });
        if (frames % 120 === 0 && o.textScale === undefined && typeof globalThis.getComputedStyle === 'function') { const z = parseFloat(globalThis.getComputedStyle(canvas).getPropertyValue('--zoom')); zoom = z > 0 ? 1 + (clamp(z, 1, 3) - 1) * 0.35 : 1; }
        const light = frameLight(n, v), P = scene ? scene.prepare(n, v, tier) : null;
        const more = Array.isArray(extra) ? extra.filter(x => x && OVERLAY_TYPES.includes(x.type)) : [];
        const ops = layoutOverlays(n, v, { textScale: o.textScale ?? zoom, elevation: source.elevation, extra: more, layout, maxLabels: tier.labels, regions: o.regions, labelMemory });
        last = draw.frame(n, v, light, P, ops, tier);
        uploads += last.uploads; if (frames > 0 && (last.patchUploads || 0) > maxUploads) maxUploads = last.patchUploads;
      } catch (e) { log(e); broken = !view; }
      frames++;
      if (now) {
        const t1 = now(); frameMs += (t1 - t0 - frameMs) * (frameMs ? 0.1 : 1);
        if (lastT === lastT) { const dt = t0 - lastT; intervalMs += (dt - intervalMs) * (intervalMs ? 0.1 : 1); governor.frame(Math.max(dt, t1 - t0)); }
        lastT = t0;
      }
    },
    /**
     * The place under a canvas pixel (x right, y down, in canvas pixels), or null for the sky. Works in every mode. `land` is false on
     * the sea and inland water; `surface` ('land', 'sea', 'lake', 'ice') is there when the world can say it (the built-in base map).
     * @returns {{ lat: number, lon: number, elevationM: number, land: boolean, surface?: string }|null}
     */
    pick(x, y) {
      const v = view || (lastHandle ? makeView(lastHandle).v : null), p = v ? v.pick(x, y) : null;
      if (!p) return null;
      const c = source.landCover(p.lat, p.lon) & 15;
      return { lat: p.lat, lon: p.lon, elevationM: p.elevationM, land: c !== 1 && c !== 2, ...(typeof source.surfaceAt === 'function' ? { surface: source.surfaceAt(p.lat, p.lon) } : {}) };
    },
    /**
     * Where a place is on the canvas. @param {number} lat @param {number} lon @param {number} [altM] above sea level
     * @returns {{ x: number, y: number, visible: boolean }}
     */
    project(lat, lon, altM = 0) {
      const v = view || (lastHandle ? makeView(lastHandle).v : null);
      if (!v) return { x: NaN, y: NaN, visible: false };
      const p = v.project(lat, lon, altM);
      return { x: p.x, y: p.y, visible: p.visible };
    },
    /** Numbers for the performance gate. frameMs: time spent inside frame(); intervalMs: time between frames (both smoothed). */
    stats() {
      return { backend: gl ? 'webgl2' : 'canvas2d', tier: governor.tier, auto: governor.auto, frameMs, intervalMs, frames, drawCalls: last.drawCalls, triangles: Math.round(last.triangles), uploads: last.uploads, patchUploads: last.patchUploads || 0, maxPatchUploads: maxUploads, totalUploads: uploads,
        lost, broken, ...(scene ? scene.stats() : {}) };
    },
    dispose() {
      if (gl && canvas.removeEventListener) { canvas.removeEventListener('webglcontextlost', onLost, false); canvas.removeEventListener('webglcontextrestored', onRestored, false); }
      try { if (scene && !lost) scene.reset(); if (draw) draw.dispose(); } catch (e) { log(e); }
      draw = null; view = null;
    },
  };
}
