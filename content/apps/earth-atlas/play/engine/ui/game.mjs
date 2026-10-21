// @ts-check
// One game of the app (docs/PRESENTATION-FLOW.md): its ABOUT page (what it is, how to play, progress, unlock, Play), its MENU (Play,
// Continue, Watch and Learn, Learn, Rules, How to play, Settings), the mission picker that Play opens (the game's packs in groups,
// easiest first, with done marks and a "next" suggestion) and the knowledge page (the lessons and quizzes that go with the game,
// in the same three views as home, with search and subject chips). Every list is read one bounded catalog page at a time.
import { h, btn, section } from './dom.mjs';
import { courseOf } from './course.mjs';
import { iconFor } from './icons.mjs';
import { entryItem } from './views.mjs';
import { gameInfo, unlockState, unlockBlock, canPreview, steps, scoreOf } from './flow.mjs';
import { gameById, gameIcon, gameLock, countText, cardTint, uiIcon, freeBadge, MODES } from './gallery.mjs';

const PAGE = 30, MAX_SHOWN = 300, RECENT = 40;
const styleOf = vars => Object.entries(vars).map(([k, v]) => `${k}: ${v}`).join('; ');
/** Easiest first, then by name: the order a player meets the packs of one group. */
const byLevel = (a, b) => (a.df ?? 9) - (b.df ?? 9) || String(a.t).localeCompare(String(b.t)) || (a.id < b.id ? -1 : 1);

/** True when a catalog entry belongs to the game (played or taught in it), by the same filter the catalog uses. */
export function inGame(g, e, learn = false) {
  const f = learn ? g.learnFilter : g.filter;
  if (!f || !e) return false;
  if (f.game && e.gm !== f.game) return false;
  if (f.learn && !(e.gl || []).includes(f.learn)) return false;
  if (f.domain && e.d !== f.domain) return false;
  if (f.template && e.tp !== f.template) return false;
  if (f.tag && !(e.g || []).includes(f.tag)) return false;
  return true;
}

/** The game's representative pack (Watch and Learn, rules of its kind, the unlock state): the one the publisher chose, else the easiest of the first page. */
async function repOf(ctx, g) {
  const r = await ctx.catalog.list({ ...g.filter, limit: 50, compat: ctx.cfg.compat });
  return r.items.find(e => e.id === g.rep) || [...r.items].sort(byLevel)[0] || null;
}

/** Recent play records of this game: how many are finished, and the unfinished one to continue. Bounded by the progress store. */
async function progressOf(ctx, g) {
  const list = (await Promise.resolve(ctx.progress.recent(RECENT)).catch(() => [])) || [];
  const mine = list.filter(r => r.id !== 'daily' && inGame(g, r.entry));
  return { done: mine.filter(r => r.completed).length, open: mine.find(r => !r.completed && r.snapshot !== undefined) || null };
}

/** Straight into play (owner rule 2026-10-16: no picker, quiz or lesson first): the unfinished mission to continue, else the
 * easiest not-yet-finished pack of the game's first group, else its first pack. One bounded catalog page; falls back to the picker. */
async function playNow(ctx, g, preview) {
  if (gameLock(ctx, g)) return ctx.go('game', { id: g.id }); // a game for sale that is not owned: its About with the unlock, never a play or a preview
  try {
    const s = g.sections[0], filter = s ? { ...g.filter, ...(s.tag ? { tag: s.tag } : {}), ...(s.template ? { template: s.template } : {}) } : g.filter;
    const items = [...(await ctx.catalog.list({ ...filter, limit: PAGE, compat: ctx.cfg.compat })).items].sort(byLevel);
    // a saved game keeps the entry it was saved with: resume it only when its template is one the game plays now and its pack still opens
    const plays = new Set(items.map(e => e.tp));
    const open = ((await Promise.resolve(ctx.progress.recent(RECENT)).catch(() => [])) || []).find(r => r.id !== 'daily' && !r.completed && r.snapshot !== undefined && inGame(g, r.entry) && plays.has(r.entry?.tp));
    if (open && ((await Promise.resolve(ctx.packs.open(open.id, preview ? { preview: true } : undefined)).catch(() => ({ status: 'error' }))) || {}).status !== 'error') return ctx.go('pack', { id: open.id, entry: open.entry, preview });
    const marks = await Promise.all(items.map(e => Promise.resolve(ctx.progress.get(e.id)).catch(() => null)));
    const e = items.find((_, i) => !marks[i]?.completed) || items[0];
    if (e) return ctx.go('pack', { id: e.id, entry: e, preview });
  } catch (err) { ctx.log(err); }
  ctx.go('levels', { id: g.id, preview });
}

/** The page frame of a game view: loads the game, then fills `box` (or says that the game is not in this app). */
function gamePage(ctx, title, fill) {
  const { S } = ctx, P = ctx.params, box = h('div.ea-slot');
  box.replaceChildren(h('p.ea-note', null, S('loading', 'Loading…')));
  ctx.track(gameById(ctx, P.id).then(async g => {
    if (!ctx.alive()) return;
    if (!g) { box.replaceChildren(h('p.ea-note', { role: 'alert' }, S('noGame', 'This game is not in this app.'))); return; }
    ctx.setTitle(title(g));
    await fill(g, box);
  }));
  return { title: P.title || S('loadingTitle', 'Game'), nodes: [box] };
}

const hero = (ctx, g, ...kids) => h('div.ea-hero.ea-ghero', { style: styleOf(cardTint(g, -0.12)) }, h('img.ea-gicon.ea-big-icon', { src: gameIcon(ctx, g), alt: '' }), h('div', null, ...kids));
const facts = (ctx, g) => [countText(ctx.S, g), g.learnN ? ctx.S('learnCount', '{n} to learn', { n: g.learnN }) : '', ctx.S('worksOffline', 'Works offline')].filter(Boolean).join(' · ');

/** ABOUT of a game: what it is, how to play, the player's progress, sources and the unlock block, Play (or the free preview). */
export function gameView(ctx) {
  const { S } = ctx, P = ctx.params;
  return gamePage(ctx, g => g.title, async (g, box) => {
    const load = async () => {
      const rep = await repOf(ctx, g).catch(e => { ctx.log(e); return null; });
      const info = rep ? await gameInfo(ctx, rep.id, rep, false) : null;
      const pr = await progressOf(ctx, g);
      if (!ctx.alive()) return;
      const state = info ? unlockState(ctx, info) : 'free', open = ['free', 'owned', 'pass', 'grace', 'debug'].includes(state), preview = !open && info && canPreview(ctx, info.entry);
      const play = () => btn(open ? S('play', 'Play') : S('playPreview', 'Play free preview…'), () => ctx.track(playNow(ctx, g, !open)), '.ea-go');
      const more = () => btn(S('moreOptions', 'Missions, Learn and more'), () => ctx.go('game-menu', { id: g.id, preview: !open }));
      const what = g.about.length ? g.about : info?.what.length ? info.what : [g.tagline || info?.describe || g.title];
      const how = g.howTo.length ? g.howTo : info?.howTo || [];
      box.replaceChildren(...[
        hero(ctx, g, g.free === true && freeBadge(ctx, g), g.tagline && h('p.ea-lead', null, g.tagline), h('p.ea-sub', null, facts(ctx, g)), (open || preview) && h('div.ea-chips', null, play(), more())),
        section(S('whatItIs', 'What it is'), ...what.map(t => h('p', null, t))),
        how.length && section(S('howToPlay', 'How to play'), steps(how, how.length > 1)),
        section(S('yourProgress', 'Your progress'),
          h('p', { data: { progress: g.id } }, Number.isFinite(g.n) ? S('finishedOf', 'Finished: {done} of {n} {unit}', { done: pr.done, n: g.n, unit: g.unit }) : S('finished', 'Finished: {done}', { done: pr.done })),
          pr.open && h('div.ea-chips', null, btn(S('continueTitle', 'Continue: {title}', { title: pr.open.entry?.t || pr.open.title }), () => ctx.go('pack', { id: pr.open.id, entry: pr.open.entry })))),
        info && unlockBlock(ctx, info, state, load, g.title),
        (open || preview) && h('div.ea-chips', null, play()),
      ].filter(Boolean));
    };
    await load();
  });
}

/** The game's MENU: Play (the mission picker), Continue, Watch and Learn, Learn, Rules, How to play, Settings. */
export function gameMenuView(ctx) {
  const { S } = ctx, P = ctx.params;
  return gamePage(ctx, g => g.title, async (g, box) => {
    if (gameLock(ctx, g)) { ctx.replace('game', { id: g.id }); return; }
    const [rep, pr] = await Promise.all([repOf(ctx, g).catch(e => { ctx.log(e); return null; }), progressOf(ctx, g)]);
    let tpl = null;
    try { if (rep?.tp) tpl = await ctx.templates.load(rep.tp); } catch (e) { ctx.log(e); }
    if (!ctx.alive()) return;
    const rules = g.rules.length ? g.rules : (tpl?.rules?.length ? tpl.rules : [tpl?.describe || g.tagline || g.title]);
    const how = g.howTo.length ? g.howTo : tpl?.howTo || [];
    const page = (title, items, ordered) => () => ctx.go('info', { title: `${title}: ${g.title}`, items, ordered });
    box.replaceChildren(
      hero(ctx, g, P.preview && h('p.ea-msg', null, S('previewOn', 'Free preview')), h('p.ea-sub', null, facts(ctx, g))),
      h('nav.ea-menu', { 'aria-label': S('gameMenu', 'Game menu') }, ...[
        btn(S('play', 'Play'), () => ctx.track(playNow(ctx, g, P.preview)), '.ea-go'),
        btn(S('chooseMission', 'Choose a mission'), () => ctx.go('levels', { id: g.id, preview: P.preview })),
        courseOf(g) && btn(S('course.menu', 'Course (optional)'), () => ctx.go('course', { id: g.id })),
        pr.open && btn(S('continueTitle', 'Continue: {title}', { title: pr.open.entry?.t || pr.open.title }), () => ctx.go('pack', { id: pr.open.id, entry: pr.open.entry, preview: P.preview })),
        rep && btn(S('watch', 'Watch and Learn (Auto Play)'), () => ctx.go('pack', { id: rep.id, entry: rep, watch: true, preview: P.preview })),
        g.learnFilter && btn(g.learnN ? S('learnN', 'Learn: {n} lessons and quizzes', { n: g.learnN }) : S('learn', 'Learn'), () => ctx.go('learn', { id: g.id })),
        btn(S('rules', 'Rules'), page(S('rules', 'Rules'), rules)),
        how.length > 0 && btn(S('howToPlay', 'How to play'), page(S('howToPlay', 'How to play'), how, how.length > 1)),
        btn(S('tab.settings', 'Settings'), () => ctx.go('settings', {}, { push: true })),
      ].filter(Boolean)));
  });
}

/** Rows of packs with progress marks. `mark(e)` -> { done, score, open }. */
function packRow(ctx, e, n, st, onPlay) {
  const { S } = ctx;
  const status = st.next ? S('nextUp', 'Next') : st.done ? [S('done', 'Done'), st.score].filter(Boolean).join(' · ') : st.open ? S('inProgress', 'In progress') : '';
  return h('li', null, h('button.ea-item.ea-level', { type: 'button', data: { pack: e.id, state: st.next ? 'next' : st.done ? 'done' : st.open ? 'open' : 'new' }, onclick: () => onPlay(e) },
    h('span.ea-num', { 'aria-hidden': 'true' }, st.done ? '✓' : String(n)),
    h('span.ea-txt', null, h('span.ea-name', null, e.t), h('span.ea-sub', null, [e.df && S('level', 'Level {n} of 5', { n: e.df }), status].filter(Boolean).join(' · ')))));
}
const markOf = async (ctx, e) => { const r = await Promise.resolve(ctx.progress.get(e.id)).catch(() => null); return { done: Boolean(r?.completed), open: Boolean(r && !r.completed && r.snapshot !== undefined), score: scoreOf(ctx.S, r?.best || r?.result) }; };

/** One group of the picker: a bounded catalog query, easiest first, "Show more" continues with the cursor. */
function packGroup(ctx, label, filter, onPlay, state, onFirst) {
  const { S, cfg } = ctx, list = h('ul.ea-list.ea-levels'), more = h('div.ea-slot');
  /** @type {any[]} */ const shown = []; let cursor = /** @type {any} */ (null), n = 0;
  const load = () => ctx.track(Promise.resolve(ctx.catalog.list({ ...filter, limit: PAGE, cursor, compat: cfg.compat })).then(async r => {
    const items = [...r.items].sort(byLevel), marks = await Promise.all(items.map(e => markOf(ctx, e)));
    if (!ctx.alive()) return;
    items.forEach((e, i) => { const st = { ...marks[i], next: !state.next && !marks[i].done }; if (st.next) { state.next = e; onFirst?.(e); } shown.push(e); list.append(packRow(ctx, e, ++n, st, onPlay)); });
    cursor = r.next;
    more.replaceChildren(...(cursor != null && shown.length < MAX_SHOWN ? [btn(S('showMore', 'Show more'), () => { const from = shown.length; more.replaceChildren(); load().then(() => list.children[from]?.children[0]?.focus()); })] : []));
    if (!shown.length) list.replaceChildren(h('li.ea-note', null, S('nothingYet', 'Nothing here yet.')));
  }, e => { ctx.log(e); if (ctx.alive()) more.replaceChildren(h('p.ea-note', { role: 'alert' }, S('loadFailed', 'This could not be loaded.')), btn(S('retry', 'Try again'), () => load())); }));
  load();
  return label ? section(label, list, more) : h('div.ea-sec', null, list, more);
}

/** The mission picker of a game (the menu's Play): its packs in groups, easiest first, done marks and the next one to play. */
export function levelsView(ctx) {
  const { S } = ctx, P = ctx.params;
  return gamePage(ctx, g => S('levelsOf', '{title}: {unit}', { title: g.title, unit: g.unit }), async (g, box) => {
    if (gameLock(ctx, g)) { ctx.replace('game', { id: g.id }); return; }
    const play = e => ctx.go('pack', { id: e.id, entry: e, preview: P.preview });
    const next = h('div.ea-slot.ea-next'), state = { next: null };
    const first = e => next.replaceChildren(h('button.ea-item.ea-nextup', { type: 'button', data: { next: e.id }, style: styleOf(cardTint(g)), onclick: () => play(e) },
      h('span.ea-sub', null, S('playNext', 'Play next')), h('span.ea-name', null, e.t)));
    const groups = g.sections.length ? g.sections.map(s => packGroup(ctx, s.label, { ...g.filter, ...(s.tag ? { tag: s.tag } : {}), ...(s.template ? { template: s.template } : {}) }, play, state, first))
      : [packGroup(ctx, '', g.filter, play, state, first)];
    box.replaceChildren(next, ...groups);
  });
}

/** The knowledge of a game (the menu's Learn): lessons and quizzes in Icons / List / Cards, subject chips and a search. */
export function learnView(ctx) {
  const { S, cfg } = ctx, P = ctx.params, t = ctx.theme();
  const saved = ctx.settings.get().learnView;
  P.mode ||= MODES.some(m => m[0] === saved) ? saved : 'list';
  P.q ??= ''; P.tag ??= ''; P.limit ??= PAGE;
  return gamePage(ctx, g => S('learnOf', 'Learn: {title}', { title: g.title }), async (g, box) => {
    if (gameLock(ctx, g)) { ctx.replace('game', { id: g.id }); return; } // the knowledge of a game for sale is part of the purchase
    if (!g.learnFilter) { box.replaceChildren(h('p.ea-note', null, S('nothingYet', 'Nothing here yet.'))); return; }
    const play = e => ctx.go('pack', { id: e.id, entry: e, learn: g.id });
    const q = h('input.ea-in.ea-q', { type: 'search', id: 'ea-lq', value: P.q, placeholder: S('searchLearn', 'Search lessons and quizzes'), autocomplete: 'off', oninput: () => { P.q = q.value; P.limit = PAGE; draw(); } });
    const search = h('form.ea-search.ea-pill', { role: 'search', onsubmit: ev => ev.preventDefault() }, h('label.ea-vh', { for: 'ea-lq' }, S('searchLearn', 'Search lessons and quizzes')), uiIcon('search', t.muted), q);
    const seg = h('div.ea-views', { role: 'group', 'aria-label': S('showAs', 'Show as') }, MODES.map(([m, fb]) =>
      h('button.ea-ib', { type: 'button', data: { mode: m }, 'aria-pressed': String(P.mode === m), onclick: () => { P.mode = m; ctx.settings.set({ learnView: m }); for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.mode === m)); draw(); } },
        uiIcon(m, t.fg), h('span.ea-vh', null, S('view.' + m, fb)))));
    const chips = g.learnSections.length ? h('div.ea-chips.ea-subjects', { role: 'group', 'aria-label': S('subjects', 'Subjects') },
      [{ label: S('allSubjects', 'All'), tag: '' }, ...g.learnSections].map(s => h('button.ea-btn.ea-chip', { type: 'button', 'aria-pressed': String(P.tag === (s.tag || '')), data: { tag: s.tag || '' },
        onclick: ev => { P.tag = s.tag || ''; P.limit = PAGE; for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.tag === P.tag)); draw(); } }, s.label))) : null;
    const list = h('div.ea-slot'), count = h('p.ea-note', { role: 'status' });
    let seq = 0;
    const kind = e => (/quiz|truefalse|match/.test(e.tp) ? S('kind.quiz', 'Quiz') : /lesson|flashcards/.test(e.tp) ? S('kind.lesson', 'Lesson') : '');
    const tile = e => h('li', null, h('button.ea-tile', { type: 'button', data: { pack: e.id }, onclick: () => play(e) }, h('img.ea-gicon', { src: iconFor(ctx, e), alt: '' }), h('span.ea-name', null, e.t)));
    const wide = e => h('li.ea-wide', { data: { pack: e.id }, style: styleOf(cardTint(g, 0.12)) },
      h('button.ea-wmain', { type: 'button', onclick: () => play(e) }, h('img.ea-gicon', { src: iconFor(ctx, e), alt: '' }),
        h('span.ea-txt', null, h('span.ea-name', null, e.t), h('span.ea-facts', null, [kind(e), e.df && S('level', 'Level {n} of 5', { n: e.df })].filter(Boolean).join(' · ')))),
      h('button.ea-round', { type: 'button', 'aria-label': S('playGame', 'Play {title}', { title: e.t }), onclick: () => play(e) }, uiIcon('play', '#0b1720', true), h('span.ea-vh', null, S('play', 'Play'))));
    /** pages read so far for the current subject (no query) */
    let st = { key: '', acc: /** @type {any[]} */ ([]), cursor: /** @type {any} */ (null), end: false };
    function draw() {
      const mine = ++seq, query = P.q.trim(), f = { ...g.learnFilter, ...(P.tag ? { tag: P.tag } : {}), compat: cfg.compat };
      if (st.key !== P.tag) st = { key: P.tag, acc: [], cursor: null, end: false };
      const s0 = st;
      const job = query ? Promise.resolve(ctx.catalog.search(query, { ...f, limit: P.limit + 1 })).then(r => ({ items: r.items.slice(0, P.limit), more: r.items.length > P.limit }))
        : (async () => { while (s0.acc.length < P.limit && !s0.end) { const r = await ctx.catalog.list({ ...f, limit: P.limit - s0.acc.length, cursor: s0.cursor }); s0.acc.push(...r.items); s0.cursor = r.next; s0.end = r.next == null; } return { items: s0.acc.slice(0, P.limit), more: !s0.end }; })();
      return ctx.track(job.then(r => {
        if (mine !== seq || !ctx.alive()) return;
        const items = r.items;
        count.textContent = !items.length ? S('noResults', 'Nothing found. Try a shorter word or another topic.') : r.more ? S('shownMore', '{n} shown, more available', { n: items.length }) : S('shown', '{n} shown', { n: items.length });
        list.replaceChildren(...[
          P.mode === 'icons' ? h('ul.ea-gallery.ea-small', null, items.map(tile)) : P.mode === 'list' ? h('ul.ea-list', null, items.map(e => entryItem(ctx, e, 'pack', { learn: g.id }))) : h('ul.ea-wides', null, items.map(wide)),
          r.more && P.limit < MAX_SHOWN && btn(S('showMore', 'Show more'), () => { P.limit += PAGE; draw(); })].filter(Boolean));
      }, e => { ctx.log(e); if (mine === seq && ctx.alive()) list.replaceChildren(h('p.ea-note', { role: 'alert' }, S('loadFailed', 'This could not be loaded.')), btn(S('retry', 'Try again'), () => draw())); }));
    }
    box.replaceChildren(...[h('div.ea-learnbar', null, search, seg), chips, count, list].filter(Boolean));
    draw();
  });
}
