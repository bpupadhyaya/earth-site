// @ts-check
// Interface to the shell's store asset-pack manager (Apple Background Assets / Google Play Asset Delivery) plus an in-memory fake for tests.
//
// Content arrives as chunks (docs/ARCHITECTURE.md section 15): the stores download, verify, resume and install them; the engine only asks,
// watches progress, cancels and reads what is installed. The engine never touches the network for this: the shell implements the adapter.
//
// Adapter contract (what a shell implements; every method may be async):
//   status(chunkId)                        -> { state, bytesDownloaded, bytesTotal, error? }   state: absent|queued|downloading|paused|ready|failed
//   request(chunkId, { wifiOnly })         -> void   start or resume; idempotent
//   cancel(chunkId)                        -> void   stop and discard partial download
//   remove(chunkId)                        -> void   delete an installed chunk
//   onChange(chunkId, cb)                  -> unsubscribe   cb(status) on every progress or state change
//   readFile(chunkId, path)                -> Uint8Array | null   a file inside an installed chunk (null when absent)
//   listInstalled()                        -> string[]
//   connectivity()                         -> { online: boolean, metered: boolean }   metered = cellular or hotspot

/**
 * @typedef {'absent'|'queued'|'downloading'|'paused'|'ready'|'failed'} ChunkState
 * @typedef {{ state: ChunkState, bytesDownloaded: number, bytesTotal: number, error?: string }} ChunkStatus
 * @typedef {{ status(id: string): ChunkStatus | Promise<ChunkStatus>, request(id: string, o: { wifiOnly: boolean }): void | Promise<void>, cancel(id: string): void | Promise<void>,
 *   remove(id: string): void | Promise<void>, onChange(id: string, cb: (s: ChunkStatus) => void): () => void,
 *   readFile(id: string, path: string): Uint8Array | null | Promise<Uint8Array | null>, listInstalled(): string[] | Promise<string[]>,
 *   connectivity(): { online: boolean, metered: boolean } }} AssetPackAdapter
 */

/**
 * Policy layer over an adapter: low-data and Wi-Fi-only rules live here once, so no template or app decides them.
 * @param {AssetPackAdapter} adapter
 * @param {{ lowData?: () => boolean, wifiOnly?: () => boolean, kindOf?: (chunkId: string) => 'content'|'media'|'world' }} [opts]
 *   kindOf tells which chunks are optional media (never downloaded in low-data mode); default: ids starting with "media-" are media.
 */
export function createAssetPacks(adapter, opts = {}) {
  const lowData = opts.lowData || (() => false);
  const wifiOnly = opts.wifiOnly || (() => true);
  const kindOf = opts.kindOf || (id => (id.startsWith('media-') ? 'media' : 'content'));
  return {
    /**
     * Ask for a chunk. Never throws, never blocks play: the answer says whether the download was started.
     * @returns {Promise<{ accepted: boolean, reason?: 'ready'|'offline'|'low-data'|'metered'|'already', status: ChunkStatus }>}
     */
    async request(chunkId) {
      const st = await adapter.status(chunkId);
      if (st.state === 'ready') return { accepted: false, reason: 'ready', status: st };
      if (st.state === 'downloading' || st.state === 'queued') return { accepted: false, reason: 'already', status: st };
      const c = adapter.connectivity();
      if (!c.online) return { accepted: false, reason: 'offline', status: st };
      if (kindOf(chunkId) === 'media' && lowData()) return { accepted: false, reason: 'low-data', status: st };
      if (c.metered && wifiOnly()) return { accepted: false, reason: 'metered', status: st };
      await adapter.request(chunkId, { wifiOnly: wifiOnly() });
      return { accepted: true, status: await adapter.status(chunkId) };
    },
    cancel: chunkId => adapter.cancel(chunkId),
    remove: chunkId => adapter.remove(chunkId),
    status: chunkId => adapter.status(chunkId),
    /** @param {string} chunkId @param {(s: ChunkStatus) => void} cb @returns {() => void} */
    watch: (chunkId, cb) => adapter.onChange(chunkId, cb),
    /** Resolves when the chunk is ready or has failed; resolves immediately if it already is. @returns {Promise<ChunkStatus>} */
    whenSettled(chunkId) {
      return new Promise(resolve => {
        let done = false;
        /** @type {() => void} */
        let off = () => {};
        const settle = s => { if (!done) { done = true; off(); resolve(s); } };
        // subscribe first (synchronously) so no change between the status read and the subscription is missed
        off = adapter.onChange(chunkId, s => { if (s.state === 'ready' || s.state === 'failed' || s.state === 'absent') settle(s); });
        Promise.resolve(adapter.status(chunkId)).then(s => { if (s.state === 'ready' || s.state === 'failed') settle(s); });
      });
    },
    /** Installed file bytes or `fallback` (default null): callers never branch on connectivity. */
    async readFile(chunkId, path, fallback = null) { return (await adapter.readFile(chunkId, path)) ?? fallback; },
    installed: () => adapter.listInstalled(),
  };
}

/**
 * Deterministic in-memory adapter for tests and for web builds with no store delivery. Progress advances only when `tick()` is called.
 * @param {{ chunks: { [id: string]: { bytes: number, files?: { [path: string]: Uint8Array } } }, stepBytes?: number, online?: boolean, metered?: boolean, installed?: string[] }} cfg
 */
export function createFakeAssetPackAdapter(cfg) {
  const step = cfg.stepBytes || 1000;
  const net = { online: cfg.online !== false, metered: Boolean(cfg.metered) };
  /** @type {Map<string, ChunkStatus>} */
  const st = new Map();
  /** @type {Map<string, Set<(s: ChunkStatus) => void>>} */
  const subs = new Map();
  /** @type {Set<string>} */
  const failNext = new Set();
  const get = id => {
    if (!st.has(id)) {
      const total = cfg.chunks[id]?.bytes ?? 0;
      st.set(id, cfg.installed?.includes(id) ? { state: 'ready', bytesDownloaded: total, bytesTotal: total } : { state: 'absent', bytesDownloaded: 0, bytesTotal: total });
    }
    return /** @type {ChunkStatus} */ (st.get(id));
  };
  const emit = id => { for (const cb of subs.get(id) || []) cb({ ...get(id) }); };
  return {
    status: id => ({ ...get(id) }),
    request(id) {
      if (!cfg.chunks[id]) { st.set(id, { state: 'failed', bytesDownloaded: 0, bytesTotal: 0, error: 'unknown-chunk' }); emit(id); return; }
      const s = get(id);
      if (s.state === 'ready' || s.state === 'downloading') return;
      s.state = net.online ? 'downloading' : 'queued'; s.error = undefined; emit(id);
    },
    cancel(id) { const s = get(id); s.state = 'absent'; s.bytesDownloaded = 0; s.error = undefined; emit(id); },
    remove(id) { const s = get(id); s.state = 'absent'; s.bytesDownloaded = 0; emit(id); },
    onChange(id, cb) { if (!subs.has(id)) subs.set(id, new Set()); /** @type {Set<any>} */ (subs.get(id)).add(cb); return () => subs.get(id)?.delete(cb); },
    readFile(id, path) { return get(id).state === 'ready' ? cfg.chunks[id]?.files?.[path] ?? null : null; },
    listInstalled: () => [...st.entries()].filter(([, s]) => s.state === 'ready').map(([id]) => id).sort(),
    connectivity: () => ({ ...net }),
    // test controls
    /** advance every active download by one step; applies queued->downloading when online returns */
    tick() {
      for (const [id, s] of st) {
        if (s.state === 'queued' && net.online) { s.state = 'downloading'; emit(id); }
        if (s.state !== 'downloading') continue;
        if (failNext.has(id)) { failNext.delete(id); s.state = 'failed'; s.error = 'network'; emit(id); continue; }
        s.bytesDownloaded = Math.min(s.bytesTotal, s.bytesDownloaded + step);
        if (s.bytesDownloaded >= s.bytesTotal) s.state = 'ready';
        emit(id);
      }
    },
    setOnline(v) { net.online = v; if (!v) for (const [id, s] of st) if (s.state === 'downloading') { s.state = 'paused'; emit(id); } else { void id; } if (v) for (const [id, s] of st) if (s.state === 'paused') { s.state = 'downloading'; emit(id); } },
    setMetered(v) { net.metered = v; },
    failNextTick(id) { failNext.add(id); },
  };
}
