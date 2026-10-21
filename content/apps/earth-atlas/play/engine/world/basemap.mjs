// @ts-check
// The compact built-in base map: land, lakes, ice, coasts, major rivers and country boundaries of the whole planet from Natural
// Earth 1:10m (public domain), about 0.28 MB (0.23 MB gzipped), for apps without the world base. `createBaseMap(bytes)` answers the
// part of the engine/world interface that engine/render reads (elevation, landCover, normal, meshPatch, vectors, scene, stats), so
// the renderer draws map and globe views from it on WebGL2 and Canvas2D exactly as from the world tiles: flat ground at sea level,
// one land colour, water, ice, lines. It also says what is at a place (`surfaceAt`). Built by shells/basemap/build.mjs; format there.
//
// Classification is exact along a latitude row: each area layer keeps, per row of 1/128 degree, the sorted longitudes where its
// rings cross the row (even-odd rule), computed on first use and cached. A lookup is a binary search.
import { buildMeshPatch } from './mesh.mjs';

/** Line kinds of `vectors()`: the engine/world kinds plus one for boundaries that are not settled (drawn dashed). */
export const BASEMAP_KIND = Object.freeze({ COAST: 1, RIVER: 2, LAKE_SHORE: 3, BORDER: 6, BORDER_DISPUTED: 7 });
/** The land-cover classes of engine/world (tile.mjs LC) the base map uses; written out so that apps without the world base need not ship the tile decoder. */
const LC = Object.freeze({ OCEAN: 1, WATER: 2, SNOW_ICE: 3, MOSS_LICHEN: 5 });
/** Rows per degree of the crossing tables. */
const ROWS = 128;
/** Dash and gap of unsettled boundaries, degrees of arc (about 28 and 20 km). */
const DASH = 0.25, GAP = 0.18;
const TILE = 90;           // vectors are grouped in eight tiles of 90 degrees (engine/world level 1)

/**
 * @typedef {{ id: string, kind: string, rank: Uint8Array, start: Uint32Array, ll: Float64Array }} Layer   ll = lat0, lon0, lat1, lon1, ...; feature f is points start[f]..start[f+1]
 */

/** @param {Uint8Array} bytes @returns {{ header: any, layers: Record<string, Layer> }} */
export function decodeBaseMap(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 8 || b[0] !== 0x45 || b[1] !== 0x42 || b[2] !== 0x4d || b[3] !== 0x31) throw new Error('decodeBaseMap: not an EBM1 base map');
  const hl = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24), header = JSON.parse(new TextDecoder().decode(b.subarray(8, 8 + hl)));
  const q = 360 / header.q;
  /** @type {Record<string, Layer>} */
  const layers = {};
  let p = 8 + hl;
  for (const L of header.layers) {
    const end = p + L.bytes, rank = new Uint8Array(L.features), start = new Uint32Array(L.features + 1), ll = new Float64Array(L.points * 2);
    const uv = () => { let v = 0, m = 1, c; do { c = b[p++]; v += (c & 127) * m; m *= 128; } while (c & 128); return v; };
    const zz = () => { const v = uv(); return v % 2 ? -(v + 1) / 2 : v / 2; };
    let x = 0, y = 0, k = 0;
    for (let f = 0; f < L.features; f++) {
      rank[f] = uv(); const n = uv(); start[f] = k;
      for (let i = 0; i < n; i++) { x += zz(); y += zz(); ll[2 * k] = y * q - 90; ll[2 * k + 1] = x * q - 180; k++; }
    }
    start[L.features] = k;
    if (p !== end || k !== L.points) throw new Error(`decodeBaseMap: layer ${L.id} is damaged`);
    layers[L.id] = { id: L.id, kind: L.kind, rank, start, ll };
  }
  return { header, layers };
}

/** Per-row crossing tables of one area layer (even-odd fill), built lazily. @param {Layer} L */
function crossings(L) {
  // edges bucketed by whole degree of latitude; an edge is (lat0, lon0, lat1, lon1)
  /** @type {number[][]} */
  const bands = Array.from({ length: 180 }, () => []);
  const n = L.start.length - 1, ll = L.ll;
  for (let f = 0; f < n; f++) {
    const a = L.start[f], b = L.start[f + 1];
    for (let i = a; i < b; i++) {
      const j = i + 1 < b ? i + 1 : a, y0 = ll[2 * i], y1 = ll[2 * j];
      if (y0 === y1) continue;
      const lo = Math.max(0, Math.floor(Math.min(y0, y1) + 90)), hi = Math.min(179, Math.floor(Math.max(y0, y1) + 90));
      for (let k = lo; k <= hi; k++) bands[k].push(y0, ll[2 * i + 1], y1, ll[2 * j + 1]);
    }
  }
  const edges = bands.map(e => Float64Array.from(e));
  /** @type {Map<number, Float64Array>} */
  const rows = new Map();
  const row = r => {
    let xs = rows.get(r);
    if (xs) return xs;
    const y = -90 + (r + 0.5) / ROWS, e = edges[Math.min(179, Math.floor(y + 90))], out = [];
    for (let i = 0; i < e.length; i += 4) { const y0 = e[i], y1 = e[i + 2]; if ((y0 <= y) !== (y1 <= y)) out.push(e[i + 1] + (y - y0) / (y1 - y0) * (e[i + 3] - e[i + 1])); }
    xs = Float64Array.from(out).sort(); rows.set(r, xs);
    return xs;
  };
  /** Inside the layer's area at a place? */
  return (lat, lon) => {
    const r = Math.max(0, Math.min(180 * ROWS - 1, Math.floor((lat + 90) * ROWS))), xs = row(r);
    let lo = 0, hi = xs.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < lon) lo = m + 1; else hi = m; }
    return (lo & 1) === 1;
  };
}

/** Coast lines from the land rings, without the artificial edges along the 180 degree meridian and the south pole. @param {Layer} L */
function coastLines(L) {
  /** @type {Float64Array[]} */
  const out = [];
  const n = L.start.length - 1, ll = L.ll;
  const fake = (i, j) => (Math.abs(ll[2 * i + 1]) >= 179.999 && ll[2 * i + 1] === ll[2 * j + 1]) || (ll[2 * i] <= -89.99 && ll[2 * j] <= -89.99);
  for (let f = 0; f < n; f++) {
    const a = L.start[f], b = L.start[f + 1], m = b - a;
    // start at a real edge that follows an artificial one, so that one ring gives as few lines as possible
    let s = 0;
    for (let k = 0; k < m; k++) if (fake(a + (k + m - 1) % m, a + k) && !fake(a + k, a + (k + 1) % m)) { s = k; break; }
    let cur = [];
    for (let k = 0; k <= m; k++) {
      const i = a + (s + k) % m, j = a + (s + k + 1) % m;
      if (!cur.length) cur.push(ll[2 * i], ll[2 * i + 1]);
      if (k === m || fake(i, j)) { if (cur.length >= 4) out.push(Float64Array.from(cur)); cur = []; continue; }
      cur.push(ll[2 * j], ll[2 * j + 1]);
    }
  }
  return out;
}

/** A line cut into dashes of DASH degrees with GAP between them (lengths with longitudes scaled by the cosine of the latitude). @param {Float64Array} c */
function dashLine(c) {
  /** @type {Float64Array[]} */
  const out = [];
  let on = true, left = DASH, cur = [c[0], c[1]];
  for (let i = 2; i < c.length; i += 2) {
    let la = c[i - 2], lo = c[i - 1];
    const lb = c[i], lob = c[i + 1], k = Math.cos((la + lb) / 2 * Math.PI / 180);
    let seg = Math.hypot(lb - la, (lob - lo) * k);
    while (seg > left) {
      const t = left / seg; la += (lb - la) * t; lo += (lob - lo) * t; seg -= left;
      if (on) { cur.push(la, lo); if (cur.length >= 4) out.push(Float64Array.from(cur)); cur = []; } else cur = [la, lo];
      on = !on; left = on ? DASH : GAP;
    }
    left -= seg;
    if (on) cur.push(lb, lob);
  }
  if (on && cur.length >= 4) out.push(Float64Array.from(cur));
  return out;
}

/**
 * A line cut where it crosses the meridians -90, 0 and 90, so that every piece lies inside one of the four 90-degree columns of
 * line tiles (renderers measure line points from the middle of their tile). @param {Float64Array} c
 */
function splitAtQuarters(c) {
  /** @type {Float64Array[]} */
  const out = [];
  const col = lon => Math.min(3, Math.floor((lon + 180) / TILE));
  let cur = [c[0], c[1]], k = col(c[1]);
  for (let i = 2; i < c.length; i += 2) {
    const la = c[i], lo = c[i + 1], k2 = col(lo);
    if (k2 !== k && Math.abs(lo - c[i - 1]) < 180) {
      // cross every quarter meridian between the two points
      const step = k2 > k ? 1 : -1;
      for (let q = k; q !== k2; q += step) {
        const m = -180 + TILE * (step > 0 ? q + 1 : q), t = (m - c[i - 1]) / (lo - c[i - 1]), y = c[i - 2] + (la - c[i - 2]) * t;
        cur.push(y, m); if (cur.length >= 4) out.push(Float64Array.from(cur)); cur = [y, m];
      }
    } else if (k2 !== k) { if (cur.length >= 4) out.push(Float64Array.from(cur)); cur = []; }
    cur.push(la, lo); k = k2;
  }
  if (cur.length >= 4) out.push(Float64Array.from(cur));
  return out;
}

/**
 * The base map as a world for engine/render (and a place classifier). Pure: no clock, no I/O; the bytes come from the app.
 * @param {Uint8Array|ArrayBuffer} bytes  the .ebm file (engine/world/data/basemap.ebm)
 * @param {{ landClass?: number }} [o]  land-cover class used for land (default LC.MOSS_LICHEN, a neutral grey-green)
 */
export function createBaseMap(bytes, o = {}) {
  const { header, layers } = decodeBaseMap(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const landClass = o.landClass ?? LC.MOSS_LICHEN;
  const inLand = crossings(layers.land), inLake = layers.lake ? crossings(layers.lake) : () => false, inIce = layers.ice ? crossings(layers.ice) : () => false;
  const wrap = lon => (lon >= -180 && lon < 180 ? lon : lon - 360 * Math.floor((lon + 180) / 360));
  /** 'land' | 'sea' | 'lake' | 'ice' at a place. */
  const surfaceAt = (lat, lon) => {
    const la = Math.max(-90, Math.min(90, lat)), lo = wrap(lon);
    if (inLand(la, lo)) return inLake(la, lo) ? 'lake' : inIce(la, lo) ? 'ice' : 'land';
    return inIce(la, lo) ? 'ice' : inLake(la, lo) ? 'lake' : 'sea';
  };
  const CLASS = { land: landClass, sea: LC.OCEAN, lake: LC.WATER, ice: LC.SNOW_ICE };
  const landCover = (lat, lon) => CLASS[surfaceAt(lat, lon)];

  // lines, grouped in eight tiles of 90 degrees by their first point
  /** @type {{ kind: number, rank: number, coords: Float64Array }[][]} */
  const tiles = Array.from({ length: 8 }, () => []);
  const put = (kind, rank, coords) => { for (const c of splitAtQuarters(coords)) putOne(kind, rank, c); };
  const putOne = (kind, rank, coords) => { const x = Math.min(3, Math.floor((coords[1] + 180) / TILE)), y = Math.min(1, Math.floor((coords[0] + 90) / TILE)); tiles[y * 4 + x].push({ kind, rank, coords }); };
  const each = (L, fn) => { if (!L) return; for (let f = 0; f + 1 < L.start.length; f++) fn(L.ll.subarray(2 * L.start[f], 2 * L.start[f + 1]), L.rank[f]); };
  for (const c of coastLines(layers.land)) put(BASEMAP_KIND.COAST, 0, c);
  each(layers.border, c => put(BASEMAP_KIND.BORDER, 1, c));
  each(layers.borderDisputed, c => { for (const d of dashLine(c)) put(BASEMAP_KIND.BORDER_DISPUTED, 1, d); });
  each(layers.lake, (c, r) => { const ring = new Float64Array(c.length + 2); ring.set(c); ring[c.length] = c[0]; ring[c.length + 1] = c[1]; put(BASEMAP_KIND.LAKE_SHORE, r <= 3 ? 1 : 2, ring); });
  each(layers.river, (c, r) => put(BASEMAP_KIND.RIVER, r <= 2 ? 2 : 3, c));
  const tileList = tiles.map((_, i) => { const x = i % 4, y = Math.floor(i / 4); return { z: 1, x, y, south: -90 + y * TILE, west: -180 + x * TILE, north: -90 + (y + 1) * TILE, east: -180 + (x + 1) * TILE, distanceM: 0 }; });
  const UP = Object.freeze([0, 0, 1]);
  /** @type {Record<string, { ll: Float64Array, west: number, east: number }[]>} */
  const rings = {};
  const src = { height: () => 0, landCover };

  return {
    kind: 'earth-basemap',
    header,
    surfaceAt,
    landCover,
    /** Sea level everywhere: the base map is flat. */
    elevation: () => 0,
    normal: () => UP,
    /** Same contract as engine/world meshPatch, on the flat sphere. @param {import('./mesh.mjs').PatchRequest} req */
    meshPatch: req => buildMeshPatch(req, src),
    /** Lines of the tiles whose middle lies inside the box (the renderer asks tile by tile with a slightly smaller box). */
    vectors(box, opt = {}) {
      /** @type {{ kind: number, rank: number, coords: Float64Array }[]} */
      const out = [];
      tileList.forEach((t, i) => {
        const la = (t.south + t.north) / 2, lo = (t.west + t.east) / 2;
        if (la < box.south || la > box.north || lo < box.west || lo > box.east) return;
        for (const f of tiles[i]) if (!opt.kinds || opt.kinds.includes(f.kind)) out.push(f);
      });
      return out;
    },
    /** All eight line tiles, always (the whole map is in memory). */
    scene: () => ({ kind: 'earth-basemap-scene', tiles: tileList.map(t => ({ ...t })) }),
    update() {},
    stats: () => ({ loads: 1 }),
    info: () => ({ tileN: 256, basemap: true, landClass }),
    /**
     * Rings of an area layer ('land', 'lake', 'ice') with their longitude range, for drawing the areas (even-odd rule).
     * @param {string} id @returns {{ ll: Float64Array, west: number, east: number }[]}
     */
    areas(id) {
      if (rings[id]) return rings[id];
      const L = layers[id], out = [];
      if (L) for (let f = 0; f + 1 < L.start.length; f++) {
        const ll = L.ll.subarray(2 * L.start[f], 2 * L.start[f + 1]);
        let west = 180, east = -180;
        for (let i = 1; i < ll.length; i += 2) { if (ll[i] < west) west = ll[i]; if (ll[i] > east) east = ll[i]; }
        out.push({ ll, west, east });
      }
      return (rings[id] = out);
    },
    /** Credit lines for the app's Sources screen. */
    credits: () => [{ title: header.credit, license: 'Public domain (Natural Earth)', url: 'https://www.naturalearthdata.com/' }],
  };
}
