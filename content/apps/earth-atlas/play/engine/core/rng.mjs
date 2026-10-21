// @ts-check
// Deterministic random numbers. Every template and generator takes its randomness from here, never from Math.random,
// so the same seed + the same actions always produce the same play (the determinism gate depends on it).

/** @param {string} str */
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
}
function sfc32(a, b, c, d) {
  return () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * @typedef {object} Rng
 * @property {() => number} next   float in [0,1)
 * @property {(n: number) => number} int   integer in [0,n)
 * @property {(lo: number, hi: number) => number} between   integer in [lo,hi]
 * @property {<T>(arr: readonly T[]) => T} pick
 * @property {<T>(arr: readonly T[]) => T[]} shuffle   new array
 * @property {<T>(arr: readonly T[], n: number) => T[]} sample   n distinct items, new array
 * @property {(label: string) => Rng} fork   independent child stream (stable per label)
 * @property {string} seed
 */

/** @param {string|number} seed @returns {Rng} */
export function createRng(seed) {
  const s = String(seed);
  const h = xmur3(s);
  const next = sfc32(h(), h(), h(), h());
  for (let i = 0; i < 12; i++) next();
  /** @type {Rng} */
  const rng = {
    seed: s,
    next,
    int: n => Math.floor(next() * n),
    between: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    shuffle: arr => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    sample: (arr, n) => rng.shuffle(arr).slice(0, n),
    fork: label => createRng(`${s}/${label}`),
  };
  return rng;
}
