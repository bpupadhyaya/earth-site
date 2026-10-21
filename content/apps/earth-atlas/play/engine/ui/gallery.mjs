// @ts-check
// Home: the GAMES of this app (docs/PRESENTATION-FLOW.md), never single packs. A game groups many packs (missions, levels) plus the
// knowledge that goes with it; the publisher writes the list into the catalog index (factory/publish/build.mjs gameMatcher) and the
// bootstrap hands it in as `config.games`. An app without games gets one game per topic (or per kind of game), so the flow is the same
// everywhere. Three views of the same games, switchable in the header: Icons (large app icons with names), List (tinted cards with
// a one-line tagline) and Cards (icon, title, facts and a round play button). A search field filters the games as you type and
// searches inside them on Enter. Below the games: the challenge of the day and "Enter a code" (engine/ui/growth.mjs).
import { cleanScene } from './scene-plate.mjs';
import { h, btn } from './dom.mjs';
import { dailyCard } from './growth.mjs';
import { tileIcon, mix } from './icons.mjs';
import { GAME_TINTS } from './themes.mjs';
import { entryLocked } from './flow.mjs';

export const MODES = [['icons', 'Icons'], ['list', 'List'], ['cards', 'Cards']];
const TINT_ORDER = ['atmosphere', 'sunrise', 'leaf', 'steel', 'ember', 'horizon'];
const SPACE = '#0b1720';

/** Small line icons of the chrome (24 x 24 grid, strokes), drawn as data addresses in the colour asked for. */
const UI = {
  icons: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M4 6h16M4 12h16M4 18h16',
  cards: 'M3 5h18v6H3zM3 13h18v6H3zM6 8h3M6 16h3',
  // a toothed wheel (8 teeth) with a round hole: the Settings gear (the old rays-around-a-circle read as a brightness control)
  gear: 'M10.4 4.6L10.7 1.9L13.3 1.9L13.6 4.6L16.1 5.6L18.3 3.9L20.1 5.7L18.4 7.9L19.4 10.4L22.1 10.7L22.1 13.3L19.4 13.6L18.4 16.1L20.1 18.3L18.3 20.1L16.1 18.4L13.6 19.4L13.3 22.1L10.7 22.1L10.4 19.4L7.9 18.4L5.7 20.1L3.9 18.3L5.6 16.1L4.6 13.6L1.9 13.3L1.9 10.7L4.6 10.4L5.6 7.9L3.9 5.7L5.7 3.9L7.9 5.6zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  search: 'M10.5 4a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM15.5 15.5L21 21',
  chevron: 'M9 5l7 7-7 7',
  play: 'M8 5.5v13l10.5-6.5z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z',
};
export function uiIcon(name, color, fill = false) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${UI[name]}" fill="${fill ? color : 'none'}" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return h('img.ea-ui', { src: 'data:image/svg+xml,' + encodeURIComponent(svg), alt: '' });
}

/** The brand mark drawn in code (night disc, planet limb, one sunrise glint): used when the app ships no logo file. */
function markSvg() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="s" cx=".38" cy=".28" r=".8"><stop offset="0" stop-color="#1d3d55"/><stop offset="1" stop-color="#08121a"/></radialGradient>'
    + '<linearGradient id="l" x2="1"><stop offset="0" stop-color="#6cc8f2" stop-opacity="0"/><stop offset=".4" stop-color="#6cc8f2"/><stop offset=".66" stop-color="#fff"/><stop offset=".8" stop-color="#ff9a52"/><stop offset="1" stop-color="#ff9a52" stop-opacity="0"/></linearGradient>'
    + '<clipPath id="c"><circle cx="32" cy="32" r="31"/></clipPath></defs><circle cx="32" cy="32" r="31" fill="url(#s)"/><g clip-path="url(#c)"><circle cx="32" cy="100" r="62" fill="#174a69"/><path d="M-4 41Q32 34 68 41" stroke="url(#l)" stroke-width="2.4" fill="none"/></g>'
    + '<circle cx="43" cy="37.5" r="2.6" fill="#ffd59a"/></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

const lines = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim() ? [v] : []);
const tagWord = t => { const w = String(t).replace(/[-_]+/g, ' ').trim(); return w ? w[0].toUpperCase() + w.slice(1) : String(t); };

/** @type {WeakMap<any, Promise<any[]>>} */ const cache = new WeakMap();
/**
 * The games of this app, in order, as the views use them:
 * { id, title, tagline, about[], howTo[], rules[], tint (hex), unit, n?, learnN?, rep?, kind?, icon?, filter, learnFilter, sections[], learnSections[] }.
 * `filter` / `learnFilter` are catalog filters (played in the game / taught in it). Never fails: no games is an empty list.
 */
export function gamesOf(ctx) {
  const { cfg } = ctx;
  if (!cache.has(cfg)) cache.set(cfg, Promise.resolve().then(async () => {
    /** @type {any[]} */ let list = Array.isArray(cfg.games) ? cfg.games : [];
    if (!list.length) {
      // no games in the catalog: one per topic of the app, else one per kind of game, else everything as one
      const cats = cfg.categories || [], kinds = Object.keys(cfg.compat || {});
      if (cats.length > 1) list = cats.map(c => ({ id: 'topic-' + c.id, title: c.label, filter: c.tag ? { tag: c.tag, domain: c.domain || undefined } : { domain: c.id } }));
      else if (kinds.length > 1) list = await Promise.all(kinds.map(async id => ({ id: 'kind-' + id.replace('/', '-'), title: (await Promise.resolve().then(() => ctx.templates.load(id)).catch(() => null))?.label || tagWord(id.split('/')[1] || id), filter: { template: id }, kind: id })));
      else list = [{ id: 'all', title: ctx.S('allGames', 'All games'), filter: {} }];
    }
    return list.map((g, i) => ({
      ...g, title: String(g.title || g.id), tagline: g.tagline || '', about: lines(g.about), howTo: lines(g.howTo), rules: lines(g.rules),
      tint: GAME_TINTS[g.tint] || (/^#[0-9a-f]{6}$/i.test(String(g.tint || '')) ? g.tint : GAME_TINTS[TINT_ORDER[i % TINT_ORDER.length]]),
      unit: g.unit || 'games', filter: g.filter || { game: g.id }, learnFilter: g.learnFilter !== undefined ? g.learnFilter : g.learn ? { learn: g.id } : null,
      sections: Array.isArray(g.sections) ? g.sections : [], learnSections: Array.isArray(g.learnSections) ? g.learnSections : [],
      scene: cleanScene(g.scene),
    }));
  }).catch(e => { ctx.log(e); return []; }));
  return /** @type {Promise<any[]>} */ (cache.get(cfg));
}
export async function gameById(ctx, id) { return (await gamesOf(ctx)).find(g => g.id === id) || null; }
/** The game a catalog entry is played in (its `gm`; for a pack opened by id, found by a catalog search), or null. Never throws. */
export async function gameOf(ctx, entry) {
  try {
    let gm = entry?.gm;
    if (!gm && entry?.id && entry.t) gm = ((await ctx.catalog.search(entry.t, { domain: entry.d, limit: 8 })).items || []).find(e => e.id === entry.id)?.gm;
    return gm ? await gameById(ctx, gm) : null;
  } catch { return null; }
}

/** A game for sale that this device does not own: { price } (price '' until the store has told it), else null. Synchronous, never throws. */
export function gameLock(ctx, g) {
  const entry = { e: g?.e, gm: g?.id };
  if (!entryLocked(ctx, entry)) return null;
  let price = '';
  try { price = ctx.cfg.payments?.product?.(entry)?.price || ''; } catch (e) { ctx.log(e); }
  return { price };
}
/** The lock mark on a home tile, card or row: a small lock and the store price (or "Locked" while the price is not known). */
const lockBadge = (ctx, g, color) => {
  const l = gameLock(ctx, g);
  if (l) return h('span.ea-lockbadge', { data: { locked: g.id } }, uiIcon('lock', color), h('span', null, l.price || ctx.S('locked.badge', 'Locked')));
  if ((g.e || 'free') !== 'free' && ctx.cfg.debug?.unlockAll?.()) return h('span.ea-lockbadge.ea-owned', { data: { debug: g.id } }, h('span', null, ctx.S('debug.badge', 'Unlocked for testing')));
  if (g.free === true) return freeBadge(ctx, g);
  return (g.e || 'free') !== 'free' ? h('span.ea-lockbadge.ea-owned', { data: { owned: g.id } }, h('span', null, ctx.S('owned.badge', 'Owned'))) : null;
};
/** The advertisement mark of a game the app sells in general but gives away: a bright FREE pill (app.json monetization.free, marked free: true by the publisher). */
export const freeBadge = (ctx, g) => h('span.ea-freebadge', { data: { free: g.id } }, uiIcon('star', '#3a2600', true), h('span', null, ctx.S('free.badge', 'FREE')));

/** Icon address of a game: its own 3D icon when the app ships one, else a generated tile in the game's tint. */
export function gameIcon(ctx, g) {
  if (g.icon) return g.icon;
  const t = ctx.theme();
  return tileIcon({ id: g.id, tp: g.kind || '', d: g.filter?.domain || '' }, { ...t, accent: mix(g.tint, t.dark === '1' ? SPACE : t.fg, 0.25) });
}
/** The two colours of a game's card gradient: the tint deepened toward space, dark enough for white text (at least 4.5:1). */
export const cardTint = (g, deep = 0) => ({ '--t1': mix(g.tint, SPACE, 0.55 + deep), '--t2': mix(g.tint, SPACE, 0.8 + deep / 2) });
const styleOf = vars => Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('; ');

/** "107 missions", or nothing when the count is not known. */
export const countText = (S, g) => (!Number.isFinite(g.n) ? '' : g.n === 1 ? S('unit1.' + g.unit, '1 ' + g.unit.replace(/s$/, '')) : S('unit.' + g.unit, '{n} ' + g.unit, { n: g.n }));

export function galleryView(ctx) {
  const { S, cfg } = ctx, p = ctx.params, t = ctx.theme(), ink = t.fg;
  const saved = ctx.settings.get().homeView;
  p.mode ||= MODES.some(m => m[0] === saved) ? saved : 'icons';
  p.q ??= '';

  // header: logo (the app's lockup, or the mark drawn in code) and the app's name; then the view switch and settings
  const logo = cfg.brand?.logo?.[t.dark === '1' ? 'dark' : 'light'];
  const name = cfg.about?.name || S('appName', 'Earth');
  const heading = h('h1.ea-title.ea-brand', { id: 'ea-title' },
    logo ? h('img.ea-logo', { src: logo, alt: S('brandName', 'Earth') }) : h('img.ea-mark', { src: markSvg(), alt: '' }),
    h('span.ea-appname', null, name));
  const seg = h('div.ea-views', { role: 'group', 'aria-label': S('showAs', 'Show games as') }, MODES.map(([m, fb]) =>
    h('button.ea-ib', { type: 'button', data: { mode: m }, title: S('view.' + m, fb), 'aria-pressed': String(p.mode === m), onclick: () => { if (p.mode === m) return; p.mode = m; ctx.settings.set({ homeView: m }); mark(); draw(); } },
      uiIcon(m, ink), h('span.ea-vh', null, S('view.' + m, fb)))));
  const mark = () => { for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.mode === p.mode)); };
  const gear = h('button.ea-ib.ea-gear', { type: 'button', title: S('tab.settings', 'Settings'), onclick: () => ctx.go('settings', {}, { push: true }) }, uiIcon('gear', ink), h('span.ea-vh', null, S('tab.settings', 'Settings')));

  // search: filters the games as you type (a shorter hint at large text sizes, so it is never cut off); Enter searches inside every game (Browse)
  const q = h('input.ea-in.ea-q', { type: 'search', id: 'ea-hq', value: p.q, placeholder: Number(ctx.settings.get().textZoom) > 1.6 ? S('searchShort', 'Search') : S('searchGames', 'Search games'), autocomplete: 'off', oninput: () => { p.q = q.value; draw(); } });
  const search = h('form.ea-search.ea-pill', { role: 'search', onsubmit: ev => { ev.preventDefault(); const v = q.value.trim(); if (v) ctx.go('browse', { q: v }); } },
    h('label.ea-vh', { for: 'ea-hq' }, S('searchLabel', 'Search by name, place or topic')), uiIcon('search', t.muted), q);

  const box = h('div.ea-slot.ea-games');
  /** @type {any[]} */ let all = [];
  const seen = g => !p.q.trim() || `${g.title} ${g.tagline}`.toLowerCase().includes(p.q.trim().toLowerCase());
  const open = g => () => ctx.go('game', { id: g.id });
  const tile = g => h('li', null, h('button.ea-tile', { type: 'button', data: { game: g.id }, onclick: open(g) },
    h('img.ea-gicon', { src: gameIcon(ctx, g), alt: '' }), h('span.ea-name', null, g.title), lockBadge(ctx, g, ink), countText(S, g) && h('span.ea-tag', null, countText(S, g))));
  const card = g => h('li', null, h('button.ea-card', { type: 'button', data: { game: g.id }, style: styleOf(cardTint(g)), onclick: open(g) },
    h('span.ea-txt', null, h('span.ea-name', null, g.title), g.tagline && h('span.ea-line', null, g.tagline)), lockBadge(ctx, g, '#ffffff'), uiIcon('chevron', '#ffffff')));
  const wide = g => h('li.ea-wide', { data: { game: g.id }, style: styleOf(cardTint(g, 0.08)) },
    h('button.ea-wmain', { type: 'button', onclick: open(g) }, h('img.ea-gicon', { src: gameIcon(ctx, g), alt: '' }),
      h('span.ea-txt', null, h('span.ea-name', null, g.title),
        h('span.ea-facts', null, [S('worksOffline', 'Works offline'), countText(S, g), g.learnN ? S('learnCount', '{n} to learn', { n: g.learnN }) : ''].filter(Boolean).join(' · ')),
        lockBadge(ctx, g, '#ffffff'), g.tagline && h('span.ea-line', null, g.tagline))),
    h('button.ea-round', { type: 'button', 'aria-label': S('playGame', 'Play {title}', { title: g.title }), onclick: () => ctx.go(gameLock(ctx, g) ? 'game' : 'game-menu', { id: g.id }) }, uiIcon('play', SPACE, true), h('span.ea-vh', null, S('play', 'Play'))));
  function draw() {
    if (!all.length) return;
    const list = all.filter(seen);
    const hint = p.q.trim() ? h('div.ea-chips', null, btn(S('searchInside', 'Search inside every game for "{q}"', { q: p.q.trim() }), () => ctx.go('browse', { q: p.q.trim() }), '.ea-chip')) : null;
    box.replaceChildren(...[
      !list.length ? h('p.ea-note', null, S('noGameMatch', 'No game has that name.')) :
        p.mode === 'icons' ? h('ul.ea-gallery', null, list.map(tile)) : p.mode === 'list' ? h('ul.ea-cards', null, list.map(card)) : h('ul.ea-wides', null, list.map(wide)),
      hint].filter(Boolean));
  }
  box.replaceChildren(h('p.ea-note', null, S('loading', 'Loading…')));
  ctx.track(gamesOf(ctx).then(games => { if (!ctx.alive()) return; all = games; if (!all.length) box.replaceChildren(h('p.ea-note', null, S('nothingYet', 'Nothing here yet.'))); else draw(); }));

  // the challenge of the day draws from the first catalog page (or the app's own pool)
  /** @type {any} */ let first = null;
  const page = () => (first ||= Promise.resolve(ctx.catalog.list({ limit: 24, compat: cfg.compat })).then(r => r.items, e => { first = null; throw e; }));
  const together = h('div.ea-slot.ea-together', null, dailyCard(ctx, () => (cfg.daily ? cfg.daily() : page())), h('div.ea-chips', null, btn(S('enterCode', 'Enter a code'), () => ctx.go('code'), '.ea-chip')));
  return { title: name, heading, bar: [h('div.ea-tools', null, seg, gear)], nodes: [search, box, together], home: true };
}
