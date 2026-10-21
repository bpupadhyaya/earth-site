// @ts-check
// App chrome: one root element, a router with a back stack, a header bar and the views (home: the games of the app in three views;
// a game's About, its menu, its mission picker and its knowledge page; pack About and menu, the pack player, browse, downloads,
// settings, sources). The way into a game is home -> game -> game-menu -> levels -> pack (docs/PRESENTATION-FLOW.md). Everything the chrome needs from the rest of the app is injected (see README.md), so it runs the same in a
// shell WebView, in a browser and under the DOM stub in tests. It never touches the network or storage itself.
import { BASE_CSS } from './render-dom.mjs';
import { resolveTheme } from './themes.mjs';
import { APP_CSS } from './chrome-css.mjs';
import { FLY_CSS } from './flight-hud.mjs';
import { h, fmt } from './dom.mjs';
import { browseView, downloadsView, settingsView, creditsView } from './views.mjs';
import { playerView } from './player.mjs';
import { codeView } from './growth.mjs';
import { aboutView, menuView, infoView } from './flow.mjs';
import { galleryView } from './gallery.mjs';
import { gameView, gameMenuView, levelsView, learnView } from './game.mjs';
import { courseView, seatOpen } from './course.mjs';
import { flightPacksOf } from '../core/course.mjs';

const VIEWS = { home: galleryView, browse: browseView, about: aboutView, menu: menuView, info: infoView, pack: playerView, downloads: downloadsView, settings: settingsView, credits: creditsView, code: codeView,
  game: gameView, 'game-menu': gameMenuView, levels: levelsView, learn: learnView, course: courseView };
/** Views that restart the back stack at home when opened without `push` (the app's top-level places). */
const ROOTS = ['home', 'browse', 'downloads', 'settings'];
const MAX_DEPTH = 24;

/**
 * @typedef {{ textZoom?: number, lowData?: boolean, reducedMotion?: boolean, theme?: string }} Settings
 * @typedef {{ get(): Settings, set(patch: Settings): void, subscribe(fn: (s: Settings) => void): () => void }} SettingsStore
 * @typedef {{ status: 'ready'|'not-downloaded'|'downloading'|'locked'|'error', pack?: any, progress?: number, preview?: boolean, previewMs?: number }} OpenResult
 * @typedef {{ open(id: string, opts?: { preview?: boolean }): OpenResult | Promise<OpenResult>, request(id: string): any, previewSpend?(game: string, ms: number): any, previewLeft?(game: string): number, pin(id: string): any, unpin?(id: string): any, evict(id: string): any,
 *   usage(): any, watch?(id: string, cb: () => void): () => void }} PackStore
 * @typedef {{ get(id: string): any, set(id: string, rec: any): any, recent(n: number): any }} ProgressStore
 * @typedef {{ root: any, catalog: any, packs: PackStore, templates: { load(id: string): any }, settings?: SettingsStore, progress?: ProgressStore,
 *   env?: { now?: () => number, raf?: (cb: () => void) => any, caf?: (id: any) => void, every?: (fn: () => void, ms: number) => any, onBack?: (handler: () => boolean) => (() => void) | void, openLink?: (url: string) => void, share?: (text: string) => void, pixelRatio?: number, log?: (m: any) => void },
 *   strings?: Record<string, string> | ((key: string, fallback: string) => string), render?: { createRenderer(canvas: any, opts: any): any }, quality?: string,
 *   categories?: { id: string, label: string }[], downloads?: boolean, compat?: Record<string, number>, featured?: () => any, related?: (entry: any) => any,
 *   credits?: { title: string, url?: string, license?: string, note?: string }[], about?: { name?: string, version?: string }, theme?: { preset: string, accent?: string },
 *   onLocked?: (entry: any) => void, css?: boolean, platform?: string, storeUrl?: { ios?: string, android?: string },
 *   siblings?: { name: string, kind?: string, storeUrl: { ios?: string, android?: string } }[], daily?: false | (() => any), findPack?: (tail: string) => any,
 *   icons?: { url?: (entry: any) => string | null }, entitlement?: (entry: any) => any,
 *   games?: { id: string, title: string, tagline?: string, about?: string[], howTo?: string[], rules?: string[], tint?: string, unit?: string, n?: number, learnN?: number, rep?: string, kind?: string, icon?: string | null,
 *     filter?: any, learnFilter?: any, sections?: { label: string, tag?: string, template?: string }[], learnSections?: { label: string, tag: string }[] }[],
 *   brand?: { logo?: { dark?: string, light?: string } },
 *   previewMs?: number,
 *   payments?: { product?: (entry: any) => { id: string, price?: string } | null, purchase?: (productId: string) => any, restore?: () => any, preview?: (entry: any) => boolean } }} AppConfig
 */

/** Settings kept in memory only; used when no store is injected. @param {Settings} [initial] @returns {SettingsStore} */
export function createMemorySettings(initial = {}) {
  let v = { textZoom: 1, lowData: false, reducedMotion: false, ...initial };
  const subs = new Set();
  return { get: () => v, set(p) { v = { ...v, ...p }; for (const f of subs) f(v); }, subscribe(f) { subs.add(f); return () => subs.delete(f); } };
}

/** Play records kept in memory only (most recent `max`); used when no store is injected. @returns {ProgressStore} */
export function createMemoryProgress(max = 20) {
  const m = new Map();
  return {
    get: id => m.get(id) || null,
    set(id, rec) { m.delete(id); if (rec) m.set(id, rec); while (m.size > max) m.delete(m.keys().next().value); },
    recent: (n = 5) => [...m].reverse().slice(0, n).map(([id, r]) => ({ id, ...r })),
  };
}

/** @param {AppConfig} cfg */
export function createApp(cfg) {
  const root = cfg.root, env = cfg.env || {};
  const table = cfg.strings || {};
  /** @type {(k: string, fb: string, vars?: Record<string, any>) => string} */
  const S = typeof table === 'function' ? (k, fb, vars) => fmt(table(k, fb), vars) : (k, fb, vars) => fmt(k in table ? table[k] : fb, vars);
  const settings = cfg.settings || createMemorySettings();
  const log = env.log || (() => {});
  /** @type {Set<Promise<any>>} */ const pending = new Set();
  /** Follow async work so that failures are logged, never thrown, and idle() can wait for it. */
  const track = p => { const q = Promise.resolve(p).catch(log); pending.add(q); q.then(() => pending.delete(q)); return q; };

  if (cfg.css !== false && !document.getElementById('ea-css')) document.head.append(h('style', { id: 'ea-css' }, BASE_CSS + APP_CSS + FLY_CSS));
  const backBtn = h('button.ea-btn', { type: 'button', onclick: () => back() }, S('back', 'Back'));
  const bar = h('header.ea-bar');
  const main = h('main.ea-main', { tabIndex: -1, 'aria-labelledby': 'ea-title' });
  const live = h('div.ea-live', { role: 'status', 'aria-live': 'polite' });
  let titleEl = h('h1.ea-title', { id: 'ea-title' });
  root.classList.add('ea-app');
  // developer builds only: a red bar while the debug unlock is on, and a fresh screen when it is switched (tiles and locks change)
  // The bar exists only when cfg.debug is set (developer builds): label plus a switch, on every screen, so testers need not open Settings.
  const debugSw = cfg.debug ? h('input.ea-check', { type: 'checkbox', role: 'switch', 'aria-label': S('debug.label', 'Developer: unlock all games (testing only)'), checked: Boolean(cfg.debug.unlockAll()), onchange: () => { Promise.resolve(cfg.debug.set?.(Boolean(debugSw.checked))); } }) : null;
  const debugText = h('span', null, '');
  const debugReset = cfg.debug?.resetPurchases ? h('button.ea-debugbtn', { type: 'button', data: { debugReset: '1' }, onclick: () => { Promise.resolve(cfg.debug.resetPurchases()); } }, S('debug.reset', 'Reset purchases')) : null;
  const debugBar = h('div.ea-debugbar', { role: 'status', hidden: !cfg.debug, data: { debugBar: '1' } }, debugText, debugSw, debugReset);
  // developer builds only: the red belt shows only while the unlock is ON (purchases are bypassed); off, the app behaves as in production
  const debugBelt = h('div.ea-debugbelt', { hidden: true, data: { debugBelt: '1' } }, S('debug.belt', 'FAKE STORE: purchases bypassed (testing only)'));
  root.replaceChildren(debugBar, bar, main, live, ...(cfg.debug ? [debugBelt] : []));

  /** @type {{ name: string, params: any }[]} */ const stack = [];
  /** @type {any} */ let view = null;
  let token = {};
  const said = new Set();

  const base = {
    cfg, S, env, log, track, settings, catalog: cfg.catalog, packs: cfg.packs, templates: cfg.templates, progress: cfg.progress || createMemoryProgress(),
    now: env.now || (() => 0),
    go, back, replace(name, params) { stack.pop(); go(name, params); },
    announce(text) { live.textContent = text; },
    /** True the first time it is asked about `key` in this run of the app. */
    once: key => !said.has(key) && Boolean(said.add(key)),
    setTitle(text) { titleEl.textContent = text; },
    /** The flight screen (engine/ui/flight-hud.mjs): the canvas fills the display and the page does not scroll; `drawer` slides the screen's text in. */
    fly(on, drawer) {
      root.classList.toggle('ea-fly', Boolean(on)); root.classList.toggle('ea-drawer', Boolean(on && drawer));
      const de = typeof document !== 'undefined' ? document.documentElement : null;
      if (de && de.classList) de.classList.toggle('ea-flying', Boolean(on));
    },
    /** The colours in use now (theme tokens), for generated icons. */
    theme: () => resolveTheme({ preset: settings.get().theme || cfg.theme?.preset || 'dawn', accent: cfg.theme?.accent }),
    domainLabel: id => (cfg.categories || []).find(c => c.id === id)?.label || (id ? id[0].toUpperCase() + id.slice(1) : ''),
  };

  function show() {
    if (view?.dispose) try { view.dispose(); } catch (e) { log(e); }
    const top = stack[stack.length - 1], mine = token = {};
    try { view = VIEWS[top.name]({ ...base, params: top.params, alive: () => token === mine }); }
    catch (e) { log(e); view = { title: S('problem', 'Something went wrong'), nodes: [h('p.ea-note', { role: 'alert' }, S('loadFailed', 'This could not be loaded.'))] }; }
    titleEl = view.heading || h(view.ownHeading ? 'p.ea-title' : 'h1.ea-title', { id: 'ea-title' }, view.title);
    backBtn.hidden = stack.length < 2;
    // a view may bring its own bar (home: logo, view switch, settings); every other view gets Back and its title
    bar.className = 'ea-bar' + (view.bar ? ' ea-brandbar' : '');
    bar.replaceChildren(...(view.bar ? [titleEl, ...view.bar] : [backBtn, titleEl, ...(view.actions || [])]));
    root.classList.toggle('ea-immersive', Boolean(view.immersive));
    base.fly(false);
    main.className = 'ea-main' + (view.flush ? ' ea-flush' : '');
    main.replaceChildren(...view.nodes);
    live.textContent = '';
    main.focus({ preventScroll: true });
    if (typeof globalThis.scrollTo === 'function') globalThis.scrollTo(0, 0);
  }

  /** Open a view. A top-level place restarts the stack at home (unless `opts.push`: settings opened from a menu); anything else is pushed.
   * @param {string} name @param {any} [params] @param {{ push?: boolean }} [opts] */
  function go(name, params = {}, opts = {}) {
    if (!(name in VIEWS)) return;
    // owner rule 2026-10-16: nothing stands between a player and gameplay. A course gate locks the pilot's seat only when a game
    // asks for it explicitly (games[].course.enforceGate: true); no shipped game does. The course stays an optional learning track.
    if (name === 'pack' && !params.checked && !params.watch) {
      const g = (Array.isArray(cfg.games) ? cfg.games : []).find(x => x?.course?.gate && x.course.enforceGate === true && (params.entry?.gm === x.id || (!params.entry && flightPacksOf(x.course).includes(params.id))));
      if (g) {
        track(seatOpen(base, g).then(r => (r.open ? go(name, { ...params, checked: true }, opts) : go('course', { id: g.id, blocked: params.entry?.t || '' }))));
        return;
      }
    }
    if (!opts.push && ROOTS.includes(name)) { stack.length = 0; if (name !== 'home') stack.push({ name: 'home', params: {} }); }
    stack.push({ name, params });
    if (stack.length > MAX_DEPTH) stack.splice(1, stack.length - MAX_DEPTH);
    show();
  }

  /** One step back. Returns false at home, so the shell can let the system handle the press (leave the app). */
  function back() {
    if (stack.length < 2) return false;
    stack.pop(); show();
    return true;
  }

  function apply() {
    const s = settings.get(), z = Math.min(3, Math.max(1, Number(s.textZoom) || 1));
    root.style.setProperty('--zoom', String(z));
    root.classList.toggle('ea-big', z > 1.6);
    root.classList.toggle('ea-rm', Boolean(s.reducedMotion));
    const th = base.theme();
    for (const [k, v] of Object.entries(th)) root.style.setProperty(`--${k}`, v);
    root.classList.toggle('ea-dark', th.dark === '1');
  }

  const onKey = ev => { if (ev.key === 'Escape' && back()) ev.preventDefault(); };
  root.addEventListener('keydown', onKey);
  const syncDebug = () => {
    if (!cfg.debug) { debugBar.hidden = true; return; }
    const on = Boolean(cfg.debug.unlockAll());
    debugBar.classList.toggle('ea-debugbar-on', on);
    debugBelt.hidden = !on;
    debugText.textContent = on ? S('debug.bar', 'DEBUG UNLOCK ON') : S('debug.barOff', 'DEBUG: unlock all games');
    if (debugSw) debugSw.checked = on;
  };
  syncDebug();
  const offDebug = typeof cfg.debug?.subscribe === 'function' ? cfg.debug.subscribe(() => { syncDebug(); if (stack.length && stack[stack.length - 1].name !== 'settings') show(); }) : null;
  const offs = [offDebug, settings.subscribe(apply), env.onBack && env.onBack(back), () => root.removeEventListener('keydown', onKey)];
  apply();
  go('home');

  return {
    go, back,
    /** Name of the view on top of the stack. */
    route: () => stack[stack.length - 1].name,
    /** Resolves when all loading started by the views has settled. */
    async idle() { while (pending.size) await Promise.all([...pending]); },
    /** Shell lifecycle: stop and restart real-time loops when the app goes to the background and returns. */
    pause() { view?.pause?.(); },
    resume() { view?.resume?.(); },
    destroy() { if (view?.dispose) view.dispose(); view = null; token = {}; for (const off of offs) if (typeof off === 'function') off(); root.replaceChildren(); },
  };
}
