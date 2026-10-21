// @ts-check
// The page side of the shell bridge. One object for both platforms (and a browser fallback for desktop checks):
//   native.platform                      'ios' | 'android' | 'web'
//   native.call(method, args)            -> Promise<any>   bridge methods are listed in shells/README.md
//   native.on(event, cb)                 -> unsubscribe    events: 'back' (return true when handled), 'pause', 'resume', 'chunk'
//   native.adapter                       the asset-pack adapter contract of engine/net/assetpacks.mjs
//   native.kv                            { get(key), set(key, value), remove(key), keys() } with string values, durable
//   native.call('store.products' | 'store.purchase' | 'store.restore' | 'store.owned', args)   the store bridge (shells/README.md)
//   native.on('store.updated', cb)       a purchase that arrived outside the app (receipt; revoked: true after a refund)
//   native.useFakeStore(handler)         dev builds only (store-fake.mjs): answers the store.* calls instead of the platform
//   native.info()                        -> Promise<{ platform, appId, version, build, locale, fontScale, debug, storePacks }>
// Chunk files are read with fetch from /_chunk/<id>/<path> on the app's own origin, so large binary data never crosses the bridge as text.

/** @typedef {{ state: 'absent'|'queued'|'downloading'|'paused'|'ready'|'failed', bytesDownloaded: number, bytesTotal: number, error?: string }} ChunkStatus */

export function createNative(scope = /** @type {any} */ (globalThis)) {
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  /** @type {Map<number, { resolve: Function, reject: Function }>} */
  const pending = new Map();
  let seq = 0;
  const ios = scope.webkit?.messageHandlers?.earth;
  const android = scope.EarthNative;
  const platform = ios ? 'ios' : android ? 'android' : 'web';
  let net = { online: false, metered: false };

  // Native code calls these two.
  scope.__earthNative = {
    reply(id, ok, value) { const p = pending.get(id); if (!p) return; pending.delete(id); ok ? p.resolve(value) : p.reject(new Error(String(value))); },
    emit(event, value) { let handled = false; for (const cb of listeners.get(event) || []) { try { if (cb(value) === true) handled = true; } catch { /* a listener must not break the bridge */ } } return handled; },
  };

  /** @type {null | ((method: string, args: any) => Promise<any>)} */
  let fakeStore = null;

  /** @param {string} method @param {object} [args] @returns {Promise<any>} */
  function call(method, args = {}) {
    if (fakeStore && method.startsWith('store.')) return fakeStore(method, args);
    if (ios) return ios.postMessage({ method, args });
    if (android) return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); android.post(JSON.stringify({ id, method, args })); });
    return webFallback(method, args);
  }

  /** Desktop browser: nothing to download, key-value in memory or localStorage. Lets the same page run from a static file server. */
  async function webFallback(method, args) {
    const ls = (() => { try { return scope.localStorage; } catch { return null; } })();
    switch (method) {
      case 'info': return { platform: 'web', appId: 'web', version: '0', build: 0, locale: scope.navigator?.language || 'en', fontScale: 1, debug: true, storePacks: false };
      case 'connectivity': return { online: false, metered: false };
      case 'chunk.status': return (await probe(args.id)) ? { state: 'ready', bytesDownloaded: 0, bytesTotal: 0 } : { state: 'absent', bytesDownloaded: 0, bytesTotal: 0 };
      case 'chunk.list': return [];
      case 'kv.get': return ls ? ls.getItem('earth:' + args.key) : null;
      case 'kv.set': ls?.setItem('earth:' + args.key, args.value); return null;
      case 'kv.remove': ls?.removeItem('earth:' + args.key); return null;
      case 'kv.keys': return ls ? Object.keys(ls).filter(k => k.startsWith('earth:')).map(k => k.slice(6)).sort() : [];
      case 'store.products': case 'store.owned': return [];
      case 'store.purchase': case 'store.restore': return { ok: false, reason: 'unavailable' }; // no store in a plain browser
      default: return null;
    }
  }
  const probe = async id => { try { return (await scope.fetch(`./_chunk/${encodeURIComponent(id)}/chunk.json`)).ok; } catch { return false; } };

  /** @param {string} event @param {(value: any) => any} cb */
  function on(event, cb) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)?.add(cb);
    return () => { listeners.get(event)?.delete(cb); };
  }

  const refreshNet = () => call('connectivity').then(c => { if (c) net = c; }).catch(() => {});
  refreshNet();
  on('resume', refreshNet);

  const adapter = {
    status: id => call('chunk.status', { id }),
    request: (id, o) => call('chunk.request', { id, wifiOnly: !!o?.wifiOnly }),
    cancel: id => call('chunk.cancel', { id }),
    remove: id => call('chunk.remove', { id }),
    /** @param {string} id @param {(s: ChunkStatus) => void} cb */
    onChange: (id, cb) => on('chunk', e => { if (e?.id === id) cb(e.status); }),
    /** @returns {Promise<Uint8Array | null>} */
    async readFile(id, path) {
      try {
        const r = await scope.fetch(`./_chunk/${encodeURIComponent(id)}/${path.split('/').map(encodeURIComponent).join('/')}`);
        return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
      } catch { return null; }
    },
    listInstalled: () => call('chunk.list'),
    connectivity: () => net,
  };

  const kv = {
    /** @returns {Promise<string | null>} */
    get: key => call('kv.get', { key }),
    set: (key, value) => call('kv.set', { key, value: String(value) }),
    remove: key => call('kv.remove', { key }),
    /** @returns {Promise<string[]>} */
    keys: () => call('kv.keys'),
  };

  return { platform, call, on, useFakeStore: handler => { fakeStore = handler; }, adapter, kv, info: () => call('info'), share: text => call('share', { text }), open: url => call('open', { url }) };
}
