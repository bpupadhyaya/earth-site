// @ts-check
// App bootstrap: joins the shell bridge, the pack store, the catalog, settings, play records and the app chrome into a running app.
// The shell page calls this once:
//
//   import { start } from './engine/app/start.mjs';
//   const app = await start({ root, native, app, loadTemplate });
//     root          element the app owns
//     native        the shell bridge (shells/web/native.mjs): { adapter, kv, on, info, open, share, platform }
//     app           public app description: { slug, name, version, theme, templates: [templateId], categories?, credits?, budgetMB?, storeUrl?: { ios, android }, siblings?: [{ name, kind?, storeUrl }],
//                   gameIcons?: { [gameId]: address }, logo?: { dark, light } }   (games themselves come from the catalog index: index.games)
//     loadTemplate  (templateId) -> template   (the page imports the module; the engine never imports templates)
//     assetPacks    createAssetPacks from engine/net/assetpacks.mjs (handed in by the page: only engine/net deals with downloads)
//     render        optional engine/render factory for real-time screens
//     services      optional shared engine services for templates (env.services), for example { world, landing }; built once by the page
//     credits       optional extra credit lines [{ title, url?, license?, note? }] (for example the world data credits)
//     now           () -> milliseconds since epoch: the page passes the real clock (the engine never reads it itself)
//     app.monetization  optional { model: 'per-game', priceTier, products: { gameId: productId }, preview?: false }: every game is a one-time purchase (engine/payments)
//     payments      optional { product?(entry), purchase(productId), restore?(), preview?(entry) } for the unlock button on About
//                   (engine/ui README); without it the button says purchases are not available yet and no price is ever shown
//     debug         optional { unlockAll(): boolean, set?(on), subscribe?(fn), sticky? } (developer builds only, shells/web/debug-unlock.mjs): while unlockAll() is true every
//                   entitlement check answers allowed (via 'debug'); Settings shows the switch. Without it nothing changes.
//     icons         optional { url(entry) -> address | null }: the app's own game icons; without it generated tiles are shown
//     raf, caf      optional frame hooks (default: the platform's)
//
// Content layout it reads (written by the publisher, factory/publish):
//   chunk "catalog" (install-time): index.json = { version, chunks, shards }, shards/<domain>/<shard>.json
//   every other chunk: <packId>/manifest.json | data.json | theme.json | media.json
// Everything works with no network. A missing or damaged catalog gives an app with an empty library and a plain message, never a crash.

import { createPackStore } from '../core/packstore.mjs';
import { createLibrary } from '../core/library.mjs';
import { loadSettings } from '../core/settings.mjs';
import { loadEntitlements } from '../core/entitlements.mjs';
import { createPayments } from '../payments/index.mjs';
import { withDebugUnlock } from '../payments/debug.mjs';
import { readJson, writeJson } from '../core/kv.mjs';
import { createApp } from '../ui/app.mjs';

export const CATALOG_CHUNK = 'catalog';
export const PROGRESS_KEY = 'earth.progress.v1';
export const LOOK_KEY = 'earth.look.v1';
const PROGRESS_MAX = 40;
const utf8 = new TextDecoder();

/** Play records on the shell key-value store: one small index plus one record per pack, most recent first, bounded. */
export async function loadProgress(kv, max = PROGRESS_MAX) {
  const schema = { type: 'object', required: ['ids'], properties: { ids: { type: 'array', items: { type: 'string' } } } };
  let ids = (await readJson(kv, PROGRESS_KEY, schema, { ids: [] })).value.ids.slice(0, max);
  /** @type {Map<string, any>} */ const cache = new Map();
  const key = id => `${PROGRESS_KEY}.${id}`;
  const read = async id => { try { const t = await kv.get(key(id)); return t ? JSON.parse(t) : null; } catch { return null; } };
  for (const id of ids) cache.set(id, await read(id));
  let chain = Promise.resolve();
  return {
    get: id => cache.get(id) ?? null,
    set(id, rec) {
      const dropped = [];
      ids = ids.filter(x => x !== id);
      if (rec) { ids.unshift(id); cache.set(id, rec); } else { cache.delete(id); dropped.push(id); }
      while (ids.length > max) { const old = /** @type {string} */ (ids.pop()); cache.delete(old); dropped.push(old); }
      const order = ids.slice();
      // writes go one after another so a slow store cannot reorder them
      chain = chain.then(async () => {
        try { if (rec) await kv.set(key(id), JSON.stringify(rec)); for (const d of dropped) await kv.remove(key(d)); await writeJson(kv, PROGRESS_KEY, { ids: order }); } catch { /* the play continues without a saved record */ }
      });
      return chain;
    },
    recent: (n = 5) => ids.slice(0, n).map(id => ({ id, ...(cache.get(id) || {}) })).filter(r => r.title || r.entry),
    idle: () => chain,
  };
}

/**
 * @param {{ root: any, native: any, app: any, loadTemplate: (id: string) => any, assetPacks: Function, render?: any, services?: any, credits?: any[], now: () => number, payments?: any, debug?: any, icons?: any, raf?: any, caf?: any, log?: (m: any) => void }} o
 */
export async function start(o) {
  const { native, app } = o, kv = native.kv, log = o.log || (() => {});
  if (typeof o.now !== 'function') throw new TypeError('start: now (a clock function) is required');
  const now = o.now;
  const file = async (chunk, path) => { try { return await native.adapter.readFile(chunk, path); } catch { return null; } };
  const json = async (chunk, path) => { const b = await file(chunk, path); if (!b) return null; try { return JSON.parse(utf8.decode(b)); } catch { return null; } };

  const settingsStore = await loadSettings({ kv });
  const look = (await readJson(kv, LOOK_KEY, { type: 'object' }, {})).value || {};
  /** The chrome's settings: the stored engine settings plus the look choices kept beside them (colour theme, home view, knowledge view). */
  const settings = {
    get: () => ({ ...settingsStore.get(), theme: look.theme || app.theme?.preset || 'dawn', ...(look.homeView ? { homeView: look.homeView } : {}), ...(look.learnView ? { learnView: look.learnView } : {}) }),
    async set(patch) {
      const { theme, homeView, learnView, ...rest } = patch || {};
      if (theme !== undefined) look.theme = String(theme);
      if (homeView !== undefined) look.homeView = String(homeView);
      if (learnView !== undefined) look.learnView = String(learnView);
      if (theme !== undefined || homeView !== undefined || learnView !== undefined) await writeJson(kv, LOOK_KEY, look);
      if (Object.keys(rest).length) await settingsStore.set(rest); else for (const f of subs) f(settings.get());
    },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
  /** @type {Set<Function>} */ const subs = new Set();
  settingsStore.subscribe(() => { for (const f of subs) f(settings.get()); });

  const templates = [];
  for (const id of app.templates || []) { try { templates.push(await o.loadTemplate(id)); } catch (e) { log(e); } }
  const byTemplate = new Map(templates.map(t => [t.id, t]));

  const index = (await json(CATALOG_CHUNK, 'index.json')) || { version: '0', chunks: [], shards: [] };
  if (typeof o.assetPacks !== 'function') throw new TypeError('start: assetPacks (createAssetPacks from engine/net) is required');
  const assets = o.assetPacks(native.adapter, { lowData: () => settingsStore.get().lowData });
  const store = createPackStore({ index, assets, kv, budgetBytes: app.budgetMB ? app.budgetMB * 1048576 : undefined });
  const realEntitlements = await loadEntitlements({ kv, now, app: app.slug });
  // developer builds only: the debug switch opens every game (inert when no debug hook was handed in)
  const debug = o.debug && typeof o.debug.unlockAll === 'function' ? o.debug : null;
  const entitlements = withDebugUnlock(realEntitlements, debug);
  // developer builds only (the debug bar's Reset purchases): forget test purchases (fake-store receipts and the cached entitlements) so paid games lock again
  const resetTestPurchases = async () => {
    try { await native.kv?.remove?.('fake-store.owned'); } catch (e) { o.log?.(e); }
    try { await realEntitlements.setReceipts([]); } catch (e) { o.log?.(e); }
    try { await debug?.set?.(Boolean(debug.unlockAll())); } catch (e) { o.log?.(e); } // tells the screens to redraw
  };
  // per-game one-time purchases (app.json monetization, engine/payments/README.md): prices and owned receipts from the shell's store,
  // asked for briefly at start; a slow or missing store never holds the app back (cached prices and receipts are used)
  let payments = o.payments;
  if (!payments && app.monetization?.model === 'per-game') {
    payments = createPayments({ native, entitlements, app: { slug: app.slug, monetization: app.monetization }, now });
    await Promise.race([payments.refresh().catch(log), new Promise(done => setTimeout(done, 1500))]);
  }
  const library = createLibrary({ index, readShard: (domain, shard) => file(CATALOG_CHUNK, `shards/${domain}/${shard}.json`), store, templates, entitlements });
  const progress = await loadProgress(kv);

  // The chrome names packs by id; the store works on catalog entries. Remember every entry that passed through a list.
  /** @type {Map<string, any>} */ const seen = new Map();
  const remember = items => { for (const e of items || []) { if (seen.size > 5000) seen.clear(); seen.set(e.id, e); } return items; };
  const catalog = {
    async list(filter) { const r = await library.browse(filter); remember(r.items); return r; },
    async search(query, filter) { const r = await library.search(query, filter); remember(r.items); return r; },
  };
  const entryOf = async id => {
    if (seen.has(id)) return seen.get(id);
    const saved = progress.get(id)?.entry; if (saved?.c) return saved;
    // A pack opened by id before any list was shown (a link, a challenge code): page through the catalog until it turns up.
    for (let cursor, pages = 0; pages < 200 && !seen.has(id); pages++) {
      const r = await library.browse({ limit: 200, cursor }); remember(r.items);
      if (!r.next) break; cursor = r.next;
    }
    return seen.get(id) || null;
  };
  const chunkLabel = c => [c.domain ? c.domain[0].toUpperCase() + c.domain.slice(1) : null, c.group].filter(Boolean).join(' · ') || c.id;

  const packs = {
    async open(id) {
      const entry = await entryOf(id);
      if (!entry) return { status: 'error' };
      const r = await library.open(entry);
      if (r.ok) return { status: 'ready', pack: r.pack };
      if (r.state === 'locked') return { status: 'locked' };
      if (r.state !== 'not-downloaded') { log(`${id}: ${r.state} ${r.reason || ''}`); return { status: 'error' }; }
      const s = r.status || (await store.status(entry.c));
      return ['queued', 'downloading', 'paused'].includes(s.state) ? { status: 'downloading', progress: s.progress || 0 } : { status: 'not-downloaded' };
    },
    async request(id) { const entry = await entryOf(id); return entry ? store.request(entry.c) : { accepted: false, reason: 'unknown-chunk' }; },
    watch(id, cb) { let off = () => {}; entryOf(id).then(e => { if (e) off = assets.watch(e.c, cb); }); return () => off(); },
    // The downloads screen lists chunks (the unit the stores deliver); ids there carry a "chunk:" prefix.
    pin: id => store.pin(id.replace(/^chunk:/, '')),
    unpin: id => store.unpin(id.replace(/^chunk:/, '')),
    evict: id => store.evict(id.replace(/^chunk:/, '')),
    async usage() {
      const u = await store.usage(), views = await store.chunks();
      const items = views.filter(v => v.downloaded && !v.starter).map(v => { const c = (index.chunks || []).find(x => x.id === v.id) || { id: v.id }; return { id: 'chunk:' + v.id, title: chunkLabel(c), bytes: c.bytes || 0, pinned: v.pinned }; });
      return { bytes: u.usedBytes + u.starterBytes, budget: Number.isFinite(u.budgetBytes) && u.budgetBytes > 0 ? u.budgetBytes : undefined, items };
    },
  };

  const domains = [...new Set((index.shards || []).map(s => s.domain))].sort();
  const ui = createApp({
    root: o.root, catalog, packs, progress, settings, render: o.render,
    templates: { load: id => byTemplate.get(id) || Promise.reject(new Error(`template ${id} is not part of this app`)) },
    featured: Array.isArray(app.featured) && app.featured.length ? async () => (await Promise.all(app.featured.map(id => entryOf(id)))).filter(Boolean) : undefined,
    // nothing is downloaded later when every chunk comes with the install: the Downloads screen is then hidden
    downloads: (index.chunks || []).length && !(index.chunks || []).some(c => c.delivery && c.delivery !== 'install-time') ? false : undefined,
    categories: app.categories || domains.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) })),
    platform: native.platform, storeUrl: app.storeUrl, siblings: app.siblings,
    // challenge of the day: only games every install of this app version has (the install-time chunks), never locked ones
    daily: async () => { const starter = new Set((index.chunks || []).filter(c => c.delivery === 'install-time').map(c => c.id)); return (await catalog.list({ limit: 200 })).items.filter(e => starter.has(e.c) && !e.locked); },
    entitlement: entry => entitlements.check(entry), payments, icons: o.icons,
    // the games of this app (the publisher's games index) with their icons shipped in www (shells/generate.mjs), and the brand lockups
    games: (Array.isArray(index.games) ? index.games : []).map(g => ({ ...g, learnN: g.learn || 0, learn: undefined, filter: { game: g.id }, learnFilter: g.learn ? { learn: g.id } : null, icon: app.gameIcons?.[g.id] || null, scene: app.gameScenes?.[g.id] || undefined })),
    brand: app.logo ? { logo: app.logo } : undefined,
    debug: debug ? { ...debug, resetPurchases: resetTestPurchases } : undefined, compat: library.compat, theme: app.theme, about: { name: app.name, version: app.version }, credits: [...(app.credits || []), ...(o.credits || [])], services: o.services || {},
    env: {
      now, raf: o.raf, caf: o.caf, log, pixelRatio: globalThis.devicePixelRatio || 1,
      onBack: handler => native.on('back', () => handler() !== false),
      openLink: url => { native.open(url).catch(log); },
      share: text => { native.share(text).catch(log); },
    },
  });
  native.on('pause', () => ui.pause());
  native.on('resume', () => ui.resume());
  return { ui, library, store, settings, progress, entitlements, problems: () => library.problems() };
}
