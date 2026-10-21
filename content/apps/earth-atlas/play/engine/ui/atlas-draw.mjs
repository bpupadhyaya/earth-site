// @ts-check
// Drawing for the picture blocks of play/atlas (templates/play/atlas/README.md): the country map with its flag, and the city cards
// with a mini map each. Platform: DOM only (inline SVG, no images, no network). Sizes are relative so text zoom 100-300% and any
// width work; motion is plain CSS and switched off by prefers-reduced-motion.

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); e.append(...kids); return e; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** Emoji flag from an ISO 3166 alpha-2 code; '' when the code is not two letters. */
export function flagOf(iso2) {
  const c = String(iso2 || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? String.fromCodePoint(...[...c].map(ch => 0x1f1e6 + ch.charCodeAt(0) - 65)) : '';
}

/** Bounds of every point of the outline (grid units, v up). */
function bounds(outline, extra) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const ring of [...(outline || []), ...(extra || [])]) for (let i = 0; i + 1 < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); y0 = Math.min(y0, ring[i + 1]); y1 = Math.max(y1, ring[i + 1]); }
  return x0 > x1 ? [0, 0, 1000, 1000] : [x0, y0, x1, y1];
}

/** SVG path data of the rings, y flipped so north is up. */
function pathOf(outline) {
  return (outline || []).map(ring => { let d = ''; for (let i = 0; i + 1 < ring.length; i += 2) d += `${i ? 'L' : 'M'}${ring[i]} ${1000 - ring[i + 1]}`; return d + 'Z'; }).join('');
}

let uid = 0;
/**
 * The outline as an <svg>, drawn like the app icons: a raised piece of land (cliff sides, lit top with a green-to-sand gradient, rim light,
 * coast glow, soft shadow) on the blue sea slab the container paints. opts.at = [u, v] draws a 3D pin there; opts.pulse makes its ring pulse;
 * opts.pad is the margin in grid units.
 * @param {{ outline: number[][], at?: number[] | null, pulse?: boolean, pad?: number, cls?: string }} o
 */
export function mapSvg({ outline, at, lines, view, context, pulse = false, pad = 60, cls = '' }) {
  const [x0, y0, x1, y1] = view && view.length === 4 ? view : bounds(outline, lines);   // view = the part of the map to show
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad + 30, top = 1000 - y1 - pad, left = x0 - pad;
  const id = `am${++uid}`, d = pathOf(outline);
  const s = svg('svg', { class: `atlas-svg ${cls}`.trim(), viewBox: `${left} ${top} ${w} ${h}`, preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true', focusable: 'false' });
  const stops = (...c) => c.map(([o, col, op]) => svg('stop', { offset: o, 'stop-color': col, ...(op != null ? { 'stop-opacity': op } : {}) }));
  const defs = svg('defs',
    {},
    svg('linearGradient', { id: `${id}t`, x1: 0, y1: 0, x2: 0.35, y2: 1 }, ...stops(['0', '#cfe6a0'], ['0.5', '#92bd68'], ['1', '#c8b078'])),
    svg('linearGradient', { id: `${id}h`, x1: 0, y1: 0, x2: 1, y2: 1 }, ...stops(['0', '#ffffff', 0.34], ['0.45', '#ffffff', 0], ['1', '#12301a', 0.3])),
    svg('radialGradient', { id: `${id}p`, cx: 0.38, cy: 0.32, r: 0.8 }, ...stops(['0', '#ff9a7a'], ['0.55', '#e0342b'], ['1', '#8a1410'])),
    svg('filter', { id: `${id}b`, x: '-20%', y: '-20%', width: '140%', height: '140%' }, svg('feGaussianBlur', { stdDeviation: 9 })));
  s.append(defs);
  if (context && context.length) s.append(svg('path', { class: 'atlas-context', d: pathOf(context), 'stroke-linejoin': 'round' }));   // faint neighbouring land, flat
  const sh = size => svg('path', { d, 'stroke-linejoin': 'round' });
  const shadow = sh(); shadow.setAttribute('class', 'atlas-shadow'); shadow.setAttribute('transform', 'translate(8 30)'); shadow.setAttribute('filter', `url(#${id}b)`); s.append(shadow);
  const glow = sh(); glow.setAttribute('class', 'atlas-glow'); glow.setAttribute('filter', `url(#${id}b)`); s.append(glow);
  for (let k = 9; k >= 1; k--) { const side = sh(); side.setAttribute('class', 'atlas-side'); side.setAttribute('transform', `translate(0 ${k * 2.6})`); side.setAttribute('style', `fill: hsl(32 38% ${22 + (9 - k) * 2.2}%)`); s.append(side); }
  const land = sh(); land.setAttribute('class', 'atlas-land'); land.setAttribute('fill', `url(#${id}t)`); s.append(land);
  const light = sh(); light.setAttribute('class', 'atlas-light'); light.setAttribute('fill', `url(#${id}h)`); s.append(light);
  if (lines && lines.length) {
    const dl = lines.map(l => { let q = ''; for (let i = 0; i + 1 < l.length; i += 2) q += `${i ? 'L' : 'M'}${l[i]} ${1000 - l[i + 1]}`; return q; }).join('');
    s.append(svg('path', { class: 'atlas-riverhalo', d: dl, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }), svg('path', { class: 'atlas-river', d: dl, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  }
  if (at && at.length === 2) {
    const cx = at[0], cy = 1000 - at[1], r = Math.max(w, h) / 34;
    const g = svg('g', { class: 'atlas-pin' + (pulse ? ' pulse' : '') });
    g.append(svg('ellipse', { class: 'atlas-pinshadow', cx: cx + r * 0.2, cy: cy + r * 1.05, rx: r * 1.1, ry: r * 0.42 }),
      svg('circle', { class: 'atlas-ring', cx, cy, r: r * 1.9 }),
      svg('circle', { class: 'atlas-dot', cx, cy, r, fill: `url(#${id}p)` }),
      svg('circle', { class: 'atlas-spec', cx: cx - r * 0.3, cy: cy - r * 0.34, r: r * 0.3 }));
    s.append(g);
  }
  return s;
}

/** The large map block: sea panel, country shape, flag and name; a pulsing pin at atlas.found once the answer is known. */
export function atlasBlock(a) {
  const box = el('figure', 'atlas-map');
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', `Map of ${a.name}`);
  const cap = el('figcaption', 'atlas-cap');
  const f = flagOf(a.iso2);
  if (f) { const fl = el('span', 'atlas-flag', f); fl.setAttribute('aria-hidden', 'true'); cap.append(fl); }
  cap.append(el('span', 'atlas-name', a.name));
  box.append(cap, mapSvg({ outline: a.outline, at: a.found || a.mark, lines: a.lines, view: a.view, context: a.context, pulse: !!a.found, pad: a.view ? 30 : 80, cls: 'big' }));
  return box;
}

/** Contents of a city card button: mini map with the city dot, the name and up to four clue chips. */
export function cardInner(label, card) {
  // a card with a position gets a mini map of the place; one without (an animal, a name) is just name and clues
  const own = card?.shape?.outline;   // a card with its own shape (a neighbour) draws it; one with a position draws the place with a dot
  const withMap = Boolean(own || (card?.outline && card?.at));
  const wrap = el('span', 'atlas-card-in' + (withMap ? '' : ' nopic'));
  if (withMap) { const pic = el('span', 'atlas-card-pic'); pic.append(mapSvg({ outline: own || card.outline, at: own ? null : card.at, pad: 50, cls: 'mini' })); wrap.append(pic); }
  const txt = el('span', 'atlas-card-txt');
  txt.append(el('span', 'atlas-card-name', label));
  const clues = (card?.clues || []).slice(0, 4);
  if (clues.length) { const chips = el('span', 'atlas-chips'); for (const c of clues) chips.append(el('span', 'atlas-chip', c)); txt.append(chips); }
  wrap.append(txt);
  return wrap;
}

/** Screen-reader name of a card: the city and its clues. */
export const cardName = (label, card) => [label, ...(card?.clues || []).slice(0, 4)].join('. ');

/** Dots instead of a bar: filled for rounds done, ringed for the current one. */
export function setDots(p, progress) {
  p.replaceChildren();
  if (!progress) return;
  for (let k = 1; k <= progress.n; k++) p.append(el('i', k < progress.i ? 'done' : k === progress.i ? 'now' : ''));
}

export const ATLAS_CSS = `
.earth-screen.atlas { max-width: min(100%, 64em); }
.earth-progress.dots { height: auto; background: none; border-radius: 0; overflow: visible; display: flex; flex-wrap: wrap; gap: 0.4em; justify-content: center; }
.earth-progress.dots i { width: clamp(8px, 0.7em, 14px); height: clamp(8px, 0.7em, 14px); border-radius: 50%; background: color-mix(in srgb, var(--fg) 18%, transparent); }
.earth-progress.dots i.done { background: var(--accent); } .earth-progress.dots i.now { background: none; box-shadow: 0 0 0 0.16em var(--accent); }
.earth-screen.atlas .earth-title { font-size: 1.25em; text-align: center; }
.atlas-stage { display: grid; gap: 1rem; grid-template-columns: minmax(0, 1fr); align-items: start; }
@media (min-width: 760px) and (min-aspect-ratio: 1/1) { .atlas-stage { grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); } .atlas-stage .atlas-side { position: sticky; top: 1rem; } }
.atlas-side { display: flex; flex-direction: column; gap: 0.8rem; min-width: 0; }
.atlas-map { margin: 0; border-radius: 1.1rem; overflow: hidden; background: radial-gradient(120% 90% at 30% 15%, #46aaf0 0%, #2272c4 50%, #134d8f 100%); position: relative; box-shadow: inset 0 0.1rem 0 rgba(255, 255, 255, 0.35), inset 0 -0.35rem 0.6rem rgba(5, 25, 60, 0.35), 0 0.5rem 1rem rgba(5, 20, 50, 0.28); }
.atlas-svg { display: block; width: 100%; }
.atlas-svg.big { height: min(30vh, 16em, 70vw); }
.atlas-land { stroke: #eaf6cf; stroke-opacity: 0.75; stroke-width: 3; } .atlas-light { pointer-events: none; } .atlas-shadow { fill: rgba(2, 20, 50, 0.55); } .atlas-context { fill: rgba(190, 215, 150, 0.42); stroke: rgba(235, 247, 215, 0.55); stroke-width: 3; } .atlas-riverhalo { stroke: #ffffff; stroke-opacity: 0.45; stroke-width: 13; } .atlas-river { stroke: #1f86ea; stroke-width: 7; } .atlas-glow { fill: none; stroke: #bfeaff; stroke-width: 16; stroke-opacity: 0.55; } .atlas-side { stroke: none; }
.atlas-dot { stroke: #7a100d; stroke-width: 4; } .atlas-ring { fill: none; stroke: #ff6a52; stroke-width: 7; opacity: 0.6; } .atlas-spec { fill: #fff; opacity: 0.75; } .atlas-pinshadow { fill: rgba(2, 20, 50, 0.5); }
.atlas-pin.pulse .atlas-ring { animation: atlas-pulse 1.4s ease-out infinite; transform-box: fill-box; transform-origin: center; }
.atlas-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); border: 0; }
.atlas-cap { display: flex; align-items: center; gap: 0.5rem; margin: 0.6rem 0.7rem 0; padding: 0.25rem 0.8rem; width: fit-content; max-width: calc(100% - 1.4rem); background: rgba(255, 255, 255, 0.92); color: #10243a; border-radius: 1.1em; font-weight: 700; font-size: 1.05em; box-shadow: 0 0.15rem 0.4rem rgba(5, 25, 60, 0.25); }
.atlas-flag { font-size: 1.35em; line-height: 1; flex: none; } .atlas-name { overflow-wrap: anywhere; }
.atlas-cards { display: grid; gap: 0.7rem; grid-template-columns: minmax(0, 1fr); }
.earth-btn.atlas-card { display: block; padding: 0.55rem; width: 100%; text-align: left; transition: transform 0.15s, opacity 0.2s, box-shadow 0.2s; }
.atlas-card-in { display: grid; grid-template-columns: minmax(0, min(5.5em, 32%)) minmax(0, 1fr); gap: 0.7rem; align-items: center; }
.atlas-card-in.nopic { grid-template-columns: minmax(0, 1fr); }
.atlas-card-pic { border-radius: 0.7rem; background: radial-gradient(120% 90% at 30% 15%, #46aaf0 0%, #2272c4 55%, #134d8f 100%); overflow: hidden; display: block; box-shadow: inset 0 0.08rem 0 rgba(255, 255, 255, 0.3), 0 0.15rem 0.35rem rgba(5, 25, 60, 0.25); }
.atlas-svg.mini { height: min(5.5em, 26vw); }
.atlas-card-txt { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
.atlas-card-name { font-size: 1.2em; font-weight: 700; }
.atlas-chips { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.atlas-chip { font-size: 0.8em; line-height: 1.25; padding: 0.15rem 0.55rem; border-radius: 999px; background: color-mix(in srgb, var(--accent) 16%, var(--card)); }
.atlas-card[data-state="wrong"] { opacity: 0.45; filter: grayscale(1); animation: atlas-shake 0.35s; }
.atlas-card[data-state="correct"] { border-color: #2e9d57; box-shadow: 0 0 0 0.2em color-mix(in srgb, #2e9d57 40%, transparent); animation: atlas-pop 0.4s; }
.atlas-card[data-state="other"] { opacity: 0.55; }
.earth-actions.atlas-next { position: sticky; bottom: 0.75rem; }
@keyframes atlas-pulse { from { transform: scale(0.6); opacity: 0.8; } to { transform: scale(1.7); opacity: 0; } }
@keyframes atlas-shake { 25% { transform: translateX(-0.35em); } 75% { transform: translateX(0.35em); } }
@keyframes atlas-pop { 40% { transform: scale(1.04); } }
@media (prefers-reduced-motion: reduce) { .atlas-pin.pulse .atlas-ring, .atlas-card { animation: none !important; transition: none; } }
`;
