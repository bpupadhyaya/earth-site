// @ts-check
// Chunk-aware pack store. Content reaches the device as store asset-pack chunks (many packs per chunk). The shell implements the
// asset-pack adapter (contract: engine/net/assetpacks.mjs); the app wraps it with `createAssetPacks(adapter, ...)` and hands the result
// in here as `assets`. This module adds what the catalog knows: which chunks exist, which are install-time starters, how big they are,
// and what every pack inside must hash to. It never throws for missing or damaged content: every answer is a plain result object.
//
//   const store = createPackStore({ index, assets, kv, budgetBytes });
//     index        the embedded catalog index: { chunks: [{ id, domain, delivery: 'install-time'|'on-demand', bytes, n, hash }] }
//     assets       { request(id), status(id), watch(id, cb), readFile(id, path), installed(), remove(id), cancel(id) }
//     kv           key-value adapter (engine/core/kv.mjs) for pins, recency and the budget; in-memory when omitted
//     budgetBytes  storage budget for on-demand chunks (default: unlimited). Starter chunks are part of the install and do not count.
//     pathOf       (packId, file) -> path inside the chunk (default "<packId>/<file>")
//     hashFn       byte hash override (default FNV-1a 64, the hash the catalog carries)
//
//   await store.status(chunkId)   -> ChunkView { id, known, state, downloaded, reason?, bytesDownloaded, bytesTotal, progress, pinned, starter, damaged }
//                                    reason when not downloaded: unknown-chunk | not-requested | in-progress | failed | storage-error
//   await store.chunks()          -> ChunkView[] for every chunk of the catalog (bounded by the stores' asset-pack limit)
//   await store.request(chunkId, { onProgress })  -> { accepted, reason?, evicted: string[], status }
//                                    reason: ready | already | offline | low-data | metered | no-space | unknown-chunk | storage-error
//                                    makes room first by evicting least recently used chunks; onProgress(ChunkView) until settled
//   await store.whenSettled(chunkId) -> ChunkView once the chunk is ready, failed or absent again
//   await store.pin(chunkId) / store.unpin(chunkId)   pinned chunks are never evicted
//   await store.evict(chunkId)    -> { ok, reason?: unknown-chunk | starter | pinned | not-downloaded | storage-error, freedBytes? }
//   await store.setBudget(bytes) / store.enforceBudget() -> { evicted, usedBytes, budgetBytes, overBy }
//   await store.usage()           -> { budgetBytes, usedBytes, starterBytes, pinnedBytes, evictableBytes }
//   await store.openPack(entry)   -> { ok: true, pack: { manifest, data, theme, media }, chunkId, hash }
//                                  | { ok: false, state: 'not-downloaded' | 'rejected', reason, chunkId, status }
//                                    entry = catalog entry { id, c: chunkId, h: contentHash }; rejected reasons: missing-file | no-hash |
//                                    hash-mismatch | corrupt | storage-error
//   await store.verifyChunk(chunkId, entries) -> { ok, reason?, checked, bad: string[] }   every pack of a chunk against the catalog
//   await store.repair(chunkId)   -> remove a damaged chunk and request it again
//   await store.downloaded(entries) -> boolean[]   which catalog entries can be opened now (one adapter call)
// Eviction order: least recently opened first; never a starter chunk, a pinned chunk or a chunk that is still downloading.

import { readJson, writeJson, createMemoryKV } from './kv.mjs';
import { fnv1a64Bytes, verifyPackFiles, chunkContentHash, PACK_FILES } from './integrity.mjs';

export const PACKSTORE_KEY = 'earth.packstore.v1';

const STATE_SCHEMA = {
  type: 'object', required: ['seq', 'used', 'pins'], additionalProperties: false,
  properties: {
    seq: { type: 'integer', minimum: 0 }, used: { type: 'object', additionalProperties: { type: 'integer', minimum: 0 } },
    pins: { type: 'array', items: { type: 'string' } }, damaged: { type: 'array', items: { type: 'string' } }, budget: { type: ['number', 'null'], minimum: 0 },
  },
};

/**
 * @typedef {{ id: string, domain?: string, group?: string, delivery?: string, bytes?: number, n?: number, hash?: string }} ChunkInfo
 * @typedef {{ id: string, known: boolean, state: string, downloaded: boolean, reason?: string, error?: string, bytesDownloaded: number, bytesTotal: number,
 *   progress: number, pinned: boolean, starter: boolean, damaged: boolean }} ChunkView
 * @typedef {{ id: string, c?: string, h?: string }} PackRef
 */

const ABSENT = { state: 'absent', bytesDownloaded: 0, bytesTotal: 0 };
const BUSY = ['queued', 'downloading', 'paused'];
const utf8 = new TextDecoder();

/**
 * @param {{ index: { chunks?: ChunkInfo[] }, assets: any, kv?: import('./kv.mjs').KeyValueAdapter, budgetBytes?: number, stateKey?: string,
 *   pathOf?: (packId: string, file: string) => string, hashFn?: (parts: Uint8Array[]) => string | Promise<string> }} opts
 */
export function createPackStore(opts) {
  const assets = opts.assets;
  const kv = opts.kv || createMemoryKV();
  const key = opts.stateKey || PACKSTORE_KEY;
  const hashFn = opts.hashFn || fnv1a64Bytes;
  const pathOf = opts.pathOf || ((packId, file) => `${packId}/${file}`);
  /** @type {Map<string, ChunkInfo>} */
  const byId = new Map((opts.index?.chunks || []).map(c => [c.id, c]));
  const isStarter = c => c?.delivery === 'install-time';
  const sizeOf = id => byId.get(id)?.bytes || 0;

  /** @type {{ seq: number, used: { [id: string]: number }, pins: string[], damaged: string[], budget: number | null } | null} */
  let state = null;
  /** @type {Set<string>} chunks this session asked for that have not settled yet */
  const inflight = new Set();
  let chain = Promise.resolve();
  /** Run state-changing work one at a time. @template T @param {() => Promise<T>} fn @returns {Promise<T>} */
  const locked = fn => { const p = chain.then(fn); chain = p.then(() => {}, () => {}); return p; };

  async function load() {
    if (state) return state;
    const r = await readJson(kv, key, STATE_SCHEMA, null);
    const v = /** @type {any} */ (r.value) || { seq: 0, used: {}, pins: [] };
    state = { seq: v.seq, used: { ...v.used }, pins: v.pins.filter(id => byId.has(id)), damaged: (v.damaged || []).filter(id => byId.has(id)), budget: v.budget ?? null };
    return state;
  }
  const save = () => writeJson(kv, key, state);
  const budgetOf = s => s.budget ?? opts.budgetBytes ?? Infinity;

  /** Adapter calls never escape as exceptions. */
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
  const rawStatus = id => safe(async () => (await assets.status(id)) || ABSENT, null);
  const installedIds = async () => { const l = await safe(() => assets.installed(), []); return Array.isArray(l) ? l : []; };

  /** @returns {ChunkView} */
  function view(id, raw, s) {
    const c = byId.get(id), st = raw || ABSENT;
    const total = c?.bytes || st.bytesTotal || 0, got = st.state === 'ready' ? total : Math.min(st.bytesDownloaded || 0, total || Infinity);
    /** @type {ChunkView} */
    const v = { id, known: Boolean(c), state: c ? st.state : 'unknown', downloaded: Boolean(c) && st.state === 'ready', bytesDownloaded: got, bytesTotal: total,
      progress: st.state === 'ready' ? 1 : total ? got / total : 0, pinned: s.pins.includes(id), starter: isStarter(c), damaged: s.damaged.includes(id) };
    if (!c) v.reason = 'unknown-chunk';
    else if (!raw) { v.reason = 'storage-error'; v.state = 'absent'; }
    else if (st.state === 'absent') v.reason = 'not-requested';
    else if (BUSY.includes(st.state)) v.reason = 'in-progress';
    else if (st.state !== 'ready') { v.reason = 'failed'; if (st.error) v.error = String(st.error); }
    return v;
  }

  /** @param {string} chunkId @returns {Promise<ChunkView>} */
  async function status(chunkId) {
    const s = await load();
    return view(chunkId, byId.has(chunkId) ? await rawStatus(chunkId) : null, s);
  }

  /** Bytes held by on-demand chunks that are installed or on their way. */
  async function usedNow() {
    const ids = new Set([...(await installedIds()).filter(id => byId.has(id)), ...inflight]);
    let used = 0; for (const id of ids) if (!isStarter(byId.get(id))) used += sizeOf(id);
    return { used, installed: ids };
  }

  /** Which chunks to evict so that `need` more bytes fit. Plans only; nothing is removed here. */
  async function plan(need, keepId) {
    const s = await load(), { used, installed } = await usedNow();
    let over = used + need - budgetOf(s);
    const pick = [];
    if (over > 0) {
      const cands = [...installed].filter(id => id !== keepId && !inflight.has(id) && !isStarter(byId.get(id)) && !s.pins.includes(id) && sizeOf(id) > 0)
        .sort((a, b) => (s.used[a] || 0) - (s.used[b] || 0) || (a < b ? -1 : 1));
      for (const id of cands) { if (over <= 0) break; pick.push(id); over -= sizeOf(id); }
    }
    return { ok: over <= 0, pick, used, overBy: Math.max(0, over) };
  }
  async function drop(ids) {
    const s = await load(), gone = [];
    for (const id of ids) { if (await safe(async () => { await assets.remove(id); return true; }, false)) { gone.push(id); delete s.used[id]; s.damaged = s.damaged.filter(x => x !== id); } }
    if (gone.length) await save();
    return gone;
  }
  const touch = id => locked(async () => { const s = await load(); s.used[id] = ++s.seq; await save(); });

  /** Follow a chunk until it settles; keeps `inflight` honest and reports progress. */
  function follow(id, onProgress) {
    let done = false, off = () => {};
    const end = () => { if (!done) { done = true; inflight.delete(id); try { off(); } catch { /* ignore */ } } };
    const on = async raw => {
      if (done) return;
      const settled = !BUSY.includes(raw?.state);
      if (settled) end();
      if (settled && raw?.state === 'ready') await safe(() => touch(id), null);
      if (onProgress) { try { onProgress(view(id, raw, await load())); } catch { /* a listener must not break the store */ } }
    };
    try { off = assets.watch(id, on) || off; } catch { end(); }
    if (done) { try { off(); } catch { /* ignore */ } }
  }

  /** @param {string} chunkId @param {{ onProgress?: (v: ChunkView) => void }} [o] */
  function request(chunkId, o = {}) {
    return locked(async () => {
      const s = await load(), c = byId.get(chunkId);
      if (!c) return { accepted: false, reason: 'unknown-chunk', evicted: [], status: view(chunkId, null, s) };
      const raw = await rawStatus(chunkId);
      if (!raw) return { accepted: false, reason: 'storage-error', evicted: [], status: view(chunkId, raw, s) };
      if (raw.state === 'ready') return { accepted: false, reason: 'ready', evicted: [], status: view(chunkId, raw, s) };
      const busy = BUSY.includes(raw.state);
      const room = busy || isStarter(c) || inflight.has(chunkId) ? { ok: true, pick: [] } : await plan(sizeOf(chunkId), chunkId);
      if (!room.ok) return { accepted: false, reason: 'no-space', evicted: [], status: view(chunkId, raw, s) };
      const r = await safe(() => assets.request(chunkId), null);
      if (!r) return { accepted: false, reason: 'storage-error', evicted: [], status: view(chunkId, await rawStatus(chunkId), s) };
      let evicted = [];
      if (r.accepted || r.reason === 'already') {
        if (!inflight.has(chunkId)) { inflight.add(chunkId); follow(chunkId, o.onProgress); }
        else if (o.onProgress) follow(chunkId, o.onProgress);
        if (r.accepted) evicted = await drop(room.pick);
      }
      const out = { accepted: Boolean(r.accepted), evicted, status: view(chunkId, await rawStatus(chunkId), s) };
      return r.reason ? { ...out, reason: r.reason } : out;
    });
  }

  /** @param {string} chunkId @returns {Promise<ChunkView>} */
  function whenSettled(chunkId) {
    return new Promise(resolve => {
      let done = false, off = () => {};
      const finish = async raw => { if (done) return; done = true; try { off(); } catch { /* ignore */ } resolve(view(chunkId, raw, await load())); };
      if (!byId.has(chunkId)) { finish(null); return; }
      try { off = assets.watch(chunkId, raw => { if (!BUSY.includes(raw?.state)) finish(raw); }) || off; } catch { /* fall through to the status read */ }
      rawStatus(chunkId).then(raw => { if (!raw || !BUSY.includes(raw.state)) finish(raw); });
    });
  }

  const setPin = (chunkId, on) => locked(async () => {
    const s = await load();
    if (!byId.has(chunkId)) return { ok: false, reason: 'unknown-chunk' };
    s.pins = s.pins.filter(id => id !== chunkId); if (on) s.pins.push(chunkId);
    await save();
    return { ok: true };
  });

  /** @param {string} chunkId */
  function evict(chunkId) {
    return locked(async () => {
      const s = await load(), c = byId.get(chunkId);
      if (!c) return { ok: false, reason: 'unknown-chunk' };
      if (isStarter(c)) return { ok: false, reason: 'starter' };
      if (s.pins.includes(chunkId)) return { ok: false, reason: 'pinned' };
      const raw = await rawStatus(chunkId);
      if (!raw) return { ok: false, reason: 'storage-error' };
      if (raw.state === 'absent') return { ok: false, reason: 'not-downloaded' };
      if (raw.state !== 'ready') { const ok = await safe(async () => { await assets.cancel(chunkId); return true; }, false); inflight.delete(chunkId); return ok ? { ok: true, freedBytes: 0 } : { ok: false, reason: 'storage-error' }; }
      const gone = await drop([chunkId]);
      return gone.length ? { ok: true, freedBytes: sizeOf(chunkId) } : { ok: false, reason: 'storage-error' };
    });
  }

  const enforce = () => locked(async () => {
    const s = await load(), p = await plan(0, null), evicted = await drop(p.pick);
    const { used } = await usedNow(), budget = budgetOf(s);
    return { evicted, usedBytes: used, budgetBytes: budget, overBy: Math.max(0, used - budget) };
  });

  /** Read the files of one pack. @returns {Promise<{ files?: { [f: string]: Uint8Array }, error?: 'storage-error' }>} */
  async function readFiles(chunkId, packId) {
    /** @type {{ [f: string]: Uint8Array }} */ const files = {};
    for (const f of PACK_FILES) {
      let b;
      try { b = await assets.readFile(chunkId, pathOf(packId, f)); } catch { return { error: 'storage-error' }; }
      if (b instanceof Uint8Array) files[f] = b;
    }
    return { files };
  }
  const flagDamaged = chunkId => locked(async () => { const s = await load(); if (!s.damaged.includes(chunkId)) { s.damaged.push(chunkId); await save(); } });

  /** @param {PackRef} entry */
  async function openPack(entry) {
    const chunkId = String(entry?.c ?? ''), packId = entry?.id;
    const st = await status(chunkId);
    if (st.known && typeof packId !== 'string') return { ok: false, state: 'rejected', reason: 'missing-file', chunkId, status: st };
    if (!st.downloaded) return { ok: false, state: 'not-downloaded', reason: st.reason || 'not-requested', chunkId, status: st };
    const reject = reason => ({ ok: false, state: 'rejected', reason, chunkId, status: st });
    const r = await readFiles(chunkId, packId);
    if (!r.files) return reject(r.error);
    const v = await verifyPackFiles(r.files, entry.h, hashFn);
    if (!v.ok) { if (v.reason !== 'no-hash') { await safe(() => flagDamaged(chunkId), null); st.damaged = true; } return reject(v.reason); }
    /** @type {any} */ const pack = { manifest: null, data: null, theme: null, media: { items: [] } };
    try { for (const f of PACK_FILES) if (r.files[f]) pack[f.slice(0, -5)] = JSON.parse(utf8.decode(r.files[f])); } catch { return reject('corrupt'); }
    await safe(() => touch(chunkId), null);
    return { ok: true, pack, chunkId, hash: v.actual };
  }

  /** @param {string} chunkId @param {PackRef[]} entries the catalog shard entries of this chunk */
  async function verifyChunk(chunkId, entries) {
    const c = byId.get(chunkId), st = await status(chunkId);
    if (!st.downloaded) return { ok: false, reason: st.reason || 'not-requested', checked: 0, bad: [] };
    const list = (Array.isArray(entries) ? entries : []).filter(e => e && (e.c === undefined || e.c === chunkId));
    if ((c?.n !== undefined && list.length !== c.n) || (c?.hash && chunkContentHash(list) !== c.hash)) return { ok: false, reason: 'catalog-mismatch', checked: 0, bad: [] };
    const bad = []; let checked = 0;
    for (const e of list) { // one pack at a time: memory stays bounded by the largest pack
      const r = await readFiles(chunkId, e.id);
      if (!r.files) return { ok: false, reason: 'storage-error', checked, bad };
      if (!(await verifyPackFiles(r.files, e.h, hashFn)).ok) bad.push(e.id);
      checked++;
    }
    if (bad.length) await safe(() => flagDamaged(chunkId), null);
    return bad.length ? { ok: false, reason: 'hash-mismatch', checked, bad } : { ok: true, checked, bad };
  }

  return {
    status, request, whenSettled, evict, openPack, verifyChunk,
    async chunks() { const s = await load(), out = []; for (const id of [...byId.keys()].sort()) out.push(view(id, await rawStatus(id), s)); return out; },
    pin: chunkId => setPin(chunkId, true),
    unpin: chunkId => setPin(chunkId, false),
    enforceBudget: enforce,
    /** @param {number | null} bytes null restores the default */
    async setBudget(bytes) { await locked(async () => { const s = await load(); s.budget = typeof bytes === 'number' && bytes >= 0 ? bytes : null; await save(); }); return enforce(); },
    async usage() {
      const s = await load(), { used, installed } = await usedNow();
      let starterBytes = 0, pinnedBytes = 0, evictableBytes = 0;
      for (const id of installed) {
        if (isStarter(byId.get(id))) starterBytes += sizeOf(id);
        else if (s.pins.includes(id)) pinnedBytes += sizeOf(id);
        else if (!inflight.has(id)) evictableBytes += sizeOf(id);
      }
      return { budgetBytes: budgetOf(s), usedBytes: used, starterBytes, pinnedBytes, evictableBytes };
    },
    /** @param {string} chunkId */
    async repair(chunkId) {
      const gone = await locked(async () => (byId.has(chunkId) ? drop([chunkId]) : []));
      if (byId.has(chunkId) && !gone.length) return { accepted: false, reason: 'storage-error', evicted: [], status: await status(chunkId) };
      return request(chunkId);
    },
    /** @param {PackRef[]} entries @returns {Promise<boolean[]>} */
    async downloaded(entries) { const have = new Set(await installedIds()); return entries.map(e => Boolean(e?.c) && byId.has(/** @type {string} */ (e.c)) && have.has(/** @type {string} */ (e.c))); },
  };
}
