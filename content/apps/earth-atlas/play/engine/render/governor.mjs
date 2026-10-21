// @ts-check
// Quality tiers and the frame-time governor. A tier is a set of numbers the renderers read; the governor watches the
// measured frame time and steps the tier down when frames are slow and back up when there is room. Pure: time is handed in.

export const TIER_NAMES = ['low', 'medium', 'high'];
/**
 * factor: a patch is refined while the camera is closer than this many patch widths; grid: intervals per patch side;
 * minSpacingM: finest grid spacing; builds: new patches per frame; buildMs: time allowed for them; scale and maxPixels: size of
 * the 3D picture relative to the canvas; vectorKm: how far lines are drawn in flight; columns: Canvas2D terrain columns;
 * labels: most place names shown at once.
 */
export const TIERS = {
  low: { factor: 1.15, grid: 16, minSpacingM: 30, builds: 2, buildMs: 3, scale: 0.6, maxPixels: 500000, vectorKm: 60, columns: 56, cells: 72, cellPx: 10, maxPatches: 260, noise: 2, clouds: 1, labels: 12 },
  medium: { factor: 1.5, grid: 24, minSpacingM: 15, builds: 2, buildMs: 4, scale: 0.8, maxPixels: 1100000, vectorKm: 120, columns: 80, cells: 104, cellPx: 8, maxPatches: 420, noise: 3, clouds: 2, labels: 32 },
  high: { factor: 2.0, grid: 32, minSpacingM: 8, builds: 3, buildMs: 5, scale: 1, maxPixels: 2600000, vectorKm: 200, columns: 112, cells: 144, cellPx: 6, maxPatches: 640, noise: 4, clouds: 4, labels: 64 },
};

/**
 * @param {{ quality?: string, targetMs?: number, downAfter?: number, upAfter?: number }} [o]
 *   quality 'low' | 'medium' | 'high' fixes the tier; 'auto' (default) starts at medium and adapts. targetMs: frame time to hold (33.3 = 30 frames a second).
 */
export function createGovernor(o = {}) {
  const fixed = TIER_NAMES.includes(/** @type {string} */ (o.quality)), target = o.targetMs || 1000 / 30, downAfter = o.downAfter || 40, upAfter = o.upAfter || 240;
  let level = fixed ? TIER_NAMES.indexOf(/** @type {string} */ (o.quality)) : 1, avg = 0, slow = 0, fast = 0, hold = 0, steps = 0, upNeed = upAfter, wentUp = false;
  return {
    get tier() { return TIER_NAMES[level]; },
    get params() { return TIERS[TIER_NAMES[level]]; },
    get auto() { return !fixed; },
    get averageMs() { return avg; },
    get steps() { return steps; },
    /**
     * Report one frame. Returns true when the tier changed.
     * @param {number} ms time from the start of one frame to the start of the next, or the time one frame took to draw, whichever is larger
     */
    frame(ms) {
      if (!(ms >= 0) || ms > 1000) return false;          // a pause or a tab in the background is not a slow frame
      avg = avg ? avg + (ms - avg) * 0.1 : ms;
      if (fixed) return false;
      if (hold > 0) { hold--; return false; }
      slow = avg > target * 1.2 ? slow + 1 : 0;
      fast = avg < target * 0.62 ? fast + 1 : 0;
      // a step up that had to be taken back makes the next one wait longer, so the tier does not swing
      if (slow >= downAfter && level > 0) { level--; slow = fast = 0; hold = 30; steps++; if (wentUp) upNeed = Math.min(upNeed * 3, 7200); wentUp = false; return true; }
      if (fast >= upNeed && level < 2) { level++; slow = fast = 0; hold = 90; steps++; avg = target * 0.8; wentUp = true; return true; }
      return false;
    },
  };
}
