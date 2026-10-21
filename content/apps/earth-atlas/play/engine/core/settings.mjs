// @ts-check
// Player settings, persisted through the shell's key-value adapter (engine/core/kv.mjs).
//   textZoom       1..3 (100%..300%)
//   lowData        never download optional media
//   reducedMotion  no decorative animation
//   handed         'right' | 'left': which side the flight stick is on (absent means right; stored only once chosen)
// Loading never fails: missing, broken or out-of-range stored data falls back field by field to safe defaults.
//
//   const settings = await loadSettings({ kv });
//   settings.get()                      -> frozen { textZoom, lowData, reducedMotion, handed }   (pass to createEnv({ settings: ... }))
//   await settings.set({ textZoom: 2 }) -> the new settings (invalid fields in the patch are ignored)
//   await settings.reset()
//   settings.subscribe(cb)              -> unsubscribe   cb(settings) after every change
//   settings.source                     -> 'stored' | 'empty' | 'corrupt' | 'invalid' | 'storage-error' (how the first read went)

import { readJson, writeJson } from './kv.mjs';
import { validate } from './schema.mjs';

export const SETTINGS_KEY = 'earth.settings.v1';
export const TEXT_ZOOM_MIN = 1, TEXT_ZOOM_MAX = 3;
export const DEFAULT_SETTINGS = Object.freeze({ textZoom: 1, lowData: false, reducedMotion: false });

export const SETTINGS_SCHEMA = {
  type: 'object', required: ['textZoom', 'lowData', 'reducedMotion'], additionalProperties: false,
  properties: {
    v: { type: 'integer', const: 1 },
    textZoom: { type: 'number', minimum: TEXT_ZOOM_MIN, maximum: TEXT_ZOOM_MAX },
    lowData: { type: 'boolean' },
    reducedMotion: { type: 'boolean' },
    handed: { type: 'string', enum: ['right', 'left'] },
  },
};

/** @typedef {{ textZoom: number, lowData: boolean, reducedMotion: boolean, handed?: 'right'|'left' }} Settings */

/**
 * Any value in, valid settings out. Unknown fields are dropped, a zoom outside 1..3 is clamped, anything of the wrong type takes `base`.
 * @param {any} raw @param {Settings} [base] @returns {Readonly<Settings>}
 */
export function sanitizeSettings(raw, base = DEFAULT_SETTINGS) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const zoom = typeof r.textZoom === 'number' && Number.isFinite(r.textZoom) ? Math.min(TEXT_ZOOM_MAX, Math.max(TEXT_ZOOM_MIN, Math.round(r.textZoom * 100) / 100)) : base.textZoom;
  const handed = r.handed === 'left' || r.handed === 'right' ? r.handed : base.handed;
  return Object.freeze({
    textZoom: zoom,
    lowData: typeof r.lowData === 'boolean' ? r.lowData : base.lowData,
    reducedMotion: typeof r.reducedMotion === 'boolean' ? r.reducedMotion : base.reducedMotion,
    ...(handed ? { handed } : {}),
  });
}

/** @param {{ kv: import('./kv.mjs').KeyValueAdapter, key?: string }} opts */
export async function loadSettings(opts) {
  const key = opts.key || SETTINGS_KEY;
  const first = await readJson(opts.kv, key, null, null);
  let current = sanitizeSettings(first.value);
  // a stored value that fails the schema is still salvaged field by field; `source` records that it was not clean
  const source = first.source === 'stored' && validate(SETTINGS_SCHEMA, first.value).length ? 'invalid' : first.source;
  /** @type {Set<(s: Readonly<Settings>) => void>} */
  const subs = new Set();
  const commit = async next => {
    current = next;
    const saved = await writeJson(opts.kv, key, { v: 1, ...current });
    for (const cb of [...subs]) { try { cb(current); } catch { /* a listener must not break settings */ } }
    return saved;
  };
  return {
    source,
    get: () => current,
    /** @param {Partial<Settings>} patch */
    async set(patch) { await commit(sanitizeSettings(patch, current)); return current; },
    async reset() { await commit(DEFAULT_SETTINGS); return current; },
    /** @param {(s: Readonly<Settings>) => void} cb */
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}
