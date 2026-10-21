// @ts-check
// The environment a template instance receives. Built by the engine on device and by the harness in tests.
// Everything here is deterministic and offline: time is injected, randomness is seeded, strings are a lookup.

import { createRng } from './rng.mjs';

/**
 * @param {{ seed?: string|number, now?: () => number, settings?: Partial<{textZoom:number, lowData:boolean, reducedMotion:boolean}>, strings?: Record<string,string>, log?: (m: string) => void }} [opts]
 */
export function createEnv(opts = {}) {
  const table = opts.strings || {};
  let fixedNow = Date.UTC(2026, 0, 1, 12, 0, 0); // tests default to a fixed instant; the engine passes the real clock
  return {
    rng: createRng(opts.seed ?? '1'),
    now: opts.now || (() => fixedNow),
    settings: { textZoom: 1, lowData: false, reducedMotion: false, ...(opts.settings || {}) },
    /** @param {string} key @param {string} fallback */
    strings: (key, fallback) => (key in table ? table[key] : fallback),
    log: opts.log || (() => {}),
  };
}
