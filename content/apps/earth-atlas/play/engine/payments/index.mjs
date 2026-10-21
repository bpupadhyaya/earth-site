// @ts-check
// Payments: one-time unlock per game (owner decision 2026-10-20). Contract and bridge: engine/payments/README.md.
// Platform-free: the store is reached only through the shell bridge (`native.call('store.*')`), time is injected, nothing is trusted
// except receipts that come from native (the shell verifies them with the store). After a purchase, restore or refresh the receipts are
// written to the entitlement cache (`entitlements.setReceipts`), so a purchased game plays offline afterwards.
//
//   const pay = createPayments({ native, entitlements, app: { slug, monetization }, now });
//   await pay.refresh()                 prices (store.products) and owned receipts (store.owned); never throws
//   pay.product(entry)  -> { id, price, perGame: true } | null     (sync, from the cache; the store's price, else the configured price tier in USD)
//   await pay.purchase(productId)       -> { ok: true } | { ok: false, reason: 'cancelled'|'pending'|'failed'|'unavailable' }
//   await pay.restore()                 -> { ok: true } | { ok: false, reason }
//   pay.preview(entry)                  -> monetization.preview === true and the entry is for sale (false by default: a locked game never plays as a free preview);
//                                          engine/app wraps it so it is also false once the game's free time is used (engine/core/preview.mjs)
//   pay.previewMs                       the free preview length: monetization.previewSeconds (default 90) in ms
//   pay.subscribe(fn) -> off            fn() after the owned receipts changed outside the app ('store.updated')
// The UI hooks (engine/ui/app.mjs cfg.payments) are product / purchase / restore / preview.

import { readJson, writeJson } from '../core/kv.mjs';

export const PRICES_KEY = 'earth.store.prices.v1';
const REASONS = ['cancelled', 'pending', 'failed', 'unavailable'];

/** @param {{ native: any, entitlements: any, app: { slug: string, monetization?: any }, now?: () => number }} o */
export function createPayments(o) {
  const { native, entitlements } = o, app = o.app || /** @type {any} */ ({}), mon = app.monetization || {};
  const products = mon.products && typeof mon.products === 'object' ? mon.products : {};
  /** product id -> game id */
  const gameOf = new Map(Object.entries(products).map(([g, id]) => [String(id), g]));
  /** @type {Map<string, { id: string, price: string, priceMicros?: number, currency?: string, title?: string }>} */ const prices = new Map();
  /** @type {Set<Function>} */ const subs = new Set();
  const hasStore = typeof native?.call === 'function';
  const call = async (method, args) => { if (!hasStore) throw new Error('no store'); return native.call(method, args); };
  const failure = r => ({ ok: false, reason: REASONS.includes(r?.reason) ? r.reason : 'failed' });

  /** A native receipt as an entitlement record for exactly the game the product unlocks (null for a product this app does not sell). */
  const record = r => {
    const game = gameOf.get(String(r?.productId));
    if (!game) return null;
    const at = Number.isFinite(r.purchasedAt) ? Number(r.purchasedAt) : (o.now ? o.now() : 0);
    return { id: String(r.transactionId || r.productId), kind: 'unlock', app: app.slug, collections: [game], purchasedAt: at, ...(r.revoked ? { revoked: true } : {}) };
  };
  /** Merge store receipts into the cache (by id; a newer word about the same transaction wins). Never drops a record: a cold store
   * (empty list while it connects) must not lock a game the player paid for; refunds arrive as receipts with revoked: true. */
  const apply = async (receipts) => {
    const next = new Map(entitlements.receipts().map(r => [r.id, r]));
    for (const r of Array.isArray(receipts) ? receipts : []) { const rec = record(r); if (rec) next.set(rec.id, rec); }
    await entitlements.setReceipts([...next.values()]);
  };

  // until the store has answered (offline first start), the configured price tier in US dollars
  const tier = Number(mon.priceTier), fallback = Number.isFinite(tier) && tier > 0 ? '$' + tier.toFixed(2) : '';
  let loaded = false;
  const loadPrices = async () => {
    if (loaded || !native?.kv) return; loaded = true;
    const s = await readJson(native.kv, PRICES_KEY, { type: 'object' }, {});
    for (const [id, p] of Object.entries(s.value || {})) if (p && typeof p.price === 'string' && !prices.has(id)) prices.set(id, { id, ...p });
  };
  const api = {
    enabled: Object.keys(products).length > 0,
    hasStore,
    /** The product of the game an entry belongs to, with the store's price (cached; '' until the store has told it). */
    product(entry) {
      const game = entry?.gm || (Array.isArray(entry?.gl) ? entry.gl.find(g => products[g]) : undefined), id = game && products[game];
      if (!id) return null;
      return { id, price: prices.get(id)?.price || fallback, perGame: true };
    },
    preview: entry => mon.preview === true && (entry?.e ?? 'free') !== 'free',
    previewMs: Number.isFinite(Number(mon.previewSeconds)) && Number(mon.previewSeconds) > 0 ? Math.round(Number(mon.previewSeconds) * 1000) : 90 * 1000,
    /** Ask the store for prices and for what the device owns. Works with no store (nothing changes). Never throws. */
    async refresh() {
      await loadPrices();
      if (!hasStore) return false;
      const ids = [...gameOf.keys()];
      try {
        const list = await call('store.products', { ids });
        let any = false;
        for (const p of Array.isArray(list) ? list : []) if (p && gameOf.has(p.id) && typeof p.price === 'string' && p.price) { prices.set(p.id, { id: p.id, price: p.price, priceMicros: p.priceMicros, currency: p.currency, title: p.title }); any = true; }
        if (any && native.kv) await writeJson(native.kv, PRICES_KEY, Object.fromEntries([...prices].map(([id, p]) => [id, { price: p.price, priceMicros: p.priceMicros, currency: p.currency }])));
      } catch { /* offline or no store: the cached prices stay */ }
      try { const owned = await call('store.owned', {}); if (Array.isArray(owned)) await apply(owned); } catch { /* the cached receipts stay */ }
      return true;
    },
    async purchase(productId) {
      if (!hasStore || !gameOf.has(String(productId))) return { ok: false, reason: 'unavailable' };
      let r;
      try { r = await call('store.purchase', { id: productId }); } catch { return { ok: false, reason: 'unavailable' }; } // the bridge has no store
      if (!r || !r.ok || !r.receipt || r.receipt.productId !== productId) return failure(r);
      try { await apply([r.receipt]); } catch { return { ok: false, reason: 'failed' }; }
      return { ok: true };
    },
    async restore() {
      if (!hasStore) return { ok: false, reason: 'unavailable' };
      let r;
      try { r = await call('store.restore', {}); } catch { return { ok: false, reason: 'unavailable' }; }
      if (!r || !r.ok) return failure(r);
      try { await apply(r.receipts); } catch { return { ok: false, reason: 'failed' }; }
      return { ok: true };
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
  // a purchase that arrives outside the app (ask to buy, refund): ask the store what the device owns now
  if (typeof native?.on === 'function') native.on('store.updated', async () => {
    try { const owned = await call('store.owned', {}); if (Array.isArray(owned)) { await apply(owned); for (const f of subs) f(); } } catch { /* keep the cache */ }
  });
  return api;
}
