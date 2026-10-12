// One-off generator (not part of the site build): writes content/mark-land.json, a thinned set of Natural Earth land rings
// (integer lon/lat degrees) that site.js uses to spin the small header globe. Run: node tools/gen-mark-land.mjs
import vm from 'node:vm'; import fs from 'node:fs';
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js']) vm.runInContext(fs.readFileSync('src/vendor/' + f, 'utf8'), ctx);
const { d3, topojson } = ctx;
const world = JSON.parse(fs.readFileSync('src/vendor/countries-110m.json', 'utf8'));
const merged = topojson.merge(world, world.objects.countries.geometries);
const rings = [];
for (const poly of merged.coordinates) {
  if (d3.geoArea({ type: 'Polygon', coordinates: poly }) < 0.0035) continue; // small islands vanish at icon size
  const out = []; let last = null;
  for (const [lon, lat] of poly[0]) {
    const x = Math.round(lon), y = Math.round(lat);
    if (!last || Math.abs(x - last[0]) * Math.max(0.2, Math.cos(y * Math.PI / 180)) + Math.abs(y - last[1]) >= 2) { out.push(x, y); last = [x, y]; }
  }
  if (out.length >= 6) rings.push(out);
}
fs.writeFileSync('content/mark-land.json', JSON.stringify({ rings, note: 'Natural Earth (public domain) via world-atlas 110m; thinned; integer degrees; flat [lon,lat,...] per ring' }));
console.log('rings', rings.length, 'points', rings.reduce((n, r) => n + r.length / 2, 0));
