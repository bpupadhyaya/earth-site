// @ts-check
// Scene preparation for one frame: which terrain patches, lines, runways, vehicles, cloud sheets and highlights to draw, with
// their geometry as typed arrays. Everything is built here within a per-frame budget and cached; the WebGL layer only uploads
// and draws what it is handed, and the Canvas2D layer reads the same lists. No drawing and no clock of its own.
import { R_EARTH, RAD, clamp, num, rgba, frameAt, horizonArc, arc } from './geo.mjs';
import { createTerrain, maxLevelFor, TEX_PERIOD } from './terrain.mjs';
import { buildRibbons, buildRunways, circle, rectangle, graticule, dashes, vehicleMesh, attitudeMatrix, VEHICLE_LENGTH, VECTOR_STYLE, frameOf } from './shapes.mjs';

const CLOUD_RINGS = 14, CLOUD_SEGS = 40;
/** Triangle indices of a cloud sheet (a fan of rings around the point below or above the camera). */
export const CLOUD_INDICES = (() => {
  const idx = [];
  for (let s = 0; s < CLOUD_SEGS; s++) idx.push(0, 1 + s, 1 + (s + 1) % CLOUD_SEGS);
  for (let r = 0; r + 1 < CLOUD_RINGS; r++) for (let s = 0; s < CLOUD_SEGS; s++) { const a = 1 + r * CLOUD_SEGS + s, b = 1 + r * CLOUD_SEGS + (s + 1) % CLOUD_SEGS; idx.push(a, a + CLOUD_SEGS, b + CLOUD_SEGS, a, b + CLOUD_SEGS, b); }
  return new Uint16Array(idx);
})();
/** Floats per cloud vertex: position relative to the camera (3), texture position (3), fade (1). */
export const CLOUD_FLOATS = 7;

/**
 * @param {{ world: any, clock?: () => number, regions?: (id: string) => ({ rings: ArrayLike<number>[] }|null), onEvict?: (item: any) => void, maxZ?: number, lineBudget?: number }} o
 *   maxZ: finest terrain level (the flat base map needs no fine patches); lineBudget: line sets built every frame even while patches are built
 */
export function createScene(o) {
  const world = o.world, evict = o.onEvict || (() => {});
  const terrain = createTerrain({ world, clock: o.clock, onEvict: evict });
  /** @type {Map<string, any>} */
  const ribbons = new Map();
  /** @type {any} */
  let runways = null, runwayKey = '', tiles = [], frame = 0, highlight = null;
  const cloudBuf = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new Float32Array((1 + CLOUD_RINGS * CLOUD_SEGS) * CLOUD_FLOATS));
  const builds = { patches: 0, lines: 0 };

  const elevation = (lat, lon) => world.elevation(lat, lon, { detail: false });
  /** A cached ribbon set: rebuilt when its key changes. */
  const ribbon = (id, key, make) => {
    let r = ribbons.get(id);
    if (!r || r.key !== key) { if (r) evict(r); const m = make(); r = { key, data: buildRibbons(m.frame, m.lines, m.drape ? elevation : null, m.opts), gpu: null, used: frame, lift: m.lift ?? 0.004 }; ribbons.set(id, r); builds.lines++; }
    r.used = frame;
    return r;
  };

  /** One sheet of cloud at a height, as a fan of rings centred on the camera's ground position. */
  const cloudSheet = (view, heightM, out) => {
    const f = view.frame, hc = view.altM, above = hc > heightM, rc = R_EARTH + hc, rs = R_EARTH + heightM;
    const maxArc = above ? Math.min(Math.acos(clamp(rs / rc, -1, 1)), 1.4) : Math.min(horizonArc(hc) + horizonArc(heightM), 0.11);
    const base = [0, 1, 2].map(i => Math.floor(view.pos[i] / TEX_PERIOD) * TEX_PERIOD);
    const put = (k, phi, az, fade) => {
      const sp = Math.sin(phi), cp = Math.cos(phi), e = sp * Math.sin(az), nn = sp * Math.cos(az), q = k * CLOUD_FLOATS;
      for (let i = 0; i < 3; i++) { const u = cp * f[6 + i] + e * f[i] + nn * f[3 + i]; out[q + i] = rs * u - rc * f[6 + i]; out[q + 3 + i] = rs * u - base[i]; }
      out[q + 6] = fade;
    };
    put(0, 0, 0, 1);
    for (let r = 0; r < CLOUD_RINGS; r++) { const t = (r + 1) / CLOUD_RINGS, phi = Math.max(maxArc, 1e-4) * Math.pow(t, 2.2), fade = r === CLOUD_RINGS - 1 ? 0 : 1; for (let s = 0; s < CLOUD_SEGS; s++) put(1 + r * CLOUD_SEGS + s, phi, 2 * Math.PI * s / CLOUD_SEGS, fade); }
    return out;
  };

  return {
    terrain,
    /**
     * @param {ReturnType<typeof import('./handle.mjs').normalise>} n @param {any} view @param {any} tier from governor.mjs TIERS
     */
    prepare(n, view, tier) {
      frame++;
      // patches are refined by how large they are on the canvas: a narrow field of view is a zoom, and the globe is seen face on
      const zoom = view.map ? 1 : clamp(0.577 / view.tanY, 0.5, 4) * (n.mode === 'globe' ? 2 : 1);
      const flight = n.mode === 'flight', lod = { factor: tier.factor * zoom, grid: tier.grid, maxZ: Math.min(o.maxZ ?? 99, maxLevelFor(tier.grid, tier.minSpacingM)), cellPx: tier.cellPx };
      const sel = terrain.select(view, lod, { builds: tier.builds, ms: tier.buildMs });
      builds.patches += sel.built;
      let spare = Math.max(sel.built === 0 ? 1 : 0, o.lineBudget || 0);   // one line set a frame, and only when no patch was built (or the given number always)
      /** @type {any[]} */
      const lines = [];

      // vector layers of the loaded world tiles
      if (frame % 16 === 1 || !tiles.length) tiles = world.scene ? world.scene({ lat: view.lat, lon: view.lon, altM: view.altM }).tiles : [];
      const layers = n.layers.vectors, lkey = layers.join(',') + (flight ? '/f' : '');
      if (layers.length && world.vectors) for (const t of tiles) {
        if (flight && t.distanceM > tier.vectorKm * 1000) continue;
        const id = `v/${t.z}/${t.x}/${t.y}`, have = ribbons.get(id);
        if (have && have.key === lkey) { have.used = frame; lines.push(have); continue; }
        if (!spare) { if (have) { have.used = frame; lines.push(have); } continue; }
        spare--;
        lines.push(ribbon(id, lkey, () => {
          const s = (t.north - t.south) * 0.1, feats = world.vectors({ south: t.south + s, west: t.west + s, north: t.north - s, east: t.east - s }, { level: t.z });
          /** @type {import('./shapes.mjs').Line[]} */
          const out = []; let pts = 0;
          for (const ft of feats.sort((a, b) => a.rank - b.rank)) {
            const st = VECTOR_STYLE[ft.kind];
            if (!st || !layers.includes(st.layer) || pts > 30000) continue;
            pts += ft.coords.length / 2;
            out.push({ pts: ft.coords, colour: st.colour, halfWidthM: flight ? st.halfWidthM * (ft.rank <= 1 ? 1.6 : 1) : 0, minPx: st.minPx * (ft.rank <= 1 ? 1.25 : 1) });
          }
          return { frame: frameOf((t.south + t.north) / 2, (t.west + t.east) / 2), lines: out, drape: flight, opts: { maxSegM: flight ? Math.max(600, (t.north - t.south) * 111000 / 256) : 60000, liftM: 6 } };
        }));
      }
      // things the template placed in the world
      n.objects.forEach((ob, i) => {
        if (!Number.isFinite(ob.lat) && ob.type !== 'line') return;
        const id = `o/${ob.id || i}`, k = rgba(ob.color, 0xffd820ff);
        if (ob.type === 'ring' && ob.radiusM > 0) lines.push(ribbon(id, `r${ob.lat},${ob.lon},${ob.radiusM},${ob.widthM},${k}`, () => ({ frame: frameOf(ob.lat, ob.lon), lines: [{ pts: circle(ob.lat, ob.lon, ob.radiusM), colour: k, halfWidthM: num(ob.widthM, Math.max(1.5, ob.radiusM * 0.04)) / 2, minPx: 1.2, closed: true }], drape: !view.map, opts: { liftM: 1.5, maxSegM: 1e6 } })));
        else if (ob.type === 'zone' && ob.lengthM > 0 && ob.widthM > 0) lines.push(ribbon(id, `z${ob.lat},${ob.lon},${ob.headingDeg},${ob.lengthM},${ob.widthM},${k}`, () => ({ frame: frameOf(ob.lat, ob.lon), lines: [{ pts: rectangle(ob.lat, ob.lon, num(ob.headingDeg, 0), ob.lengthM, ob.widthM), colour: k, halfWidthM: Math.max(1, ob.widthM * 0.03), minPx: 1.3, closed: true }], drape: !view.map, opts: { liftM: 1.5, maxSegM: 150 } })));
        else if (ob.type === 'thermal' && ob.radiusM > 0) {
          const base = num(ob.baseM, elevation(ob.lat, ob.lon)), top = num(ob.topM, base + 1500), kc = rgba(ob.color, 0xffffff90);
          lines.push(ribbon(id, `t${ob.lat},${ob.lon},${ob.radiusM},${base},${top},${kc}`, () => ({ frame: frameOf(ob.lat, ob.lon), drape: false, opts: { maxSegM: 1e6 },
            lines: [0.02, 0.35, 0.68, 1].map(f => { const c = circle(ob.lat, ob.lon, ob.radiusM * (0.7 + 0.3 * f), 40), p = new Float64Array(120); for (let q = 0; q < 40; q++) { p[3 * q] = c[2 * q]; p[3 * q + 1] = c[2 * q + 1]; p[3 * q + 2] = base + (top - base) * f; } return { pts: p, stride: 3, colour: kc, halfWidthM: ob.radiusM * 0.02, minPx: 0.9, closed: true, drape: false }; }) })));
        } else if (ob.type === 'line' && Array.isArray(ob.points) && ob.points.length > 1) {
          const drape = ob.drape ?? ob.points.every(p => p.length < 3), kl = rgba(ob.color, 0xff50ffff);
          lines.push(ribbon(id, 'l' + JSON.stringify([ob.points, ob.widthM, kl, drape, ob.dash]), () => {
            const whole = ob.points.flatMap(p => [p[0], p[1], num(p[2], 0)]);
            return { frame: frameOf(ob.points[0][0], ob.points[0][1]), drape: drape && !view.map, opts: { maxSegM: drape ? 300 : 20000, liftM: 2 },
              lines: (ob.dash ? dashes(whole, ob.dash) : [whole]).map(pts => ({ pts, stride: 3, colour: kl, halfWidthM: num(ob.widthM, 4) / 2, minPx: 1.1, drape })) };
          }));
        }
      });
      // in four quarters of 90 degrees, each in a frame at its middle, so that a flat map centred anywhere shows all of it
      if (n.layers.graticule > 0) for (let k = 0; k < 4; k++) lines.push(ribbon(`grat${k}`, `g${n.layers.graticule}`, () => ({ frame: frameAt(0, -135 + 90 * k, 0), lines: graticule(n.layers.graticule, 0xffffff48, -180 + 90 * k, -90 + 90 * k), drape: false, opts: { maxSegM: 1e9 } })));

      // highlighted regions: outlines here, the fill is a mask the drawing layer rasterises from the same rings
      /** @type {{ rings: ArrayLike<number>[], colour: number, fill: boolean }[]} */
      const shapes = [];
      for (const hl of n.highlight) {
        const colour = rgba(hl.color, 0xffd040c0);
        let rings = null;
        if (Array.isArray(hl.ring)) rings = [hl.ring.flat()];
        else if (hl.circle) rings = [circle(hl.circle.lat, hl.circle.lon, hl.circle.radiusKm * 1000, 96)];
        else if (hl.box) { const b = hl.box, e = b.east < b.west ? b.east + 360 : b.east, r = []; for (let i = 0; i <= 16; i++) r.push(b.south, b.west + (e - b.west) * i / 16); for (let i = 0; i <= 16; i++) r.push(b.north, e - (e - b.west) * i / 16); rings = [r]; }
        else if (hl.id && o.regions) { const g = o.regions(hl.id); rings = g && g.rings ? g.rings : null; }
        if (rings && rings.length) shapes.push({ rings, colour, fill: hl.fill !== false });
      }
      const hkey = shapes.length ? JSON.stringify(n.highlight) : '';
      if (hkey !== (highlight ? highlight.key : '')) {
        if (highlight) evict(highlight);
        highlight = null;
        if (shapes.length) {
          let south = 90, north = -90, west = 0, east = 0, first = true;
          const ref = shapes[0].rings[0][1];
          for (const s of shapes) for (const r of s.rings) for (let i = 0; i + 1 < r.length; i += 2) { const d = ((r[i + 1] - ref + 540) % 360) - 180; south = Math.min(south, r[i]); north = Math.max(north, r[i]); west = first ? d : Math.min(west, d); east = first ? d : Math.max(east, d); first = false; }
          const padLat = Math.max(0.01, (north - south) * 0.04), padLon = Math.max(0.01, (east - west) * 0.04);
          highlight = { key: hkey, shapes, gpu: null, ref, box: { south: Math.max(-90, south - padLat), north: Math.min(90, north + padLat), west: ref + west - padLon, width: Math.min(360, east - west + 2 * padLon) } };
        }
      }
      if (highlight) lines.push(ribbon('hl', hkey, () => ({ frame: frameOf(shapes[0].rings[0][0], shapes[0].rings[0][1]), drape: false, opts: { maxSegM: 40000 },
        lines: shapes.flatMap(s => s.rings.map(r => ({ pts: r, colour: (s.colour | 0xff) >>> 0, halfWidthM: 0, minPx: 1.3, closed: true, drape: false }))) })));

      // runways near the camera
      /** @type {any} */
      let rw = null;
      if (n.runways.show && world.runwaysNear) {
        if (frame % 32 === 1 || !runwayKey) {
          const near = world.runwaysNear(view.lat, view.lon, view.map ? clamp(view.metresPerPx * view.w / 1000, 5, 400) : clamp(view.altM / 100, 40, 250)), tg = n.runways.target;
          let best = null, bd = 0.0005;
          if (tg && n.runways.emphasis === 'target') for (const r of near) { const d = arc(tg.lat, tg.lon, r.lat, r.lon); if (d < bd) { bd = d; best = r; } }
          const key = `${n.runways.emphasis}/${best ? best.lat : ''}/${view.map ? 'm' : ''}/` + near.slice(0, 60).map(r => `${r.lat.toFixed(4)},${r.lon.toFixed(4)},${Math.round(r.headingDeg)}`).join(';');
          if (key !== runwayKey) {
            runwayKey = key; if (runways) evict(runways);
            const list = near.slice(0, 60), em = r => n.runways.emphasis === 'all' || r === best;
            runways = !list.length ? null : view.map
              ? { map: true, data: buildRibbons(frameOf(list[0].lat, list[0].lon), list.map(r => { const c = rectangle(r.lat, r.lon, r.headingDeg, r.lengthM, 0.001); return { pts: [(c[0] + c[6]) / 2, (c[1] + c[7]) / 2, (c[2] + c[4]) / 2, (c[3] + c[5]) / 2], colour: em(r) ? rgba(n.runways.color, 0x40ff80ff) : 0x202024ff, halfWidthM: (r.widthM || 30) / 2, minPx: em(r) ? 2 : 1, drape: false }; }), null, { maxSegM: 1e6 }), gpu: null, lift: 0 }
              : { map: false, data: buildRunways(frameOf(list[0].lat, list[0].lon), list, em), gpu: null, list };
          }
        }
        rw = runways;
        if (rw && rw.map) { lines.push(rw); rw = null; }
      }

      // vehicles: the player's own (when the camera is outside it) and traffic
      /** @type {{ mesh: ReturnType<typeof vehicleMesh>, rot: Float32Array, frame: Float64Array }[]} */
      const meshes = [];
      const vehicle = (v, own) => {
        const model = typeof v.model === 'string' && VEHICLE_LENGTH[v.model] ? v.model : 'airplane', len = clamp(num(v.lengthM, VEHICLE_LENGTH[model]), 0.1, 500), alt = num(v.altM, 0);
        const f = frameAt(v.lat, v.lon, alt), d = Math.hypot(f[9] - view.pos[0], f[10] - view.pos[1], f[11] - view.pos[2]);
        if (own && d < len * 0.75) return;
        meshes.push({ mesh: vehicleMesh(model, rgba(v.color, own ? 0xf4f4f0ff : 0xffb428ff), model === 'bird' || model === 'balloon' ? clamp(num(v.flap, 0), -1, 1) : 0), rot: attitudeMatrix(f, num(v.headingDeg, 0), num(v.pitchDeg, 0), num(v.rollDeg, 0), len, new Float32Array(9)), frame: f });
      };
      if (!view.map) { if (n.vehicle) vehicle(n.vehicle, true); for (const ob of n.objects) if (ob.type === 'traffic' && Number.isFinite(ob.lat) && Number.isFinite(ob.lon)) vehicle(ob, false); }

      // cloud sheets, farthest first
      /** @type {{ vertices: Float32Array, cover: number, below: number, gap: number }[]} */
      const clouds = [];
      if (!view.map) {
        let k = 0;
        for (const c of n.clouds.slice(0, tier.clouds)) {
          if (view.altM < c.topM) clouds.push({ vertices: cloudSheet(view, c.baseM, cloudBuf[k++]), cover: c.cover, below: 1, gap: Math.abs(c.baseM - view.altM) });
          if (view.altM > c.baseM) clouds.push({ vertices: cloudSheet(view, c.topM, cloudBuf[k++]), cover: c.cover, below: 0, gap: Math.abs(c.topM - view.altM) });
        }
        clouds.sort((a, b) => b.gap - a.gap);
      }

      if (frame % 64 === 0) for (const [id, r] of ribbons) if (r.used < frame - 120) { evict(r); ribbons.delete(id); }
      return { patches: sel.draw, fresh: sel.fresh, wanted: sel.wanted, built: sel.built, lines, runways: rw, meshes, clouds, highlight, lod };
    },
    /** Forget everything the drawing layer holds (context lost). */
    reset() { terrain.reset(); for (const r of ribbons.values()) evict(r); ribbons.clear(); if (runways) evict(runways); runways = null; runwayKey = ''; if (highlight) evict(highlight); highlight = null; },
    stats: () => ({ ...terrain.stats(), lineSets: ribbons.size, patchBuilds: builds.patches, lineBuilds: builds.lines }),
  };
}
