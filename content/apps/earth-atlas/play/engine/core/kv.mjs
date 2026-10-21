// @ts-check
// The key-value storage adapter the shell provides (preferences / local storage), plus an in-memory one for tests and web previews.
// engine/core never touches a file system or a database: settings, receipts and pack-store state all go through this adapter.
//
// Adapter contract (every method may be async; values are strings):
//   get(key)          -> string | null
//   set(key, value)   -> void
//   remove(key)       -> void
// Readers here never throw: a failing adapter, broken JSON or a value that does not match its schema yields the caller's default.

import { validate } from './schema.mjs';

/**
 * @typedef {{ get(key: string): string | null | Promise<string | null>, set(key: string, value: string): void | Promise<void>,
 *   remove(key: string): void | Promise<void> }} KeyValueAdapter
 */

/** @param {{ [key: string]: string }} [initial] @returns {KeyValueAdapter & { dump(): { [key: string]: string } }} */
export function createMemoryKV(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    get: key => m.get(key) ?? null,
    set: (key, value) => { m.set(key, String(value)); },
    remove: key => { m.delete(key); },
    dump: () => Object.fromEntries(m),
  };
}

/**
 * Read a JSON value. Returns `{ value, source }` where source says why the default was used, if it was.
 * @template T
 * @param {KeyValueAdapter} kv @param {string} key @param {any} schema engine/core/schema.mjs subset (or null for no check) @param {T} fallback
 * @returns {Promise<{ value: T, source: 'stored'|'empty'|'corrupt'|'invalid'|'storage-error' }>}
 */
export async function readJson(kv, key, schema, fallback) {
  let raw;
  try { raw = await kv.get(key); } catch { return { value: fallback, source: 'storage-error' }; }
  if (raw === null || raw === undefined || raw === '') return { value: fallback, source: 'empty' };
  let value;
  try { value = JSON.parse(raw); } catch { return { value: fallback, source: 'corrupt' }; }
  try { if (schema && validate(schema, value).length) return { value: fallback, source: 'invalid' }; } catch { return { value: fallback, source: 'invalid' }; }
  return { value, source: 'stored' };
}

/** Write a JSON value. Resolves false (never throws) when the adapter fails. @param {KeyValueAdapter} kv @param {string} key @param {any} value */
export async function writeJson(kv, key, value) {
  try { await kv.set(key, JSON.stringify(value)); return true; } catch { return false; }
}
