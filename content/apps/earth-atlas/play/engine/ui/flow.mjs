// @ts-check
// The way into a game (docs/PRESENTATION-FLOW.md): home -> About -> the game's menu -> play. About tells what the game is, how
// to play it and where its facts come from, and ends with the unlock state and the purchase button; the menu offers Play,
// Watch and Learn (the game plays itself, engine/ui/player.mjs `watch`), Rules, How to play, Sources, Settings and the best score.
// Words come from the pack (manifest subtitle, about, howTo, rules) and fall back to the template (describe, howTo, rules).
import { h, btn, size, section } from './dom.mjs';
import { iconFor } from './icons.mjs';

export const lines = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : typeof v === 'string' && v.trim() ? [v] : []);
export const scoreOf = (S, r) => (!r || !Number.isFinite(r.score) ? '' : Number.isFinite(r.total) ? S('scoreOf', 'Score {score} of {total}', r) : S('scoreOnly', 'Score {score}', r));

/** Everything the About page and the menu show about one game; never fails (a missing piece is left out). */
export async function gameInfo(ctx, id, entry, preview) {
  /** @type {any} */ let r = { status: 'error' }, tpl = null;
  try { r = (await ctx.packs.open(id, preview ? { preview: true } : undefined)) || r; } catch (e) { ctx.log(e); }
  const m = r.pack?.manifest || {};
  const e = entry || { id, t: m.title, tp: m.template, d: m.domain, g: m.tags, df: m.difficulty, e: m.entitlement };
  try { if (e.tp) tpl = await ctx.templates.load(e.tp); } catch (err) { ctx.log(err); }
  const rec = await Promise.resolve(ctx.progress.get(id)).catch(() => null);
  return {
    status: r.status, pack: r.pack || null, entry: e, tpl, rec,
    title: e.t || m.title || ctx.S('thisItem', 'This item'),
    what: lines(m.about).length ? lines(m.about) : lines(m.subtitle), describe: tpl?.describe || '',
    // how to play: the pack's words, else the template's, else the template's one line of what the player does
    howTo: lines(m.howTo).length ? lines(m.howTo) : lines(tpl?.howTo).length ? lines(tpl.howTo) : lines(tpl?.describe),
    ownHowTo: Boolean(lines(m.howTo).length || lines(tpl?.howTo).length),
    rules: lines(m.rules).length ? lines(m.rules) : lines(tpl?.rules),
  };
}

/** Unlock state of an entry: 'free' | 'owned' | 'pass' | 'grace' | 'locked' | 'expired' | 'revoked'. */
export function unlockState(ctx, info) {
  const tier = info.entry.e || info.pack?.manifest?.entitlement || 'free';
  if (tier === 'free' && info.status !== 'locked') return 'free';
  /** @type {any} */ let r = null;
  try { r = ctx.cfg.entitlement ? ctx.cfg.entitlement(info.entry) : null; } catch (e) { ctx.log(e); }
  if (r) return r.allowed ? (r.grace ? 'grace' : r.via === 'debug' ? 'debug' : r.via === 'pass' ? 'pass' : 'owned') : r.reason || 'locked';
  return info.status === 'locked' ? 'locked' : 'owned';
}
const STATE = {
  free: 'Free to play. Everything in this game works without a connection.',
  owned: 'Unlocked on this device.',
  pass: 'Open with your pass.',
  debug: 'Unlocked for testing (developer switch in Settings).',
  grace: 'Unlocked. The purchase is checked again the next time you are online.',
  locked: 'This game is part of the full unlock of this app.',
  expired: 'The unlock for this game has ended on this device.',
  revoked: 'The unlock for this game is no longer valid on this device.',
};

/** The purchase block: the state message, a free-preview note, the unlock button (no price unless one is configured) and restore. */
export function unlockBlock(ctx, info, state, reload, gameTitle) {
  const { S, cfg } = ctx, pay = cfg.payments || {};
  const msg = h('p.ea-note', { role: 'status' });
  /** @type {any} */ let product = null;
  if (!['free', 'owned', 'pass', 'grace', 'debug'].includes(state)) { try { product = pay.product ? pay.product(info.entry) : null; } catch (e) { ctx.log(e); } }
  // a per-game purchase (engine/payments): the button names the game and the store's price
  const game = product?.perGame ? (gameTitle || (Array.isArray(cfg.games) ? cfg.games : []).find(g => g?.id === info.entry.gm)?.title || info.title) : '';
  const kids = [h('p.ea-msg', { data: { state } }, game && state === 'locked' ? S('unlock.game', 'Unlock {game} once to play it and learn from it. One purchase, no subscription, and it then works offline.', { game }) : S('unlock.' + state, STATE[state] || STATE.locked))];
  const preview = state !== 'free' && !['owned', 'pass', 'grace', 'debug'].includes(state) && canPreview(ctx, info.entry);
  if (preview) kids.push(h('p.ea-note', { data: { preview: 'offer' } }, S('previewNote', 'You can play a free preview now. The unlock opens the whole game.') + ' ' + S('previewLen', 'The preview is {s} seconds of play.', { s: Math.round((cfg.previewMs || 90000) / 1000) })));
  if (!['free', 'owned', 'pass', 'grace', 'debug'].includes(state)) {
    const price = product && typeof product.price === 'string' && product.price.trim() ? product.price.trim() : '';
    const label = game ? (price ? S('unlockGamePrice', 'Unlock {game}: {price}', { game, price }) : S('unlockGame', 'Unlock {game}', { game }))
      : price ? S('unlockPrice', 'Unlock the full app: {price}', { price }) : S('unlockApp', 'Unlock the full app');
    const buy = btn(label, () => ctx.track((async () => {
      buy.disabled = true;
      /** @type {any} */ let r = null;
      try { r = typeof pay.purchase === 'function' ? await pay.purchase(product?.id || 'unlock') : { ok: false, reason: 'unavailable' }; } catch (e) { ctx.log(e); r = { ok: false, reason: 'failed' }; }
      if (!ctx.alive()) return;
      buy.disabled = false;
      if (r && r.ok) { ctx.announce(S('unlocked', 'Unlocked. Thank you.')); ctx.track(reload()); return; }
      msg.textContent = r?.reason === 'cancelled' ? S('buyCancelled', 'Nothing was bought.')
        : r?.reason === 'failed' ? S('buyFailed', 'That did not work. Nothing was charged. Please try again later.')
          : r?.reason === 'pending' ? S('buyPending', 'The purchase is waiting for approval. The game unlocks as soon as it is approved.')
            : game ? S('buyUnavailableGame', 'Purchases are not available on this device right now.') : S('buyUnavailable', 'Purchases are not available yet in this version. Every free game can be played now.');
    })()), '.ea-go');
    kids.push(h('div.ea-chips', null, buy, typeof pay.restore === 'function' && btn(S('restore', 'Restore purchases'), () => ctx.track(Promise.resolve().then(() => pay.restore()).then(
      r => { if (!ctx.alive()) return; if (r && r.ok === false) { msg.textContent = r.reason === 'unavailable' ? S('buyUnavailableGame', 'Purchases are not available on this device right now.') : S('restoreFailed', 'Purchases could not be checked now.'); return; } msg.textContent = S('restored', 'Purchases checked.'); ctx.track(reload()); }, e => { ctx.log(e); if (ctx.alive()) msg.textContent = S('restoreFailed', 'Purchases could not be checked now.'); })))), msg);
  }
  return h('section.ea-sec.ea-unlock', { 'aria-label': S('unlockTitle', 'Unlock') }, h('h2.ea-h', null, S('unlockTitle', 'Unlock')), ...kids);
}
/** True when a catalog entry (or a game's { e, gm }) is for sale and this device does not own it. Never throws. */
export function entryLocked(ctx, entry) {
  if (!entry || (entry.e || 'free') === 'free') return false;
  try { const r = ctx.cfg.entitlement ? ctx.cfg.entitlement(entry) : null; return !(r && r.allowed); } catch (e) { ctx.log(e); return true; }
}
export const canPreview = (ctx, entry) => { try { return Boolean(ctx.cfg.payments?.preview?.(entry)); } catch (e) { ctx.log(e); return false; } };

/** A list of short paragraphs as numbered steps or bullets. */
export const steps = (items, ordered) => h(ordered ? 'ol.ea-steps' : 'ul.ea-steps', null, items.map(t => h('li', null, t)));

/** Sources of the pack, short: the first few titles and a button to the full list. */
function sourcesBlock(ctx, info) {
  const { S } = ctx, src = Object.values(info.pack?.data?.sources || {}).filter(s => s && s.title);
  const media = (info.pack?.media?.items || []).filter(m => m.attribution);
  if (!info.pack) return null;
  return section(S('sourcesCredits', 'Sources and credits'),
    src.length ? steps(src.slice(0, 4).map(s => [s.title, s.license].filter(Boolean).join(' · '))) : h('p.ea-note', null, S('noSources', 'No sources are listed for this item.')),
    (src.length > 4 || media.length) ? h('p.ea-note', null, S('moreSources', 'In all: sources {n}, picture credits {m}.', { n: src.length, m: media.length })) : null,
    btn(S('allSources', 'All sources and credits'), () => ctx.go('credits', { pack: info.pack })));
}

/** ABOUT: what the game is, how to play, sources, then the unlock state and Play / Play free preview. */
export function aboutView(ctx) {
  const { S } = ctx, P = ctx.params, box = h('div.ea-slot');
  const load = () => ctx.track(gameInfo(ctx, P.id, P.entry, false).then(info => {
    if (!ctx.alive()) return;
    P.entry = info.entry; ctx.setTitle(info.title);
    const state = unlockState(ctx, info), open = ['free', 'owned', 'pass', 'grace', 'debug'].includes(state), preview = !open && canPreview(ctx, info.entry);
    const e = info.entry, meta = [ctx.domainLabel(e.d), e.df && S('level', 'Level {n} of 5', { n: e.df }), info.pack?.manifest?.minutes && S('minutes', 'About {n} minutes', { n: info.pack.manifest.minutes }),
      info.status === 'not-downloaded' && e.kb && S('downloadSize', 'Download size: {size}.', { size: size(e.kb * 1000) })].filter(Boolean);
    const playBtn = () => btn(open ? S('play', 'Play') : S('playPreview', 'Play free preview…'), () => ctx.go('menu', { id: P.id, entry: e, preview: !open }), '.ea-go');
    const play = open || preview;
    box.replaceChildren(...[
      h('div.ea-hero', null, h('img.ea-icon.ea-big-icon', { src: iconFor(ctx, e), alt: '' }), h('div', null, h('p.ea-sub', null, meta.join(' · ')), play && h('div.ea-chips', null, playBtn()))),
      section(S('whatItIs', 'What it is'), ...(info.what.length ? info.what : [S('whatGeneric', 'A game about {topic}.', { topic: (ctx.domainLabel(e.d) || S('earth', 'the Earth')).toLowerCase() })]).map(t => h('p', null, t)),
        info.ownHowTo && info.describe ? h('p.ea-note', null, info.describe) : null),
      info.howTo.length && section(S('howToPlay', 'How to play'), steps(info.howTo, info.howTo.length > 1)),
      sourcesBlock(ctx, info),
      unlockBlock(ctx, info, state, load),
      play && h('div.ea-chips', null, playBtn()),
    ].filter(Boolean));
  }));
  box.replaceChildren(h('p.ea-note', null, S('loading', 'Loading…')));
  load();
  return { title: P.entry?.t || S('about', 'About'), nodes: [box] };
}

/** The game's MENU: Play, Watch and Learn, Rules, How to play, Sources, Settings, and the best score so far. */
export function menuView(ctx) {
  const { S } = ctx, P = ctx.params, box = h('div.ea-slot');
  ctx.track(gameInfo(ctx, P.id, P.entry, P.preview).then(info => {
    if (!ctx.alive()) return;
    ctx.setTitle(info.title);
    const rec = info.rec, best = scoreOf(S, rec?.best), open = rec && !rec.completed && rec.snapshot !== undefined;
    const base = { id: P.id, entry: info.entry, preview: P.preview };
    const page = (title, items, ordered) => () => ctx.go('info', { title: `${title}: ${info.title}`, items, ordered });
    box.replaceChildren(...[
      h('div.ea-hero', null, h('img.ea-icon', { src: iconFor(ctx, info.entry), alt: '' }), h('div', null,
        P.preview && h('p.ea-msg', null, S('previewOn', 'Free preview')),
        best && h('p.ea-sub', { data: { best: '1' } }, S('bestScore', 'Your best: {score}', { score: best })))),
      h('nav.ea-menu', { 'aria-label': S('gameMenu', 'Game menu') },
        btn(open ? S('continue', 'Continue') : S('play', 'Play'), () => ctx.go('pack', base), '.ea-go'),
        open && btn(S('startOver', 'Start over'), () => ctx.go('pack', { ...base, fresh: true })),
        btn(S('watch', 'Watch and Learn (Auto Play)'), () => ctx.go('pack', { ...base, watch: true })),
        btn(S('rules', 'Rules'), page(S('rules', 'Rules'), info.rules.length ? info.rules : [info.describe || info.title])),
        info.howTo.length > 0 && btn(S('howToPlay', 'How to play'), page(S('howToPlay', 'How to play'), info.howTo, info.howTo.length > 1)),
        info.pack && btn(S('sources', 'Sources'), () => ctx.go('credits', { pack: info.pack })),
        btn(S('tab.settings', 'Settings'), () => ctx.go('settings', {}, { push: true }))),
    ].filter(Boolean));
  }));
  box.replaceChildren(h('p.ea-note', null, S('loading', 'Loading…')));
  return { title: P.entry?.t || S('menu', 'Menu'), nodes: [box] };
}

/** A page of short paragraphs (rules, how to play), opened from the menu. */
export function infoView(ctx) {
  const P = ctx.params;
  return { title: P.title, nodes: [steps(P.items || [], P.ordered)] };
}
