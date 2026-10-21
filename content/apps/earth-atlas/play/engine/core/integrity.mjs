// @ts-check
// Content-hash integrity for packs and chunks. The stores sign and verify the packages they deliver; this module checks that what is
// installed still matches the catalog embedded in the app (truncated, damaged or mismatched files are refused, never played).
//
// Hashes (all 16 lower-case hex chars, FNV-1a 64-bit, the same values the factory writes into the catalog):
//   pack   h = hash of the bytes of manifest.json + data.json + theme.json + media.json (those present, in that order)
//   chunk  hash = XOR over its packs of fnv1a64("<packId>:<h>")            (order independent)
//   shard  hash = fnv1a64 of the shard text
// A different byte hash (for example SHA-256 from the platform) can be injected as `hashFn(parts)` wherever one is checked.

import { fnv1a64 } from './hash.mjs';

/** Files that make up a pack, in hashing order. The first two are required. */
export const PACK_FILES = ['manifest.json', 'data.json', 'theme.json', 'media.json'];
export const REQUIRED_PACK_FILES = ['manifest.json', 'data.json'];

/**
 * FNV-1a 64-bit over raw bytes, as 16 hex chars. Takes one byte array or a list of them (hashed as if concatenated, without copying).
 * Uses two 32-bit halves, so it stays fast on large files.
 * @param {Uint8Array | readonly Uint8Array[]} input
 */
export function fnv1a64Bytes(input) {
  const parts = input instanceof Uint8Array ? [input] : input;
  let hi = 0xcbf29ce4, lo = 0x84222325;
  for (const bytes of parts) {
    for (let i = 0; i < bytes.length; i++) {
      lo = (lo ^ bytes[i]) >>> 0;
      // multiply by the prime 2^40 + 0x1b3, modulo 2^64
      const m = lo * 0x1b3, nlo = m >>> 0;
      hi = (hi * 0x1b3 + (m - nlo) / 4294967296 + ((lo << 8) >>> 0)) >>> 0;
      lo = nlo;
    }
  }
  return hi.toString(16).padStart(8, '0') + lo.toString(16).padStart(8, '0');
}

/**
 * Hash of a pack from its files. @param {{ [file: string]: Uint8Array | null | undefined }} files keyed by PACK_FILES names
 * @param {(parts: Uint8Array[]) => string | Promise<string>} [hashFn]
 */
export function packContentHash(files, hashFn = fnv1a64Bytes) {
  return hashFn(/** @type {Uint8Array[]} */ (PACK_FILES.map(f => files[f]).filter(Boolean)));
}

/** Hash of a chunk from the catalog entries of its packs. @param {Iterable<{ id: string, h?: string }>} entries */
export function chunkContentHash(entries) {
  let x = 0n;
  for (const e of entries) x ^= BigInt('0x' + fnv1a64(e.id + ':' + e.h));
  return x.toString(16).padStart(16, '0');
}

/**
 * Check the files of one pack against the hash the catalog expects. Never throws.
 * @param {{ [file: string]: Uint8Array | null | undefined }} files
 * @param {string | undefined} expected
 * @param {(parts: Uint8Array[]) => string | Promise<string>} [hashFn]
 * @returns {Promise<{ ok: boolean, reason?: 'missing-file'|'no-hash'|'hash-mismatch', actual?: string, file?: string }>}
 */
export async function verifyPackFiles(files, expected, hashFn = fnv1a64Bytes) {
  for (const f of REQUIRED_PACK_FILES) if (!files[f]) return { ok: false, reason: 'missing-file', file: f };
  if (typeof expected !== 'string' || !expected) return { ok: false, reason: 'no-hash' };
  let actual;
  try { actual = await packContentHash(files, hashFn); } catch { return { ok: false, reason: 'hash-mismatch' }; }
  return actual === expected ? { ok: true, actual } : { ok: false, reason: 'hash-mismatch', actual };
}

/**
 * Check catalog shard text against the hash in the catalog index. @param {string} text @param {string | undefined} expected
 */
export const shardTextOk = (text, expected) => typeof expected === 'string' && fnv1a64(text) === expected;
