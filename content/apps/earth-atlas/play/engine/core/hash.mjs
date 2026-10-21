// @ts-check
// Canonical JSON + a fast non-cryptographic hash, usable on device and in Node.
// Use for determinism hashes and pack IDs. Content integrity over raw bytes (packs, chunks, catalog shards) is in integrity.mjs.

/** Stable JSON: object keys sorted, no whitespace. @param {any} v */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

/** FNV-1a 64-bit as 16 hex chars. @param {string} str */
export function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) { h ^= BigInt(str.charCodeAt(i)); h = (h * prime) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}

/** @param {any} v */
export const hashJson = v => fnv1a64(canonical(v));

/** Short id suffix (6 hex) derived from a canonical object. @param {any} v */
export const shortHash = v => hashJson(v).slice(0, 6);
