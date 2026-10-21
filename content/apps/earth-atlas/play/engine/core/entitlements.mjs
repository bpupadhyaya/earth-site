// @ts-check
// Entitlements: may this player open this pack? Decided offline from receipt records cached on the device.
// The payments module verifies purchases with the store when it can and hands the resulting records to `setReceipts`;
// this module never talks to a store or the network, and time is always injected.
//
// Pack tiers (manifest `entitlement`, catalog entry `e`):
//   free      always open
//   premium   open with an unlock receipt for this app (whole app, or limited to named collections) or with a pass
//   pass      open with a pass only
// Receipt record:
//   { id, kind: 'unlock' | 'pass', app?, collections?, purchasedAt, expiresAt?, revoked? }
//     app          app slug an unlock belongs to (a pass has none: it is valid in every app)
//     collections  chunk ids, domains or game ids (catalog `gm`, or one of `gl` for knowledge) an unlock is limited to (absent = the whole app).
//                  Per-game purchases (engine/payments): { kind: 'unlock', app, collections: [gameId] } opens exactly that game.
//     expiresAt    ms since epoch, or null / absent for a purchase that does not expire
// An expired receipt stays valid for `graceMs` so that a device that could not refresh while offline keeps working.
//
//   checkEntitlement(entry, receipts, { now, app, graceMs })  pure
//     -> { allowed, via: 'free' | 'owned' | 'pass' | null, reason?: 'locked' | 'expired' | 'revoked', expiresAt?, grace? }
//   const ent = await loadEntitlements({ kv, now, app, graceMs });
//   ent.check(entry) / ent.has(entry) / ent.receipts() / await ent.setReceipts(records) -> { accepted, rejected }

import { validate } from './schema.mjs';
import { readJson, writeJson } from './kv.mjs';

export const ENTITLEMENTS_KEY = 'earth.entitlements.v1';
export const DEFAULT_GRACE_MS = 72 * 60 * 60 * 1000;

export const RECEIPT_SCHEMA = {
  type: 'object', required: ['id', 'kind', 'purchasedAt'], additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['unlock', 'pass'] },
    app: { type: 'string', minLength: 1, maxLength: 80 },
    collections: { type: 'array', maxItems: 500, items: { type: 'string', minLength: 1 } },
    purchasedAt: { type: 'number', minimum: 0 },
    expiresAt: { type: ['number', 'null'] },
    revoked: { type: 'boolean' },
  },
};
const STORED_SCHEMA = { type: 'object', required: ['receipts'], properties: { receipts: { type: 'array' }, seen: { type: 'number' } } };

/** @typedef {{ id: string, kind: 'unlock'|'pass', app?: string, collections?: string[], purchasedAt: number, expiresAt?: number|null, revoked?: boolean }} Receipt */
/** @typedef {{ allowed: boolean, via: 'free'|'owned'|'pass'|null, reason?: 'locked'|'expired'|'revoked', expiresAt?: number|null, grace?: boolean }} EntitlementResult */

/** Keep only well-formed receipt records. @param {any} list @returns {{ accepted: Receipt[], rejected: number }} */
export function cleanReceipts(list) {
  const accepted = []; let rejected = 0; const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (validate(RECEIPT_SCHEMA, r).length || seen.has(r.id)) { rejected++; continue; }
    seen.add(r.id); accepted.push({ ...r });
  }
  return { accepted, rejected };
}

/**
 * Pure check. `entry` is a catalog entry ({ e, c, d }) or a pack manifest ({ entitlement, domain }).
 * @param {any} entry @param {readonly Receipt[]} receipts @param {{ now: number, app?: string, graceMs?: number }} opts
 * @returns {EntitlementResult}
 */
export function checkEntitlement(entry, receipts, opts) {
  const tier = entry?.e ?? entry?.entitlement ?? 'free';
  if (tier === 'free') return { allowed: true, via: 'free' };
  if (tier !== 'premium' && tier !== 'pass') return { allowed: false, via: null, reason: 'locked' };
  const grace = opts.graceMs ?? DEFAULT_GRACE_MS, now = opts.now;
  const scope = [entry?.c, entry?.d ?? entry?.domain, entry?.gm, ...(Array.isArray(entry?.gl) ? entry.gl : [])].filter(Boolean);
  /** @type {EntitlementResult | null} */ let best = null;
  /** @type {'expired'|'revoked'|null} */ let why = null;
  for (const r of receipts || []) {
    const covers = r.kind === 'pass' || (tier === 'premium' && r.kind === 'unlock' && r.app !== undefined && r.app === opts.app && (!r.collections || r.collections.some(c => scope.includes(c))));
    if (!covers) continue;
    if (r.revoked) { why = why || 'revoked'; continue; }
    const exp = r.expiresAt ?? null;
    if (exp !== null && now > exp + grace) { why = 'expired'; continue; }
    /** @type {EntitlementResult} */
    const hit = { allowed: true, via: r.kind === 'pass' ? 'pass' : 'owned', expiresAt: exp };
    if (exp !== null && now > exp) hit.grace = true;
    // prefer a receipt that is not in its grace period, then one that never expires, then the latest expiry
    const rank = h => (h.grace ? 0 : 1e15) + (h.expiresAt === null ? 9e15 : h.expiresAt);
    if (!best || rank(hit) > rank(best)) best = hit;
  }
  return best || { allowed: false, via: null, reason: why || 'locked' };
}

/**
 * Cached receipts over the shell's key-value adapter. Loading never fails: unreadable or malformed data means "no receipts".
 * The latest time ever seen is stored, so setting the device clock back does not revive an expired receipt.
 * @param {{ kv: import('./kv.mjs').KeyValueAdapter, now: () => number, app?: string, graceMs?: number, key?: string }} opts
 */
export async function loadEntitlements(opts) {
  if (typeof opts?.now !== 'function') throw new TypeError('loadEntitlements: opts.now (a clock function) is required');
  const key = opts.key || ENTITLEMENTS_KEY;
  const stored = await readJson(opts.kv, key, STORED_SCHEMA, { receipts: [], seen: 0 });
  let receipts = cleanReceipts(stored.value.receipts).accepted;
  let seen = Number.isFinite(stored.value.seen) ? Number(stored.value.seen) : 0;
  const clock = () => { const t = opts.now(); if (t > seen) seen = t; return seen; };
  const persist = () => writeJson(opts.kv, key, { receipts, seen });
  if (clock() !== stored.value.seen && receipts.length) await persist();
  return {
    source: stored.source,
    /** @param {any} entry @returns {EntitlementResult} */
    check: entry => checkEntitlement(entry, receipts, { now: clock(), app: opts.app, graceMs: opts.graceMs }),
    /** @param {any} entry */
    has: entry => checkEntitlement(entry, receipts, { now: clock(), app: opts.app, graceMs: opts.graceMs }).allowed,
    receipts: () => receipts.map(r => ({ ...r })),
    /** Replace the cached records (the payments module calls this after a purchase, restore or refresh). @param {any[]} records */
    async setReceipts(records) {
      const c = cleanReceipts(records);
      receipts = c.accepted; clock();
      const saved = await persist();
      return { accepted: c.accepted.length, rejected: c.rejected, saved };
    },
  };
}
