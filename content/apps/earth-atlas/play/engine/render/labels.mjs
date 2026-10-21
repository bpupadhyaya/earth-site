// @ts-check
// Place-name labels: which labels are shown this frame and where each one sits next to its place. Pure: boxes in canvas pixels
// in, boxes out, no drawing, no text measuring by a canvas (the width of a text is estimated from its letters, the same way on
// every backend), no clock and no randomness, so the same input always gives the same picture.
//
// Greedy placement: labels are taken in the order of their priority (higher first, then the order they were given in). Each one
// tries a few positions around its symbol and takes the first where it lies wholly inside the canvas margin and touches no
// label placed before it, no symbol of another place and no reserved area. A label that fits nowhere is left out; its symbol
// is still drawn by the caller. Budget: 64 placed labels out of 288 candidates in well under half a millisecond.

/** Width of a letter as a fraction of the text size, for the system font; leaning to the wide side so that boxes are not too small. */
const NARROW = 0.32, LOWER = 0.56, DIGIT = 0.6, UPPER = 0.7, WIDE = 0.92, FULL = 1.04;
const NARROW_SET = " .,:;'!|ijlItfr()[]-/", WIDE_SET = 'mwMW@%';

/**
 * Estimated width in pixels of a text drawn at `px` pixels with the system font.
 * @param {string} str @param {number} px @param {boolean} [bold]
 */
export function textWidth(str, px, bold = false) {
  let w = 0;
  for (const ch of String(str)) {
    const c = /** @type {number} */ (ch.codePointAt(0));
    if (c >= 0x300 && c <= 0x36f) continue;                                    // combining marks sit on the letter before
    w += c >= 0x1100 && !(c >= 0x1e00 && c <= 0x2bff) ? FULL                 // East Asian and other wide scripts, pictographs
      : NARROW_SET.includes(ch) ? NARROW : WIDE_SET.includes(ch) ? WIDE
      : c >= 0x30 && c <= 0x39 ? DIGIT
      : ch !== ch.toLowerCase() ? UPPER : LOWER;
  }
  return w * px * (bold ? 1.07 : 1);
}

/**
 * @typedef {object} LabelItem
 * @property {number} x   the place on the canvas, pixels
 * @property {number} y
 * @property {number} w   size of the text box, pixels
 * @property {number} h
 * @property {number} [priority]   higher is placed first (default 0)
 * @property {number[]} [box]   the symbol of the place as [x0, y0, x1, y1]; the label sits around it and other labels keep off it. Default: the point
 * @property {number} [prefer]   index of the position to try first (see SIDES); default 0, below
 * @property {boolean} [centre]   a name without a symbol (a region): the place itself is tried first, then spots beside it and up to two lines above or below
 *
 * @typedef {{ i: number, x: number, y: number, x0: number, y0: number, x1: number, y1: number, side: number }} Placed
 *   i: index of the item; x, y: centre of the text box; side: index into SIDES, or -1 for the centre
 */

/** Positions around a symbol, in the order they are tried: [sideways, down] with -1 left or above, 0 centred, 1 right or below. */
export const SIDES = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const CELL = 96;

/**
 * @param {LabelItem[]} items
 * @param {{ w: number, h: number, max?: number, margin?: number, gap?: number, obstacles?: number[][] }} o
 *   w, h: canvas size. max: most labels shown (default 32). margin: distance kept from the canvas edge (default 4).
 *   gap: distance between a symbol and its label and between two labels (default 3). obstacles: reserved areas [x0, y0, x1, y1].
 * @returns {Placed[]} the labels shown, highest priority first
 */
export function placeLabels(items, o) {
  const W = o.w, H = o.h, max = Math.max(0, Math.floor(o.max ?? 32)), m = o.margin ?? 4, gap = o.gap ?? 3;
  /** @type {Placed[]} */ const out = [];
  if (!(W > 0 && H > 0) || !max || !items.length) return out;
  // a grid of buckets holds every box a label must keep off: [x0, y0, x1, y1, owner]
  const nx = Math.max(1, Math.ceil(W / CELL)), ny = Math.max(1, Math.ceil(H / CELL));
  /** @type {number[][][]} */ const grid = [];
  const cells = (x0, y0, x1, y1, fn) => {
    const a = Math.max(0, Math.floor(x0 / CELL)), b = Math.min(nx - 1, Math.floor(x1 / CELL)), c = Math.max(0, Math.floor(y0 / CELL)), d = Math.min(ny - 1, Math.floor(y1 / CELL));
    for (let j = c; j <= d; j++) for (let i = a; i <= b; i++) if (fn(j * nx + i)) return true;
    return false;
  };
  const add = (x0, y0, x1, y1, owner) => { const r = [x0, y0, x1, y1, owner]; cells(x0, y0, x1, y1, k => { (grid[k] || (grid[k] = [])).push(r); return false; }); };
  const hit = (x0, y0, x1, y1, self) => cells(x0, y0, x1, y1, k => { const g = grid[k]; if (g) for (const r of g) if (r[4] !== self && x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return true; return false; });
  for (const r of o.obstacles || []) if (r && r.length >= 4) add(r[0], r[1], r[2], r[3], -1);
  const ok = it => it && Number.isFinite(it.x) && Number.isFinite(it.y) && it.w > 0 && it.h > 0;
  const boxOf = it => (Array.isArray(it.box) && it.box.length >= 4 ? it.box : [it.x, it.y, it.x, it.y]);
  items.forEach((it, i) => { if (ok(it) && Array.isArray(it.box)) { const b = boxOf(it); add(b[0], b[1], b[2], b[3], i); } });
  const order = items.map((_, i) => i).filter(i => ok(items[i])).sort((a, b) => ((items[b].priority || 0) - (items[a].priority || 0)) || a - b);
  for (const i of order) {
    if (out.length >= max) break;
    const it = items[i], b = boxOf(it), first = Number.isInteger(it.prefer) ? Math.min(SIDES.length - 1, Math.max(0, /** @type {number} */ (it.prefer))) : 0;
    // a region name has room to move: after the place itself and the spots that touch it, spots up to two lines higher or lower
    const tries = it.centre ? 1 + SIDES.length * 4 : SIDES.length;
    for (let t = 0; t < tries; t++) {
      let cx = it.x, cy = it.y, side = -1;
      if (it.centre) {
        if (t > 0) {
          const s = SIDES[(t - 1) % SIDES.length], step = 1 + Math.floor((t - 1) / SIDES.length); side = (t - 1) % SIDES.length;
          if (step > 1 && s[1] === 0) continue;
          cx += s[0] * (it.w / 2 + gap); cy += s[1] * (it.h / 2 + gap) * step;
        }
      } else {
        // beside the symbol: the text box touches the symbol's box on the chosen side; the preferred side is tried first
        side = t === 0 ? first : t <= first ? t - 1 : t;
        const s = SIDES[side] || SIDES[0];
        cx = s[0] === 0 ? (b[0] + b[2]) / 2 : s[0] > 0 ? b[2] + gap + it.w / 2 : b[0] - gap - it.w / 2;
        cy = s[1] === 0 ? (b[1] + b[3]) / 2 : s[1] > 0 ? b[3] + gap + it.h / 2 : b[1] - gap - it.h / 2;
      }
      const x0 = cx - it.w / 2, y0 = cy - it.h / 2, x1 = x0 + it.w, y1 = y0 + it.h;
      if (x0 < m || y0 < m || x1 > W - m || y1 > H - m) continue;
      if (hit(x0 - gap / 2, y0 - gap / 2, x1 + gap / 2, y1 + gap / 2, it.centre ? -2 : i)) continue;
      add(x0 - gap / 2, y0 - gap / 2, x1 + gap / 2, y1 + gap / 2, -1);
      out.push({ i, x: cx, y: cy, x0, y0, x1, y1, side });
      break;
    }
  }
  return out;
}
