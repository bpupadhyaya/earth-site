// @ts-check
// Overlays: instruments, guidance cues, annunciations, instructor hints, markers and labels, turned from data into a flat
// display list of four operations in canvas pixels. Both renderers draw the same list, so an instrument looks the same on
// WebGL and on Canvas2D, and templates compose avionics from data without drawing anything themselves.
//   { op: 'clip', x, y, w, h } / { op: 'unclip' }
//   { op: 'fill', colour, pts }                       convex polygon, pts = x0, y0, x1, y1, ...
//   { op: 'line', colour, width, pts, closed }        polyline
//   { op: 'text', colour, x, y, size, text, align, bold, halo? }   halo: the dark copy drawn under a text so that it reads on any ground   align 0 left, 0.5 centre, 1 right; y is the middle of the line
import { RAD, clamp, num, rgba, destination, wrap180 } from './geo.mjs';
import { placeLabels, textWidth } from './labels.mjs';
import { cockpitOps } from './cockpit-frame.mjs';

const WHITE = 0xffffffff, SKY = 0x3d7fd0ff, EARTH = 0x8a5c2eff, MAGENTA = 0xff50ffff, GREEN = 0x38e070ff, AMBER = 0xffb428ff, RED = 0xff4040ff, CYAN = 0x50e0ffff, PANEL = 0x0c1016b8, YELLOW = 0xffd820ff, BLACK = 0x000000ff;
const LEVEL = { info: WHITE, advisory: CYAN, caution: AMBER, warning: RED };

/** @typedef {{ op: string, colour?: number, pts?: number[], width?: number, closed?: boolean, x?: number, y?: number, w?: number, h?: number, size?: number, text?: string, align?: number, bold?: boolean }} Op */

/**
 * Instruments written as fractions of a 16:10 canvas, regrouped as docks (sized in pixels) and banners, for a screen of any shape: items
 * with a `rect` are grouped by the edge they sit at (left, right, top, bottom) into one dock each, texts near the top centre become banner
 * rows, texts elsewhere join the nearest group. World-anchored items (arrow, box3d, dir) and docks are left as they are.
 * @param {any[]} items @returns {any[]}
 */
export function redock(items) {
  const keep = [], rects = [], texts = [], banners = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    if (it.type === 'dock' || it.type === 'banner' || it.type === 'arrow' || it.type === 'box3d' || it.type === 'dir' || it.type === 'cockpit') keep.push(it);
    else if (it.type === 'text') { const at = Array.isArray(it.at) ? it.at : [0.5, 0.12]; if (Math.abs(num(at[0], 0.5) - 0.5) <= 0.25 && num(at[1], 0.12) <= 0.36) banners.push(it); else texts.push(it); }
    else if (Array.isArray(it.rect) && it.rect.length === 4) rects.push(it);
    else keep.push(it);
  }
  if (!rects.length && !texts.length && !banners.length) return items;
  const out = [...keep];
  banners.sort((a, b) => num(a.at && a.at[1], 0) - num(b.at && b.at[1], 0)).forEach((t, row) => out.push({ type: 'banner', text: t.text, level: t.level, row: Math.min(row, 3) }));
  // wide things and texts low or high on the canvas belong to the bottom or top row, tall things to the edge they are nearest
  const region = (cx, cy, w = 0) => (w > 0.25 || cy > 0.8 || cy < 0.2 ? (cy > 0.5 ? 'bottom' : 'top') : cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : cy > 0.5 ? 'bottom' : 'top');
  /** @type {Record<string, { box: number[], items: any[] }>} */ const groups = {};
  const add = (key, box, item) => { const g = groups[key] || (groups[key] = { box: [Infinity, Infinity, -Infinity, -Infinity], items: [] }); g.box = [Math.min(g.box[0], box[0]), Math.min(g.box[1], box[1]), Math.max(g.box[2], box[0] + box[2]), Math.max(g.box[3], box[1] + box[3])]; g.items.push(item); };
  for (const it of rects) {
    const r = it.rect.map(v => num(v, 0)), box = it.type === 'bar' || it.type === 'vsi' ? [Math.max(0, r[0] - 0.1), Math.max(0, r[1] - 0.025), Math.min(1, r[2] + 0.2), r[3] + 0.05] : r;   // their labels sit outside the rectangle
    add(region(r[0] + r[2] / 2, r[1] + r[3] / 2, box[2]), box, it);
  }
  for (const it of texts) {
    const at = Array.isArray(it.at) ? it.at : [0.5, 0.12], x = num(at[0], 0.5), y = num(at[1], 0.12), sz = num(it.size, 0.045), w = Math.min(0.5, String(it.text).length * sz * 0.34), al = it.align === 'left' ? 0 : it.align === 'right' ? 1 : 0.5;
    add(region(x, y), [x - w * al, y - sz * 0.8, w, sz * 1.6], it);
  }
  let rows = banners.length;
  for (const [key, g] of Object.entries(groups)) {
    const [x0, y0, x1, y1] = g.box, bx = Math.max(0, x0 - 0.005), by = Math.max(0, y0 - 0.005), bw = Math.min(1, x1 + 0.005) - bx, bh = Math.min(1, y1 + 0.005) - by;
    if (!(bw > 0.01 && bh > 0.01)) continue;
    const items2 = g.items.map(it => {
      const c = { ...it };
      if (Array.isArray(it.rect)) c.rect = [(num(it.rect[0], 0) - bx) / bw, (num(it.rect[1], 0) - by) / bh, num(it.rect[2], 1) / bw, num(it.rect[3], 1) / bh];
      if (it.type === 'text') { const at = Array.isArray(it.at) ? it.at : [0.5, 0.12]; c.at = [(num(at[0], 0.5) - bx) / bw, (num(at[1], 0.12) - by) / bh]; c.size = num(it.size, 0.045) / bh; }
      return c;
    });
    out.push({ type: 'dock', anchor: key, aspect: bw * 1.6 / bh, maxW: Math.min(0.98, bw * 1.6), maxH: Math.min(0.7, bh * 1.25), cap: bh * 1.15, panel: key !== 'top', dy: key === 'top' ? 0.012 + rows * 0.078 : 0, items: items2 });
  }
  return out;
}

/**
 * @param {ReturnType<typeof import('./handle.mjs').normalise>} n @param {any} view from createView
 * @param {{ textScale?: number, elevation?: (lat: number, lon: number) => number, extra?: any[], maxLabels?: number, regions?: (id: string) => any, labelMemory?: Map<string, number> }} [o]
 *   maxLabels: most place names shown at once (a quality tier's number; default 32). regions: outlines by id, for the names of
 *   `highlight: [{ id, label }]`. labelMemory: a map the caller keeps between frames, so that a name stays on the side of its
 *   symbol it had before while that side is still free.
 *   layout: { l, t, r, b, ts } fractions of the canvas kept free of controls and the safe areas, where `dock` and `banner` items are placed
 *   (left, top, right, bottom; ts = the part of the width at both ends of the top row that the host's own buttons take).
 * @returns {Op[]}
 */
export function layoutOverlays(n, view, o = {}) {
  const W = view.w, H = view.h, V = Math.min(W, H), u = V / 100, ts = clamp(num(o.textScale, 1), 0.5, 3), lw = Math.max(1, u * 0.35);
  /** @type {Op[]} */
  const ops = [];
  let dockTs = 1;   // text zoom inside a dock of instruments: dial figures grow up to 1.25 times only (they sit on fixed dials)
  const fill = (colour, pts) => { ops.push({ op: 'fill', colour, pts }); };
  const line = (colour, pts, width = lw, closed = false) => { ops.push({ op: 'line', colour, width, pts, closed }); };
  /** maxW: the text is made smaller when it would be wider than this many pixels (an estimate: 0.58 of the size per letter). */
  const text = (colour, x, y, size, str, align = 0.5, bold = false, maxW = 0) => {
    if (str === '' || str == null) return;
    const s = String(str); let px = Math.max(7, size * ts * dockTs);
    if (maxW > 0 && s.length * px * 0.58 > maxW) px = Math.max(6, maxW / (s.length * 0.58));
    if (px >= 9) ops.push({ op: 'text', colour: 0x000000b0, x: x + Math.max(1, px * 0.06), y: y + Math.max(1, px * 0.06), size: px, text: s, align, bold, halo: true });   // a dark halo keeps it readable on any ground
    ops.push({ op: 'text', colour, x, y, size: px, text: s, align, bold });
  };
  const rect = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h];
  const clip = (x, y, w, h) => { ops.push({ op: 'clip', x, y, w, h }); };
  const unclip = () => { ops.push({ op: 'unclip' }); };
  const box = it => { const r = Array.isArray(it.rect) && it.rect.length === 4 ? it.rect : [0, 0, 1, 1]; return { x: num(r[0], 0) * W, y: num(r[1], 0) * H, w: Math.max(4, num(r[2], 1) * W), h: Math.max(4, num(r[3], 1) * H) }; };
  const col = (it, d) => rgba(it.color, d);
  // the free area of the canvas (what the host's controls and the safe areas leave) for `dock` and `banner`
  const LY = o.layout && typeof o.layout === 'object' ? o.layout : {};
  const free = { x: clamp(num(LY.l, 0), 0, 0.8) * W, y: clamp(num(LY.t, 0), 0, 0.8) * H, x1: W - clamp(num(LY.r, 0), 0, 0.8) * W, y1: H - clamp(num(LY.b, 0), 0, 0.8) * H };
  /** Rounded rectangle as a convex polygon. */
  const roundRect = (x, y, w, h, r) => { const p = []; r = Math.min(r, w / 2, h / 2); for (const [cx, cy, a0] of [[x + w - r, y + r, 0], [x + w - r, y + h - r, 90], [x + r, y + h - r, 180], [x + r, y + r, 270]]) for (let i = 0; i <= 5; i++) { const a = (a0 + i * 18) * RAD; p.push(cx + Math.sin(a) * r, cy - Math.cos(a) * r); } return p; };
  const P = { x: 0, y: 0, visible: false, depthM: 0 };
  const fmt = (v, digits = 0) => (Number.isFinite(v) ? v.toFixed(clamp(digits, 0, 3)) : '---');
  const arcPts = (cx, cy, r, a0, a1, steps = 24) => { const p = []; for (let i = 0; i <= steps; i++) { const a = (a0 + (a1 - a0) * i / steps) * RAD; p.push(cx + Math.sin(a) * r, cy - Math.cos(a) * r); } return p; };
  const bands = (it, draw) => { for (const b of Array.isArray(it.bands) ? it.bands : []) if (b && Number.isFinite(b.from) && Number.isFinite(b.to)) draw(b.from, b.to, rgba(b.color, GREEN)); };

  /** Boxes of the docks drawn so far (the cockpit panel starts above the highest of them). @type {number[][]} */
  const dockBoxes = [];
  const draw = {
    horizon(it) {
      const b = box(it), cx = b.x + b.w / 2, cy = b.y + b.h / 2, ppd = b.h / clamp(num(it.span, 50), 10, 180), roll = num(it.rollDeg, 0) * RAD, pitch = clamp(num(it.pitchDeg, 0), -90, 90);
      const cr = Math.cos(roll), sr = Math.sin(roll), big = (b.w + b.h) * 2, y0 = pitch * ppd;
      const at = (lx, ly) => [cx + lx * cr + ly * sr, cy - lx * sr + ly * cr], poly = pts => pts.flatMap(p => at(p[0], p[1]));
      clip(b.x, b.y, b.w, b.h);
      fill(SKY, poly([[-big, y0 - big], [big, y0 - big], [big, y0], [-big, y0]]));
      fill(EARTH, poly([[-big, y0], [big, y0], [big, y0 + big], [-big, y0 + big]]));
      line(WHITE, poly([[-big, y0], [big, y0]]), lw * 1.2);
      const reach = Math.hypot(b.w, b.h) / 2 / ppd + 5, first = Math.ceil((pitch - reach) / 5) * 5;
      for (let d = first; d <= pitch + reach; d += 5) {
        if (d === 0 || Math.abs(d) > 90) continue;
        const hw = (d % 10 === 0 ? 0.13 : 0.06) * b.w, y = y0 - d * ppd;
        line(WHITE, poly([[-hw, y], [hw, y]]), lw);
        if (d % 10 === 0) { const a = at(-hw - b.h * 0.05, y), c = at(hw + b.h * 0.05, y); text(WHITE, a[0], a[1], b.h * 0.05, Math.abs(d)); text(WHITE, c[0], c[1], b.h * 0.05, Math.abs(d)); }
      }
      // bank scale: turns with the horizon, the pointer at the top stays
      const rr = Math.min(b.w, b.h) * 0.44;
      for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const s = Math.sin(a * RAD), c = Math.cos(a * RAD), l = a % 30 === 0 ? 0.08 : 0.045; line(WHITE, [...at(s * rr, -c * rr), ...at(s * rr * (1 + l), -c * rr * (1 + l))], lw); }
      fill(YELLOW, [cx, cy - rr, cx - rr * 0.06, cy - rr * 0.88, cx + rr * 0.06, cy - rr * 0.88]);
      if (Number.isFinite(it.slip)) { const sx = clamp(it.slip, -1, 1) * rr * 0.2; fill(WHITE, rect(cx - rr * 0.06 + sx, cy - rr * 0.86, rr * 0.12, rr * 0.035)); }
      // own aircraft symbol and flight director bars
      const wing = b.w * 0.16, gap = b.w * 0.06;
      for (const sgn of [-1, 1]) line(YELLOW, [cx + sgn * (gap + wing), cy, cx + sgn * gap, cy, cx + sgn * gap, cy + b.h * 0.03], lw * 2);
      fill(YELLOW, rect(cx - lw * 1.5, cy - lw * 1.5, lw * 3, lw * 3));
      const fd = it.director;
      if (fd && typeof fd === 'object') {
        if (Number.isFinite(fd.pitchDeg)) { const y = cy - clamp(fd.pitchDeg - pitch, -15, 15) * ppd; line(MAGENTA, [cx - b.w * 0.2, y, cx + b.w * 0.2, y], lw * 2); }
        if (Number.isFinite(fd.rollDeg)) { const x = cx + clamp(fd.rollDeg - num(it.rollDeg, 0), -30, 30) / 30 * b.w * 0.2; line(MAGENTA, [x, cy - b.h * 0.2, x, cy + b.h * 0.2], lw * 2); }
      }
      unclip();
      line(WHITE, rect(b.x, b.y, b.w, b.h), lw, true);
    },
    tape(it) {
      const b = box(it), v = num(it.value, 0), span = Math.max(1e-6, num(it.span, 100)), major = Math.max(1e-6, num(it.major, span / 5)), minor = Math.max(major / 10, num(it.minor, major / 2)), ppu = b.h / span, cy = b.y + b.h / 2;
      const right = it.side === 'right', ex = right ? b.x : b.x + b.w, dir = right ? 1 : -1, fs = Math.min(b.w * 0.3, b.h * 0.06), yOf = x => cy - (x - v) * ppu;
      fill(PANEL, rect(b.x, b.y, b.w, b.h));
      clip(b.x, b.y, b.w, b.h);
      bands(it, (a, c, k) => fill(k, rect(ex + (right ? 0 : -b.w * 0.1), yOf(Math.max(a, c)), b.w * 0.1, Math.abs(c - a) * ppu)));
      for (let x = Math.ceil((v - span / 2) / minor) * minor, i = 0; x <= v + span / 2 && i < 200; x += minor, i++) {
        const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6, y = yOf(x);
        line(WHITE, [ex, y, ex + dir * b.w * (isMajor ? 0.22 : 0.12), y], lw);
        if (isMajor) text(WHITE, ex + dir * b.w * 0.28, y, fs, fmt(x, num(it.digits, 0)), right ? 0 : 1, false, b.w * 0.7);
      }
      if (Number.isFinite(it.bug)) { const y = clamp(yOf(it.bug), b.y, b.y + b.h); fill(MAGENTA, [ex, y, ex + dir * b.w * 0.14, y - b.h * 0.025, ex + dir * b.w * 0.14, y + b.h * 0.025]); }
      if (Number.isFinite(it.trend) && it.trend !== 0) line(MAGENTA, [ex + dir * lw * 2, cy, ex + dir * lw * 2, clamp(yOf(v + it.trend), b.y, b.y + b.h)], lw * 2);
      unclip();
      const rh = fs * 2.1;
      fill(BLACK, rect(b.x, cy - rh / 2, b.w, rh)); line(col(it, WHITE), rect(b.x, cy - rh / 2, b.w, rh), lw, true);
      text(col(it, WHITE), b.x + b.w / 2, cy, fs * 1.35, fmt(v, num(it.digits, 0)), 0.5, true, b.w * 0.94);
      if (it.label) { fill(BLACK, rect(b.x, b.y, b.w, fs * 1.5)); text(WHITE, b.x + b.w / 2, b.y + fs * 0.75, fs * 0.9, it.label, 0.5, false, b.w * 0.94); }
      if (it.unit) { fill(BLACK, rect(b.x, b.y + b.h - fs * 1.5, b.w, fs * 1.5)); text(WHITE, b.x + b.w / 2, b.y + b.h - fs * 0.75, fs * 0.9, it.unit, 0.5, false, b.w * 0.94); }
      line(WHITE, rect(b.x, b.y, b.w, b.h), lw, true);
    },
    heading(it) {
      const b = box(it), v = ((num(it.value, 0) % 360) + 360) % 360, span = clamp(num(it.span, 70), 10, 360), ppd = b.w / span, cx = b.x + b.w / 2, fs = Math.min(b.h * 0.34, b.w * 0.05);
      fill(PANEL, rect(b.x, b.y, b.w, b.h));
      clip(b.x, b.y, b.w, b.h);
      for (let d = Math.ceil((v - span / 2) / 5) * 5; d <= v + span / 2; d += 5) {
        const x = cx + (d - v) * ppd, m = ((d % 360) + 360) % 360, ten = m % 10 === 0;
        line(WHITE, [x, b.y + b.h, x, b.y + b.h * (ten ? 0.62 : 0.8)], lw);
        if (m % 30 === 0) text(WHITE, x, b.y + b.h * 0.36, fs, m === 0 ? 'N' : m === 90 ? 'E' : m === 180 ? 'S' : m === 270 ? 'W' : String(m / 10), 0.5, m % 90 === 0);
      }
      if (Number.isFinite(it.bug)) { const dx = ((((it.bug - v) % 360) + 540) % 360 - 180) * ppd, x = clamp(cx + dx, b.x, b.x + b.w); fill(MAGENTA, [x, b.y + b.h * 0.62, x - b.h * 0.14, b.y + b.h, x + b.h * 0.14, b.y + b.h]); }
      unclip();
      fill(YELLOW, [cx, b.y + b.h * 0.72, cx - b.h * 0.12, b.y + b.h, cx + b.h * 0.12, b.y + b.h]);
      line(WHITE, rect(b.x, b.y, b.w, b.h), lw, true);
      const rw = fs * 3.4 * Math.min(ts, 1.3);
      fill(BLACK, rect(cx - rw / 2, b.y, rw, b.h * 0.6)); line(col(it, WHITE), rect(cx - rw / 2, b.y, rw, b.h * 0.6), lw, true);
      text(col(it, WHITE), cx, b.y + b.h * 0.3, fs * 1.15, String(Math.round(v) % 360).padStart(3, '0') + (it.unit || '°'), 0.5, true, rw * 0.94);
    },
    vsi(it) {
      const b = box(it), max = Math.max(1e-6, num(it.max, 10)), v = num(it.value, 0), cy = b.y + b.h / 2, y = cy - clamp(v / max, -1, 1) * b.h / 2, fs = Math.min(b.w * 0.34, b.h * 0.06);
      fill(PANEL, rect(b.x, b.y, b.w, b.h));
      for (const f of [-1, -0.5, 0, 0.5, 1]) line(WHITE, [b.x, cy - f * b.h / 2, b.x + b.w * (f === 0 ? 0.5 : 0.3), cy - f * b.h / 2], lw);
      fill(col(it, v < 0 ? AMBER : GREEN), rect(b.x + b.w * 0.55, Math.min(y, cy), b.w * 0.3, Math.max(1, Math.abs(y - cy))));
      line(WHITE, rect(b.x, b.y, b.w, b.h), lw, true);
      text(WHITE, b.x + b.w / 2, b.y - fs * 0.8, fs, it.label); text(WHITE, b.x + b.w / 2, b.y + b.h + fs * 0.9, fs * 1.1, fmt(v, num(it.digits, 1)) + (it.unit ? ' ' + it.unit : ''), 0.5, true);
    },
    gauge(it) {
      const b = box(it), cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.min(b.w, b.h) * 0.46, min = num(it.min, 0), max = num(it.max, 100), v = num(it.value, 0), ang = x => -135 + 270 * clamp((x - min) / (max - min || 1), 0, 1), fs = r * 0.24;
      fill(PANEL, arcPts(cx, cy, r * 1.04, 0, 360, 40));
      line(WHITE, arcPts(cx, cy, r, -135, 135, 40), lw);
      bands(it, (a, c, k) => line(k, arcPts(cx, cy, r * 0.93, ang(a), ang(c), 16), lw * 3));
      const major = Math.max((max - min) / 20, num(it.major, (max - min) / 5));
      for (let x = min, i = 0; x <= max + 1e-9 && i < 40; x += major, i++) { const a = ang(x) * RAD; line(WHITE, [cx + Math.sin(a) * r, cy - Math.cos(a) * r, cx + Math.sin(a) * r * 0.84, cy - Math.cos(a) * r * 0.84], lw); }
      const a = ang(v) * RAD, s = Math.sin(a), c = Math.cos(a);
      fill(col(it, WHITE), [cx + s * r * 0.88, cy - c * r * 0.88, cx + c * r * 0.05, cy + s * r * 0.05, cx - c * r * 0.05, cy - s * r * 0.05]);
      text(WHITE, cx, cy - r * 0.38, fs * 0.9, it.label, 0.5, false, r * 1.3); text(col(it, WHITE), cx, cy + r * 0.5, fs * 1.2, fmt(v, num(it.digits, 0)), 0.5, true, r * 1.3); text(WHITE, cx, cy + r * 0.82, fs * 0.8, it.unit, 0.5, false, r);
    },
    bar(it) {
      const b = box(it), min = num(it.min, 0), max = num(it.max, 1), f = clamp((num(it.value, 0) - min) / (max - min || 1), 0, 1), tall = b.h > b.w, fs = Math.min(tall ? b.w * 0.5 : b.h * 0.6, u * 4);
      fill(PANEL, rect(b.x, b.y, b.w, b.h));
      bands(it, (a, c, k) => { const fa = clamp((Math.min(a, c) - min) / (max - min || 1), 0, 1), fc = clamp((Math.max(a, c) - min) / (max - min || 1), 0, 1); fill(k, tall ? rect(b.x, b.y + b.h * (1 - fc), b.w * 0.15, b.h * (fc - fa)) : rect(b.x + b.w * fa, b.y + b.h * 0.85, b.w * (fc - fa), b.h * 0.15)); });
      fill(col(it, GREEN), tall ? rect(b.x + b.w * 0.2, b.y + b.h * (1 - f), b.w * 0.6, b.h * f) : rect(b.x, b.y + b.h * 0.2, b.w * f, b.h * 0.6));
      line(WHITE, rect(b.x, b.y, b.w, b.h), lw, true);
      if (tall) { text(WHITE, b.x + b.w / 2, b.y - fs * 0.8, fs, it.label); text(WHITE, b.x + b.w / 2, b.y + b.h + fs * 0.9, fs, Number.isFinite(it.digits) ? fmt(num(it.value, 0), it.digits) + (it.unit ? ' ' + it.unit : '') : it.unit); }
      else { text(WHITE, b.x - fs * 0.4, b.y + b.h / 2, fs, it.label, 1); text(WHITE, b.x + b.w + fs * 0.4, b.y + b.h / 2, fs, Number.isFinite(it.digits) ? fmt(num(it.value, 0), it.digits) + (it.unit ? ' ' + it.unit : '') : it.unit, 0); }
    },
    deviation(it) {
      const b = box(it), d = Math.min(b.w, b.h) * 0.05, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      const diamond = (x, y) => fill(col(it, MAGENTA), [x, y - d, x + d * 0.7, y, x, y + d, x - d * 0.7, y]);
      if (Number.isFinite(it.lateral)) { const y = b.y + b.h - d * 1.5; for (const k of [-1, -0.5, 0.5, 1]) line(WHITE, arcPts(cx + k * b.w * 0.4, y, d * 0.3, 0, 360, 8), lw); line(WHITE, [cx, y - d, cx, y + d], lw); diamond(cx + clamp(it.lateral, -1.2, 1.2) * b.w * 0.4, y); }
      if (Number.isFinite(it.vertical)) { const x = b.x + b.w - d * 1.5; for (const k of [-1, -0.5, 0.5, 1]) line(WHITE, arcPts(x, cy + k * b.h * 0.4, d * 0.3, 0, 360, 8), lw); line(WHITE, [x - d, cy, x + d, cy], lw); diamond(x, cy - clamp(it.vertical, -1.2, 1.2) * b.h * 0.4); }
    },
    /**
     * A group of items in a box of its own: `items` are in the box's coordinates (fractions of it, texts and shapes sized by it), the box has the
     * given `aspect` (width / height) and sits at `anchor` ('bottom' default, 'bottom-left', 'bottom-right', 'top', 'left', 'right', 'center' (the last three centred vertically)) inside the free area, as large as
     * `maxW` (of the free width), `maxH` (of the free height) and `cap` (of the shorter canvas side) allow. Instruments keep their shape on any screen.
     */
    dock(it) {
      const fw = Math.max(1, free.x1 - free.x), fh = Math.max(1, free.y1 - free.y), m = u * 2.4;
      // `only`: 'wide' draws the dock on a landscape canvas only, 'tall' on a portrait one (a cluster that splits in two on a wide screen)
      if (it.only === 'wide' && W < H) return;
      if (it.only === 'tall' && W >= H) return;
      // a tall free area (a phone held upright) takes the arrangement named `alt`, when there is one
      const v = it.alt && typeof it.alt === 'object' && fw / fh < 1.1 ? { ...it, ...it.alt } : it, items = Array.isArray(v.items) ? v.items : [], asp = clamp(num(v.aspect, 1.5), 0.3, 6);
      // docks at the left and right edges share what the levers and rings leave: neither takes more than half of it
      const side = v.anchor === 'left' || v.anchor === 'right' ? Math.max(20, (fw - (clamp(num(LY.sl, 0), 0, 0.6) + clamp(num(LY.sr, 0), 0, 0.6)) * W - 4 * m) / 2) : Infinity;
      const bh = Math.max(8, Math.min(fh * clamp(num(v.maxH, 0.42), 0.05, 1), V * clamp(num(v.cap, 0.62), 0.05, 2), (fw - 2 * m) * clamp(num(v.maxW, 0.98), 0.1, 1) / asp, side / asp)), bw = bh * asp;
      const anchor = String(v.anchor || 'bottom'), left = anchor.endsWith('left'), right = anchor.endsWith('right'), top = anchor.startsWith('top');
      // docks on the left and right edges keep clear of the host's levers and rings (layout.sl, layout.sr) as well
      const sideL = anchor === 'left' ? clamp(num(LY.sl, 0), 0, 0.6) * W : 0, sideR = anchor === 'right' ? clamp(num(LY.sr, 0), 0, 0.6) * W : 0;
      const bx = left ? free.x + sideL + m : right ? free.x1 - sideR - m - bw : free.x + (fw - bw) / 2, by = (top ? free.y + m : anchor === 'left' || anchor === 'right' || anchor === 'center' ? free.y + (fh - bh) / 2 : free.y1 - m - bh) + num(v.dy, 0) * V;
      dockBoxes.push([bx, by, bx + bw, by + bh]);
      if (v.panel !== false) { const pad = u * 0.9; fill(0x0a0e14c0, roundRect(bx - pad, by - pad, bw + 2 * pad, bh + 2 * pad, u * 2.2)); line(0xffffff40, roundRect(bx - pad, by - pad, bw + 2 * pad, bh + 2 * pad, u * 2.2), lw, true); }
      for (const c of items) {
        if (!c || typeof c !== 'object' || typeof draw[c.type] !== 'function' || c.type === 'dock') continue;
        const k = { ...c };
        dockTs = c.type === 'shape' ? Math.min(ts, 1.25) / ts : 1;
        if (c.type === 'shape' && !Array.isArray(c.rect)) k.rect = [0, 0, 1, 1];
        if (Array.isArray(k.rect) && k.rect.length === 4) { const r = k.rect; k.rect = [(bx + num(r[0], 0) * bw) / W, (by + num(r[1], 0) * bh) / H, num(r[2], 1) * bw / W, num(r[3], 1) * bh / H]; }
        if (Array.isArray(c.at) && c.type === 'text') { k.at = [(bx + num(c.at[0], 0.5) * bw) / W, (by + num(c.at[1], 0.5) * bh) / H]; k.size = num(c.size, 0.04) * bh / V; }
        if (c.type === 'shape' && Array.isArray(c.texts)) { const rh = Array.isArray(c.rect) ? num(c.rect[3], 1) : 1; k.texts = c.texts.map(t => ({ ...t, size: num(t.size, 0.04) * rh * bh / V })); }
        try { draw[k.type](k); } catch { /* one broken item must not hide the rest */ }
      }
      dockTs = 1;
    },
    /** One line of coaching at the top centre in a translucent pill: `text`, `level`, `row` (0 first), `size` (of the shorter side). */
    banner(it) {
      const str = String(it.text ?? ''); if (!str) return;
      const side = clamp(num(LY.ts, 0.14), 0, 0.4), maxW = W * (1 - 2 * side), row = clamp(Math.round(num(it.row, 0)), 0, 3), k = LEVEL[it.level] || WHITE;
      let px = clamp(Math.max(10, clamp(num(it.size, 0.036), 0.02, 0.08) * V * ts), 10, 26 * ts);
      if (textWidth(str, px, true) + px * 1.6 > maxW) px = Math.max(8, px * maxW / (textWidth(str, px, true) + px * 1.6));
      const w = Math.min(maxW, textWidth(str, px, true) + px * 1.6), h = px * 1.9, cx = W / 2, y = free.y + u * 1.2 + row * (h + u) + h / 2;
      fill(0x0c1016d0, roundRect(cx - w / 2, y - h / 2, w, h, h / 2));
      if (it.level === 'caution' || it.level === 'warning') line(k, roundRect(cx - w / 2, y - h / 2, w, h, h / 2), lw, true);
      ops.push({ op: 'text', colour: k, x: cx, y, size: px, text: str, align: 0.5, bold: it.level === 'warning' || it.level === 'caution' });
    },
    text(it) {
      const at = Array.isArray(it.at) ? it.at : it.rect ? [it.rect[0] + it.rect[2] / 2, it.rect[1] + it.rect[3] / 2] : [0.5, 0.12], size = clamp(num(it.size, 0.045), 0.008, 0.2) * V, k = col(it, LEVEL[it.level] || WHITE);
      const al = it.align === 'left' ? 0 : it.align === 'right' ? 1 : 0.5, x = num(at[0], 0.5) * W, y = num(at[1], 0.1) * H, str = String(it.text ?? ''), wide = Math.min(W * 0.96, str.length * size * ts * 0.56 + size);
      if (it.level === 'caution' || it.level === 'warning') { const x0 = clamp(x - wide * al, 0, Math.max(0, W - wide)); fill(PANEL, rect(x0, y - size * ts * 0.75, wide, size * ts * 1.5)); line(k, rect(x0, y - size * ts * 0.75, wide, size * ts * 1.5), lw, true); }
      text(k, x, y, size, str, al, it.level === 'warning' || it.level === 'caution');
    },
    arrow(it) {
      let a = Array.isArray(it.from) ? [num(it.from[0], 0.5) * W, num(it.from[1], 0.5) * H] : null, b = Array.isArray(it.to) ? [num(it.to[0], 0.5) * W, num(it.to[1], 0.5) * H] : null;
      const k = col(it, CYAN), t = it.toward;
      if (t && Number.isFinite(t.lat) && Number.isFinite(t.lon)) {
        view.project(t.lat, t.lon, num(t.altM, o.elevation ? o.elevation(t.lat, t.lon) : 0), P);
        if (P.visible) { line(k, arcPts(P.x, P.y, u * 3, 0, 360, 20), lw * 1.5, true); text(k, P.x, P.y - u * 5.5, 0.035 * V, it.text); return; }
        // off the canvas: an arrow at the edge pointing the way to turn
        const d = view.direction(t.lat, t.lon, num(t.altM, 0));
        let dx = d[0], dy = -d[1];
        if (Math.hypot(dx, dy) < 1e-3) { dx = 1; dy = 0; }
        const s = 0.42 * Math.min(W / Math.max(Math.abs(dx), 1e-6), H / Math.max(Math.abs(dy), 1e-6));
        b = [W / 2 + dx * s, H / 2 + dy * s]; a = [W / 2 + dx * s * 0.72, H / 2 + dy * s * 0.72];
      }
      if (!a || !b) return;
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, hd = Math.min(l * 0.45, u * 4);
      line(k, [a[0], a[1], b[0] - ux * hd * 0.8, b[1] - uy * hd * 0.8], lw * 2.2);
      fill(k, [b[0], b[1], b[0] - ux * hd - uy * hd * 0.55, b[1] - uy * hd + ux * hd * 0.55, b[0] - ux * hd + uy * hd * 0.55, b[1] - uy * hd - ux * hd * 0.55]);
      text(k, a[0] - ux * u * 2, a[1] - uy * u * 2 - (Math.abs(uy) < 0.5 ? u * 3 : 0), 0.035 * V, it.text, Math.abs(ux) < 0.5 ? 0.5 : ux > 0 ? 1 : 0);
    },
    box3d(it) {
      const hd = num(it.headingDeg, 0), L = num(it.lengthM, 0), Wd = num(it.widthM, 0), ground = Number.isFinite(it.altM) ? it.altM : o.elevation ? o.elevation(it.lat, it.lon) : 0, pts = [];
      /** @type {number[][]} */ let corners;
      if (num(it.heightM, 0) > 0) { const a = destination(it.lat, it.lon, hd - 90, Wd / 2), b = destination(it.lat, it.lon, hd + 90, Wd / 2); corners = [[a[0], a[1], ground], [b[0], b[1], ground], [b[0], b[1], ground + it.heightM], [a[0], a[1], ground + it.heightM]]; }
      else { const half = Math.hypot(L, Wd) / 2, an = Math.atan2(Wd, L) / RAD; corners = [an, 180 - an, 180 + an, -an].map(x => { const p = destination(it.lat, it.lon, hd + x, half); return [p[0], p[1], ground]; }); }
      for (const c of corners) { view.project(c[0], c[1], c[2], P); if (!(P.depthM > 0) || !Number.isFinite(P.x)) return; pts.push(P.x, P.y); }
      line(col(it, GREEN), pts, lw * 1.6, true);
    },
    dir(it) {
      view.projectDir(num(it.headingDeg, 0), num(it.pitchDeg, 0), P);
      if (!P.visible) return;
      const r = u * 2.2, k = col(it, GREEN);
      if (it.shape === 'diamond') line(k, [P.x, P.y - r, P.x + r, P.y, P.x, P.y + r, P.x - r, P.y], lw * 1.5, true);
      else if (it.shape === 'cross') { line(k, [P.x - r, P.y, P.x + r, P.y], lw * 1.5); line(k, [P.x, P.y - r, P.x, P.y + r], lw * 1.5); }
      else if (it.shape === 'square') line(k, rect(P.x - r, P.y - r, 2 * r, 2 * r), lw * 1.5, true);
      else { line(k, arcPts(P.x, P.y, r * 0.7, 0, 360, 16), lw * 1.5, true); if (it.shape !== 'circle') { line(k, [P.x - r * 2, P.y, P.x - r * 0.7, P.y], lw * 1.5); line(k, [P.x + r * 0.7, P.y, P.x + r * 2, P.y], lw * 1.5); line(k, [P.x, P.y - r * 0.7, P.x, P.y - r * 1.5], lw * 1.5); } }
      text(k, P.x, P.y + r * 2.2, 0.03 * V, it.label);
    },
    shape(it) {
      const b = it.rect ? box(it) : { x: 0, y: 0, w: W, h: H }, px = p => [b.x + num(p[0], 0) * b.w, b.y + num(p[1], 0) * b.h];
      if (it.clip === true) clip(b.x, b.y, b.w, b.h);   // `clip`: nothing is drawn outside the item's box (a map page whose terrain runs past its edge)
      for (const l of Array.isArray(it.lines) ? it.lines : []) {
        if (!l || !Array.isArray(l.points)) continue;
        const pts = l.points.flatMap(px);
        if (l.fill !== undefined) fill(rgba(l.fill, WHITE), pts);
        if (l.fill === undefined || l.color !== undefined) line(rgba(l.color, col(it, WHITE)), pts, Math.max(1, num(l.width, 1) * lw), Boolean(l.closed));
      }
      for (const t of Array.isArray(it.texts) ? it.texts : []) if (t && Array.isArray(t.at)) { const p = px(t.at); text(rgba(t.color, col(it, WHITE)), p[0], p[1], clamp(num(t.size, 0.04), 0.004, 0.3) * V, t.text, t.align === 'left' ? 0 : t.align === 'right' ? 1 : 0.5); }
      if (it.clip === true) unclip();
    },
  };

  // things in the world that are drawn as flat symbols: markers, labels of traffic and rings
  /** Areas a place name keeps off: labels of traffic, rings and zones, and the prompt of a pending pick. */
  /** @type {number[][]} */ const taken = [];
  const label = (x, y, str, k) => { if (str) { text(k, x, y, 0.034 * V, str); const px = Math.max(6, 0.034 * V * ts), hw = textWidth(str, px) / 2; taken.push([x - hw, y - px * 0.65, x + hw, y + px * 0.65]); } };
  // place names (markers and highlighted regions) are collected first and placed together, so that they never cover each other
  /** @type {(import('./labels.mjs').LabelItem & { str: string, px: number, bold: boolean, key: string })[]} */ const names = [];
  const showNames = n.layers.labels !== false, memory = o.labelMemory;
  const name = (key, x, y, str, priority, box, prefer, bold) => {
    const s = String(str);
    let px = Math.max(6, (bold ? 0.036 : 0.034) * V * ts), tw = textWidth(s, px, bold);
    if (tw > W * 0.5) { px = Math.max(6, px * W * 0.5 / tw); tw = textWidth(s, px, bold); }      // a very long name is made smaller, never cut
    const kept = memory ? memory.get(key) : undefined;
    names.push({ x, y, w: tw + px * 0.5, h: px * 1.3, priority: num(priority, 0), box, prefer: kept !== undefined && kept >= 0 ? kept : prefer, centre: !box, str: s, px, bold, key });
  };
  n.objects.forEach((ob, obIndex) => {
    if (!Number.isFinite(ob.lat) || !Number.isFinite(ob.lon)) return;
    const k = rgba(ob.color, ob.type === 'traffic' ? AMBER : YELLOW);
    if (ob.type === 'marker') {
      view.project(ob.lat, ob.lon, num(ob.altM, o.elevation ? o.elevation(ob.lat, ob.lon) : 0), P);
      if (!P.visible) return;
      const r = u * 1.6, x = P.x, y = P.y;
      if (ob.icon === 'dot') fill(k, arcPts(x, y, r * 0.6, 0, 360, 12));
      else if (ob.icon === 'square') fill(k, rect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2));
      else if (ob.icon === 'triangle') fill(k, [x, y - r, x + r * 0.9, y + r * 0.6, x - r * 0.9, y + r * 0.6]);
      else if (ob.icon === 'cross') { line(k, [x - r, y - r, x + r, y + r], lw * 2); line(k, [x - r, y + r, x + r, y - r], lw * 2); }
      else if (ob.icon === 'ring') line(k, arcPts(x, y, r, 0, 360, 16), lw * 2, true);
      else { fill(k, [x, y, x - r * 0.7, y - r * 1.6, x + r * 0.7, y - r * 1.6]); fill(k, arcPts(x, y - r * 2, r * 0.85, 0, 360, 14)); fill(BLACK, arcPts(x, y - r * 2, r * 0.3, 0, 360, 8)); }
      const pin = !ob.icon || ob.icon === 'pin';
      if (ob.label && showNames) name(`o/${ob.id || obIndex}`, x, y, ob.label, ob.priority, pin ? [x - r * 0.85, y - r * 2.85, x + r * 0.85, y] : [x - r, y - r, x + r, y + r], pin ? 0 : 1, false);
    } else if (ob.label && (ob.type === 'traffic' || ob.type === 'ring' || ob.type === 'zone' || ob.type === 'thermal')) {
      view.project(ob.lat, ob.lon, num(ob.altM, num(ob.topM, o.elevation ? o.elevation(ob.lat, ob.lon) : 0)), P);
      if (!P.visible) return;
      if (ob.type === 'traffic') line(k, [P.x - u * 2, P.y - u * 2, P.x + u * 2, P.y - u * 2, P.x + u * 2, P.y + u * 2, P.x - u * 2, P.y + u * 2], lw, true);
      label(P.x, P.y - u * 4, ob.label, k);
    }
  });
  if (showNames) n.highlight.forEach((hl, i) => {
    if (!hl.label) return;
    const c = highlightCentre(hl, o.regions);
    if (!c) return;
    view.project(c[0], c[1], o.elevation && !view.map ? o.elevation(c[0], c[1]) : 0, P);
    if (P.visible) name(`h/${hl.id || i}`, P.x, P.y, hl.label, hl.priority, undefined, 0, true);
  });
  if (names.length) {
    if (n.pick && n.pick.prompt) { const px = Math.max(6, 0.04 * V * ts), hw = textWidth(String(n.pick.prompt), px, true) / 2; taken.push([W / 2 - hw, H * 0.06 - px * 0.65, W / 2 + hw, H * 0.06 + px * 0.65]); }
    if (memory && memory.size > 1024) memory.clear();
    for (const p of placeLabels(names, { w: W, h: H, max: o.maxLabels ?? 32, margin: Math.max(2, u * 0.6), gap: Math.max(2, u * 0.5), obstacles: taken })) {
      const it = names[p.i];
      ops.push({ op: 'text', colour: 0x000000b0, x: p.x + Math.max(1, it.px * 0.06), y: p.y + Math.max(1, it.px * 0.06), size: it.px, text: it.str, align: 0.5, bold: it.bold, halo: true });
      ops.push({ op: 'text', colour: WHITE, x: p.x, y: p.y, size: it.px, text: it.str, align: 0.5, bold: it.bold });
      if (memory) memory.set(it.key, p.side);
    }
  }
  const list = [...n.overlays, ...(o.extra || [])];
  /** @type {any} */ let cockpit = null;
  for (const it of LY.redock === true && n.mode === 'flight' ? redock(list) : list) {
    if (it && typeof it === 'object' && it.type === 'cockpit') { cockpit = it; continue; }   // drawn around the rest, below
    if (it && typeof it === 'object' && typeof draw[it.type] === 'function') { try { draw[it.type](it); } catch { /* one broken item must not hide the rest */ } }
  }
  if (cockpit) {
    // the frame goes under everything (names and instruments sit on it); the controls over the instruments. The panel starts above the
    // highest dock, and the column stands in the free span between the two lowest docks.
    const low = dockBoxes.filter(b => b[3] > H * 0.8), top = low.length ? Math.min(...low.map(b => b[1])) - u * 1.6 : H * 0.7;   // the instrument clusters at the bottom, not a cue floating higher up
    const lows = dockBoxes.filter(b => b[3] > H * 0.6).sort((a, b) => a[0] - b[0]);
    let gap;
    for (let i = 0; i + 1 < lows.length; i++) if (lows[i + 1][0] - lows[i][2] > u * 6) { gap = [lows[i][2], lows[i + 1][0]]; break; }
    try { const c = cockpitOps(cockpit, { W, H, dashTop: top, gap, floor: low.length ? Math.max(...low.map(b => b[3])) : H }); ops.splice(0, 0, ...c.under); ops.push(...c.over); } catch { /* the cockpit must not hide the instruments */ }
  }
  // a pending pick: the prompt and, when a cursor position is given, a crosshair
  if (n.pick) {
    text(WHITE, W / 2, H * 0.06, 0.04 * V, n.pick.prompt, 0.5, true);
    const c = n.pick.cursor;
    if (Array.isArray(c)) { const x = num(c[0], 0.5) * W, y = num(c[1], 0.5) * H, r = u * 3; for (const [k, wd] of [[BLACK, lw * 3], [WHITE, lw * 1.5]]) { line(k, [x - r * 1.6, y, x - r * 0.4, y], wd); line(k, [x + r * 0.4, y, x + r * 1.6, y], wd); line(k, [x, y - r * 1.6, x, y - r * 0.4], wd); line(k, [x, y + r * 0.4, x, y + r * 1.6], wd); } }
  }
  return ops;
}

/** Where the name of a highlighted region goes: the middle of its circle or box, or of the box around its (largest) outline. */
const ringCentres = new WeakMap();
function highlightCentre(hl, regions) {
  if (hl.circle && Number.isFinite(hl.circle.lat) && Number.isFinite(hl.circle.lon)) return [hl.circle.lat, hl.circle.lon];
  if (hl.box) { const b = hl.box, e = b.east < b.west ? b.east + 360 : b.east; return [(b.south + b.north) / 2, wrap180((b.west + e) / 2)]; }
  /** @type {any} */ let ring = null;
  if (Array.isArray(hl.ring)) ring = hl.ring;
  else if (hl.id && regions) { const g = regions(hl.id); for (const r of (g && g.rings) || []) if (!ring || r.length > ring.length) ring = r; }
  if (!ring || !ring.length) return null;
  let c = ringCentres.get(ring);
  if (!c) {
    const flat = typeof ring[0] === 'number', count = flat ? ring.length >> 1 : ring.length, at = i => (flat ? [ring[2 * i], ring[2 * i + 1]] : ring[i]);
    let south = 90, north = -90, west = 0, east = 0; const ref = at(0)[1];
    for (let i = 0; i < count; i++) { const p = at(i), d = wrap180(p[1] - ref); south = Math.min(south, p[0]); north = Math.max(north, p[0]); west = Math.min(west, d); east = Math.max(east, d); }
    c = [(south + north) / 2, wrap180(ref + (west + east) / 2)];
    ringCentres.set(ring, c);
  }
  return Number.isFinite(c[0]) && Number.isFinite(c[1]) ? c : null;
}

/** Text of every overlay a player can read, for accessibility labels and tests. @param {Op[]} ops */
export const overlayText = ops => ops.filter(o => o.op === 'text' && !o.halo).map(o => o.text);
