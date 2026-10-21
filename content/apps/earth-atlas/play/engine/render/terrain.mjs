// @ts-check
// Terrain patches: a quadtree over latitude and longitude (the tile addressing of engine/world, continued to finer levels), each
// node a small regular mesh from world.meshPatch(). Every frame select() answers which patches to draw for a view and builds at
// most a budgeted number of new ones. A node is only replaced by its children when every visible child is ready, so the drawn
// set never has a hole; skirts hide the steps between neighbours of different detail. No drawing here.
import { M_PER_DEG, RAD, frameAt, toEcef } from './geo.mjs';
import { buildPatch } from './surface.mjs';

/** Period in metres of the procedural texture coordinates (every texture wavelength divides it). */
export const TEX_PERIOD = 65536;

/**
 * @typedef {object} PatchNode
 * @property {number} z @property {number} x @property {number} y
 * @property {number} south @property {number} west @property {number} north @property {number} east @property {number} lat0 @property {number} lon0
 * @property {number} cx @property {number} cy @property {number} cz @property {number} radius   bounding sphere, earth-centred
 * @property {number} minH @property {number} maxH @property {number} size   metres @property {number} pri
 * @property {Float64Array} frame   local frame of the mesh (east, north, up, origin)
 * @property {Float32Array} rot   the frame's axes for the shader @property {Float32Array} texO   texture origin
 * @property {boolean} ready @property {boolean} stale @property {number} version @property {number} used @property {number} cls @property {number} sig
 * @property {ReturnType<typeof buildPatch>|null} data   vertex data until the drawing layer has taken it
 * @property {any} gpu   owned by the drawing layer
 * @property {PatchNode[]|null} kids @property {PatchNode|null} parent
 */

/**
 * @param {{ world: any, clock?: () => number, onEvict?: (n: PatchNode) => void, maxPatches?: number }} o
 */
export function createTerrain(o) {
  const world = o.world, clock = o.clock || null;
  /** @type {Set<PatchNode>} */
  const ready = new Set();
  let frame = 0, gen = -1, builds = 0;
  const p3 = [0, 0, 0];
  let cellCount = 0;
  /** Land-cover cells across one world tile. */
  const cells = () => cellCount || (cellCount = (world.info && world.info() && world.info().tileN) || 256);

  const bound = nd => {
    const mid = (nd.minH + nd.maxH) / 2;
    toEcef(nd.lat0, nd.lon0, mid, p3);
    nd.cx = p3[0]; nd.cy = p3[1]; nd.cz = p3[2];
    let r2 = 0;
    for (let j = 0; j <= 2; j++) for (let i = 0; i <= 2; i++) for (let k = 0; k < 2; k++) {
      toEcef(nd.south + (nd.north - nd.south) * j / 2, nd.west + (nd.east - nd.west) * i / 2, k ? nd.maxH : nd.minH, p3);
      const d = (p3[0] - nd.cx) ** 2 + (p3[1] - nd.cy) ** 2 + (p3[2] - nd.cz) ** 2;
      if (d > r2) r2 = d;
    }
    nd.radius = Math.sqrt(r2);
  };
  /** @returns {PatchNode} */
  const make = (z, x, y, parent) => {
    const s = 180 / 2 ** z, south = -90 + y * s, west = -180 + x * s, lat0 = south + s / 2, lon0 = west + s / 2, ns = s * M_PER_DEG, frameV = frameAt(lat0, lon0, 0);
    /** @type {PatchNode} */
    const nd = { z, x, y, south, west, north: south + s, east: west + s, lat0, lon0, cx: 0, cy: 0, cz: 0, radius: 0, minH: parent ? parent.minH : -50, maxH: parent ? parent.maxH : 9000,
      size: ns * Math.sqrt(Math.max(0.1, Math.cos(lat0 * RAD))), pri: 0, frame: frameV, rot: new Float32Array(frameV.subarray(0, 9)),
      texO: new Float32Array([0, 1, 2].map(i => ((frameV[9 + i] % TEX_PERIOD) + TEX_PERIOD) % TEX_PERIOD)),
      ready: false, stale: false, version: 0, used: 0, cls: 0, sig: 0, data: null, gpu: null, kids: null, parent };
    bound(nd);
    return nd;
  };
  const roots = [make(0, 0, 0, null), make(0, 1, 0, null)];
  const signature = nd => { let s = 0; for (const [a, b] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) s += world.levelAt ? world.levelAt(nd.south + (nd.north - nd.south) * a, nd.west + (nd.east - nd.west) * b) : 0; return s; };
  const build = (nd, grid) => {
    // fewer columns towards the poles, where meridians converge
    const edge = Math.min(Math.abs(nd.south), Math.abs(nd.north)), cols = Math.max(4, Math.round(grid * Math.max(0.12, Math.cos(edge * RAD)) / 4) * 4), spacing = (nd.north - nd.south) * M_PER_DEG / grid;
    const z = world.levelAt ? world.levelAt(nd.lat0, nd.lon0) : -1;
    nd.data = buildPatch(world, nd, grid, cols, Math.max(10, spacing * 1.5), z >= 0 ? 180 / 2 ** z / cells() : 0);
    nd.minH = nd.data.minH; nd.maxH = nd.data.maxH; nd.sig = signature(nd); nd.ready = true; nd.stale = false; nd.version++;
    bound(nd); ready.add(nd); builds++; fresh.push(nd);
  };
  const drop = nd => { if (o.onEvict) o.onEvict(nd); nd.ready = false; nd.data = null; nd.gpu = null; ready.delete(nd); };

  /** @type {PatchNode[]} */
  let draw = [], want = [], spare = [], fresh = [];
  /** @type {any} */
  let V = null, lod = null;
  const visit = (nd, cls) => {
    nd.used = frame;
    if (cls === 2 && nd.z < lod.maxZ) {
      const kids = nd.kids || (nd.kids = [0, 1, 2, 3].map(c => make(nd.z + 1, 2 * nd.x + (c & 1), 2 * nd.y + (c >> 1), nd)));
      let ok = true;
      for (const k of kids) {
        k.used = frame; k.cls = V.classify(k, lod);
        if (k.cls !== 0 && !k.ready) { ok = false; want.push(k); } else if (!k.ready) { k.pri = nd.pri * 2 + 1e6; spare.push(k); }
      }
      if (ok) { for (const k of kids) if (k.cls !== 0) visit(k, k.cls); return; }
    }
    if (nd.stale) want.push(nd);
    draw.push(nd);
  };

  return {
    roots, ready,
    /**
     * Patches to draw for a view, coarse data first. Builds at most `budget.builds` patches (and stops after `budget.ms`
     * when a clock was given); the two root patches are built on the first call whatever the budget.
     * @param {any} view from createView @param {{ factor: number, grid: number, maxZ: number, cellPx: number }} lodParams @param {{ builds: number, ms?: number }} budget
     * @returns {{ draw: PatchNode[], built: number, wanted: number, fresh: PatchNode[] }} fresh: the patches built in this call (to upload now)
     */
    select(view, lodParams, budget) {
      frame++; V = view; lod = lodParams; draw = []; want = []; spare = []; fresh = [];
      const t0 = clock ? clock() : 0, before = builds;
      if (world.stats && frame % 8 === 1) { const g = world.stats().loads; if (g !== gen) { gen = g; for (const nd of ready) if (!nd.stale && signature(nd) !== nd.sig) nd.stale = true; } }
      for (const r of roots) { if (!r.ready) build(r, lod.grid); const c = view.classify(r, lod); r.used = frame; if (c) visit(r, c); }
      const wanted = want.length;
      want.sort((a, b) => a.pri - b.pri || a.z - b.z);
      if (!want.length && spare.length) want = spare.sort((a, b) => a.pri - b.pri).slice(0, 1);
      let done = 0;
      for (const nd of want) {
        if (done >= budget.builds || (done > 0 && clock && budget.ms && clock() - t0 > budget.ms)) break;
        if (nd.used === frame && (!nd.ready || nd.stale)) { build(nd, lod.grid); done++; }
      }
      if (frame % 32 === 0 && ready.size > (o.maxPatches || 500)) {
        const old = [...ready].filter(nd => nd.parent && nd.used < frame - 30 && !(nd.kids && nd.kids.some(k => k.ready))).sort((a, b) => a.used - b.used);
        for (const nd of old.slice(0, ready.size - (o.maxPatches || 500))) { drop(nd); const p = nd.parent; if (p && p.kids && p.kids.every(k => !k.ready && !k.kids)) p.kids = null; }
      }
      return { draw, built: builds - before, wanted, fresh };
    },
    /** Forget every built patch (drawing context lost, or a different world). */
    reset() { for (const nd of [...ready]) drop(nd); for (const r of roots) r.kids = null; gen = -1; },
    stats: () => ({ patches: ready.size, builds }),
  };
}

/** Finest quadtree level whose grid spacing is still at least `minSpacingM`. @param {number} grid @param {number} minSpacingM */
export const maxLevelFor = (grid, minSpacingM) => Math.max(0, Math.floor(Math.log2(180 * M_PER_DEG / (grid * minSpacingM))));
