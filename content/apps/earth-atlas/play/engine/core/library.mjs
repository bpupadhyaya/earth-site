// @ts-check
// The library: one small object an app uses to browse and open content. It joins the pieces of engine/core:
//   catalog (catalog/catalog.mjs)  what exists, filtered to what this binary's templates can run
//   pack store (packstore.mjs)     what is on the device, integrity-checked
//   entitlements (entitlements.mjs) what this player may open
//
//   const lib = createLibrary({ index, readShard, store, templates, entitlements });
//     index         the embedded catalog index { version, chunks, shards: [{ domain, shard, n, hash }] }
//     readShard     (domain, shard) -> shard text | bytes | parsed entries | null   (from the binary or an install-time chunk)
//     templates     the templates built into this app (defineTemplate results)
//     entitlements  optional { check(entry) } (loadEntitlements result); without it only free packs open
//   await lib.browse(filter)        -> { items, next }    catalog.list with the compat filter applied; items carry `downloaded`, `locked`
//   await lib.search(query, filter) -> { items }          catalog.search (titles, tags, regions), then entries holding the query among their `k` names (packs' proper names)
//   await lib.open(entry)           -> { ok: true, pack, template, chunkId }
//                                    | { ok: false, state: 'incompatible' | 'locked' | 'not-downloaded' | 'rejected', reason, ... }
//   lib.compat                      -> { [templateId]: highest major version this app runs }
//   lib.problems()                  -> catalog shards that were dropped because they were unreadable or did not match their hash
// A shard that fails its hash is treated as empty: the rest of the catalog keeps working. Nothing here throws for bad content.

import { createCatalog, tokenize } from './catalog/catalog.mjs';
import { shardTextOk } from './integrity.mjs';
import { validate } from './schema.mjs';
import { MANIFEST_SCHEMA, compatible } from './pack.mjs';
import { dataProblems } from './template.mjs';

/** Highest major version per built-in template, the shape the catalog's `compat` filter takes. @param {Iterable<{ id: string, version: string }>} templates */
export function compatOf(templates) {
  /** @type {{ [id: string]: number }} */ const out = {};
  for (const t of templates) out[t.id] = Math.max(out[t.id] ?? 0, Number(String(t.version).split('.')[0]) || 0);
  return out;
}

/**
 * @param {{ index: any, readShard: (domain: string, shard: string) => any, store: any, templates: Iterable<any>,
 *   entitlements?: { check(entry: any): { allowed: boolean, via: string | null, reason?: string } }, maxCachedEntries?: number }} opts
 */
export function createLibrary(opts) {
  const templates = new Map([...opts.templates].map(t => [t.id, t]));
  const compat = compatOf(templates.values());
  const expected = new Map((opts.index?.shards || []).map(s => [s.domain + '/' + s.shard, s.hash]));
  /** @type {Map<string, string>} */ const dropped = new Map();
  const utf8 = new TextDecoder();

  async function loadShard(domain, shard) {
    const k = domain + '/' + shard;
    const fail = why => { dropped.set(k, why); return []; };
    let raw;
    try { raw = await opts.readShard(domain, shard); } catch { return fail('unreadable'); }
    if (raw === null || raw === undefined) return fail('missing');
    if (Array.isArray(raw)) { dropped.delete(k); return raw; } // already parsed: compiled into the binary
    let text;
    try { text = typeof raw === 'string' ? raw : utf8.decode(raw); } catch { return fail('unreadable'); }
    if (!shardTextOk(text, expected.get(k))) return fail('hash-mismatch');
    try { const list = JSON.parse(text); if (!Array.isArray(list)) return fail('corrupt'); dropped.delete(k); return list; } catch { return fail('corrupt'); }
  }

  const catalog = createCatalog({ index: { shards: opts.index?.shards || [] }, loadShard, maxCachedEntries: opts.maxCachedEntries });
  const allowed = entry => (opts.entitlements ? opts.entitlements.check(entry) : (entry?.e ?? 'free') === 'free' ? { allowed: true, via: 'free' } : { allowed: false, via: null, reason: 'locked' });
  const runs = entry => { const max = compat[entry?.tp]; return max !== undefined && (entry.tv ?? 1) <= max; };

  async function decorate(items) {
    const have = await opts.store.downloaded(items);
    return items.map((e, i) => ({ ...e, downloaded: have[i], locked: !allowed(e).allowed }));
  }

  /**
   * Entries whose keyword list `k` (proper names inside the pack, written by the catalog build) holds every word of the query as a whole
   * word or a prefix. They rank below every title, tag and region hit, so they are only added after those, in catalog order.
   */
  async function byKeyword(query, f, room, have) {
    const words = tokenize(query), out = [];
    if (!words.length) return out;
    let cursor = null;
    do {
      const page = await catalog.list({ ...f, compat, limit: 500, cursor });
      for (const e of page.items) {
        if (!e.k || have.has(e.id)) continue;
        const toks = tokenize(e.k);
        if (words.every((w, i) => toks.some(t => t === w || (i === words.length - 1 && t.startsWith(w))))) { out.push(e); if (out.length >= room) return out; }
      }
      cursor = page.next;
    } while (cursor);
    return out;
  }

  return {
    compat,
    catalog,
    /** @param {any} [f] */
    async browse(f = {}) { const r = await catalog.list({ ...f, compat }); return { items: await decorate(r.items), next: r.next }; },
    /** @param {string} query @param {any} [f] */
    async search(query, f = {}) {
      const r = await catalog.search(query, { ...f, compat }), limit = Math.max(1, Math.min(f.limit ?? 20, 200));
      let items = r.items;
      if (items.length < limit) items = items.concat(await byKeyword(query, f, limit - items.length, new Set(items.map(e => e.id))));
      return { items: await decorate(items) };
    },
    /** @param {any} entry a catalog entry */
    async open(entry) {
      if (!runs(entry)) return { ok: false, state: 'incompatible', reason: templates.has(entry?.tp) ? 'template-too-old' : 'unknown-template' };
      const ent = allowed(entry);
      if (!ent.allowed) return { ok: false, state: 'locked', reason: ent.reason || 'locked' };
      const r = await opts.store.openPack(entry);
      if (!r.ok) return r;
      const tpl = templates.get(entry.tp), m = r.pack.manifest;
      const reject = (reason, problems) => ({ ok: false, state: 'rejected', reason, problems, chunkId: r.chunkId });
      const mp = validate(MANIFEST_SCHEMA, m).map(e => `manifest.json ${e.path}: ${e.message}`);
      if (mp.length) return reject('invalid-manifest', mp.slice(0, 8));
      if (m.id !== entry.id || m.template !== tpl.id) return reject('catalog-mismatch', [`manifest is ${m.id} (${m.template}), catalog says ${entry.id} (${entry.tp})`]);
      if (!compatible(tpl.version, m.requires.template.replace(/^\^/, ''))) return { ok: false, state: 'incompatible', reason: 'template-too-old' };
      const dp = dataProblems(tpl, r.pack.data);
      if (dp.length) return reject('invalid-data', dp.slice(0, 8));
      return { ok: true, pack: r.pack, template: tpl, chunkId: r.chunkId, via: ent.via };
    },
    problems: () => [...dropped].map(([shard, reason]) => ({ shard, reason })),
  };
}
