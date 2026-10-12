// One-off generator (not part of the site build): projects Natural Earth land onto a small orthographic disc and writes
// content/mark-paths.json (land + graticule path strings) used by build.mjs for the header mark and favicon.
// Run: node tools/gen-mark.mjs
import vm from 'node:vm'; import fs from 'node:fs';
const ctx = { console }; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
for (const f of ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js']) vm.runInContext(fs.readFileSync('src/vendor/' + f, 'utf8'), ctx);
const { d3, topojson } = ctx;
const world = JSON.parse(fs.readFileSync('src/vendor/countries-110m.json', 'utf8'));
const merged = topojson.merge(world, world.objects.countries.geometries);
// keep only the larger landmasses so the mark stays small and clean at icon size
const land = { type: 'MultiPolygon', coordinates: merged.coordinates.filter((poly) => d3.geoArea({ type: 'Polygon', coordinates: poly }) > 0.0035) };
const proj = d3.geoOrthographic().rotate([32, -18, 0]).translate([100, 100]).scale(92).clipAngle(90).precision(2.5);
const round = (s) => s.replace(/(\d+\.\d{2})\d*/g, '$1').replace(/\.0+(?=\D)/g, '');
const path = d3.geoPath(proj).digits(0);
const out = {
  land: round(path(land)),
  grat: round(path(d3.geoGraticule().step([30, 30])())),
  note: 'Natural Earth (public domain) via world-atlas; orthographic, rotate [32,-18]; viewBox 0 0 200 200, r=92'
};
fs.writeFileSync('content/mark-paths.json', JSON.stringify(out));
console.log('land', out.land.length, 'grat', out.grat.length);
