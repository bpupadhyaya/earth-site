// @ts-check
// Optional, quiet ways to play together, all offline (engine/core/share.mjs): the challenge of the day on home, "Enter a code",
// "Challenge a friend" and the score comparison after a result, and the list of sibling apps. Nothing here asks twice, counts
// days in a row or sends anything by itself: the player presses a button, and the system share sheet does the sending.
import { encodeChallenge, decodeChallenge, challengeMatches, challengeText, dailyPick, dayNumber, siblingList, DAILY_KEY } from '../core/share.mjs';
import { h, btn, section } from './dom.mjs';

const SCAN_PAGE = 500, SCAN_PAGES = 200;
const WHY = {
  empty: 'Type or paste the code first.',
  length: 'A code has 16 letters and digits. This one has {n}.',
  characters: 'Codes never use 0, 1, I, L or O. Please check: {bad}',
  checksum: 'That code does not look right. Please check each character and try again.',
  format: 'This code was made by a newer version of the app.',
};
const scoreText = (S, r) => (!Number.isFinite(r?.score) ? '' : Number.isFinite(r.total) ? S('scoreOf', 'Score {score} of {total}', r) : S('scoreOnly', 'Score {score}', r));

/** Home: one card for the challenge of the day. `pool` -> entries that every install has; without a clock there is no card. */
export function dailyCard(ctx, pool) {
  const { S, cfg } = ctx, box = h('div.ea-slot');
  if (cfg.daily === false || !ctx.env.now) return box;
  const day = dayNumber(ctx.now());
  ctx.track(Promise.all([Promise.resolve().then(pool).catch(() => []), ctx.progress.get(DAILY_KEY)]).then(([items, rec]) => {
    const pick = dailyPick((items || []).filter(e => e.downloaded !== false && !e.locked), day);
    if (!pick || !ctx.alive()) return;
    const e = pick.entry, done = rec && rec.day === day && rec.pack === e.id;
    box.replaceChildren(section(S('daily', 'Today'), h('button.ea-item', { type: 'button', data: { daily: e.id }, onclick: () => ctx.go('pack', { id: e.id, entry: e, seed: pick.seed, daily: day }) },
      h('span.ea-name', null, e.t), h('span.ea-sub', null, done ? [S('dailyDone', 'Done today'), scoreText(S, rec)].filter(Boolean).join(' · ') : S('dailyHint', 'The same for everyone today')))));
  }));
  return box;
}

/** The catalog entry a code names, or null. A large catalog injects findPack(tail); otherwise the catalog is read page by page. */
async function findPack(ctx, c) {
  const { cfg } = ctx, hit = items => (items || []).find(e => challengeMatches(c, e.id)) || null;
  if (cfg.findPack) return hit(await cfg.findPack(c.tail));
  for (let cursor = null, i = 0; i < SCAN_PAGES; i++) {
    const r = await ctx.catalog.list({ limit: SCAN_PAGE, cursor, compat: cfg.compat }), e = hit(r.items);
    if (e || r.next == null) return e;
    cursor = r.next;
  }
  return null;
}

/** "Enter a code": type or paste a challenge code; the same pack starts with the same seed. */
export function codeView(ctx) {
  const { S } = ctx, p = ctx.params;
  const input = h('input.ea-in', { type: 'text', id: 'ea-code', value: p.code || '', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', oninput: () => { p.code = input.value; } });
  const msg = h('p', { role: 'alert' });
  const say = text => { msg.textContent = text; };
  function submit(ev) {
    ev.preventDefault();
    const c = decodeChallenge(input.value);
    if (!c.ok) return say(S('code.' + c.reason, WHY[c.reason], { n: c.length, bad: (c.bad || []).join(' ') }));
    say('');
    ctx.track(findPack(ctx, c).then(entry => {
      if (!ctx.alive()) return;
      if (!entry) return say(S('code.unknown', 'This code is for something that is not in this app. Ask your friend which app it came from.'));
      ctx.replace('pack', { id: entry.id, entry, seed: c.seed, rival: c.score });
    }, e => { ctx.log(e); if (ctx.alive()) say(S('loadFailed', 'This could not be loaded.')); }));
  }
  return {
    title: S('enterCode', 'Enter a code'),
    nodes: [h('form.ea-search', { onsubmit: submit }, h('label.ea-field', { for: 'ea-code' }, S('codeLabel', 'Code from a friend'), input), h('button.ea-btn.ea-go', { type: 'submit' }, S('codeStart', 'Start'))),
      msg, h('p.ea-note', null, S('codeHint', 'A code opens what your friend played, starting the same way. It works without a connection and nothing is sent.'))],
  };
}

/**
 * After a result: the comparison with the friend's score (when the play came from a code that carried one) and the
 * "Challenge a friend" button with the place its code appears. @param {any} ctx @param {{ id: string, title: string, seed: string, result: any, rival?: number|null }} o
 * @returns {{ compare: any, share: any, panel: any }} nodes, null when there is nothing to show
 */
export function resultExtras(ctx, o) {
  const { S, cfg, env } = ctx, r = o.result || {}, score = Number.isFinite(r.score) ? r.score : null;
  const compare = o.rival != null && score != null ? section(S('cmp', 'Challenge result'),
    h('p', { role: 'status' }, S('cmp.scores', 'You: {you} · Your friend: {friend}', { you: score, friend: o.rival })),
    h('p.ea-note', null, score > o.rival ? S('cmp.higher', 'You scored higher this time.') : score < o.rival ? S('cmp.lower', 'Your friend scored higher this time.') : S('cmp.same', 'You both got the same score.'))) : null;
  const code = encodeChallenge({ packId: o.id, seed: o.seed, score }), panel = h('div.ea-slot');
  const share = code ? btn(S('challenge', 'Challenge a friend'), () => {
    const text = challengeText({ title: o.title, app: cfg.about?.name || S('appName', 'Earth'), code, score, total: r.total, storeUrl: cfg.storeUrl }, S);
    panel.replaceChildren(h('p', { role: 'status' }, S('challengeCode', 'Code for this play:'), ' ', h('strong', null, code)),
      h('p.ea-note.ea-pre', null, env.share ? S('challengeHow', 'Your friend chooses "Enter a code" in the app and types it.') : text));
    if (env.share) try { env.share(text); } catch (e) { ctx.log(e); }
  }) : null;
  return { compare, share, panel };
}

/** The first completion of the challenge of the day is what home shows as done. */
export async function rememberDaily(ctx, day, id, r) {
  const cur = await ctx.progress.get(DAILY_KEY);
  if (!(cur && cur.day === day)) await ctx.progress.set(DAILY_KEY, { day, pack: id, score: r?.score, total: r?.total, completed: true, at: ctx.now() });
}

/** Sibling apps of the same maker (app description `siblings`) as rows that open the store page; null when there are none. */
export function siblingsSection(ctx, max = 12, from = 0) {
  const all = ctx.env.openLink ? siblingList(ctx.cfg.siblings, ctx.cfg.platform) : [];
  const list = all.slice(from % (all.length || 1)).concat(all).slice(0, Math.min(max, all.length));
  if (!list.length) return null;
  return section(ctx.S('moreFrom', 'More from Earth'), h('ul.ea-list', null, list.map(s => h('li', null, h('button.ea-item', { type: 'button', data: { sibling: s.name }, onclick: () => ctx.env.openLink(s.url) },
    h('span.ea-name', null, s.name), h('span.ea-sub', null, [s.kind, ctx.S('opensStore', 'Opens its store page')].filter(Boolean).join(' · ')))))));
}
