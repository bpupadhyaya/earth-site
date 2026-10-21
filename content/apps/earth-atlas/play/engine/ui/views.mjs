// @ts-check
// Chrome views: catalog browser (search inside every game), downloads, settings, sources (home: gallery.mjs). A view is a function (ctx) -> { title, nodes, dispose? };
// ctx is built by app.mjs. Views ask for one page of data at a time and render whatever arrives; a failed load shows a retry.
import { THEME_NAMES } from './themes.mjs';
import { h, btn, size, meter, section } from './dom.mjs';
import { siblingsSection } from './growth.mjs';
import { iconFor } from './icons.mjs';

const PAGE = 20, MAX_SHOWN = 200;

/** Fill `box` from an async source: loading note, then the rendered result, or a message with a retry button. */
function load(ctx, box, fn, render) {
  const run = () => {
    box.replaceChildren(h('p.ea-note', null, ctx.S('loading', 'Loading…')));
    return ctx.track(Promise.resolve().then(fn).then(
      v => { if (ctx.alive()) box.replaceChildren(...[render(v)].flat().filter(Boolean)); },
      e => { ctx.log(e); if (ctx.alive()) box.replaceChildren(h('p.ea-note', { role: 'alert' }, ctx.S('loadFailed', 'This could not be loaded.')), btn(ctx.S('retry', 'Try again'), run)); }));
  };
  return run();
}

/** The first sentence of a description, cut before a comma or colon when it is long (rows stay one short line of meaning). */
const oneLine = d => { let t = String(d).split(/(?<=\.)\s/)[0]; if (t.length > 90) { let k = t.lastIndexOf(':', 90); if (k < 30) k = t.lastIndexOf(',', 90); if (k > 30) t = t.slice(0, k) + '.'; } return t; };

/** One catalog entry as a list row: name, a one-line description when there is one, topic, level and size. Opens About (or `to`). */
export function entryItem(ctx, e, to = 'about', extra = {}) {
  const bits = [ctx.domainLabel(e.d), e.df && ctx.S('level', 'Level {n} of 5', { n: e.df }), e.kb && size(e.kb * 1000)].filter(Boolean);
  const line = h('span.ea-sub.ea-line', null, e.s || '');
  if (!e.s && e.tp && to === 'about') ctx.track(Promise.resolve().then(() => ctx.templates.load(e.tp)).then(t => { if (t?.describe) line.textContent = oneLine(t.describe); }, () => {}));
  return h('li', null, h('button.ea-item', { type: 'button', data: { pack: e.id }, onclick: () => ctx.go(to, { id: e.id, entry: e, ...extra }) },
    h('img.ea-icon.ea-mini', { src: iconFor(ctx, e), alt: '' }), h('span.ea-txt', null, h('span.ea-name', null, e.t), line, h('span.ea-sub.ea-meta', null, bits.join(' · ')))));
}

const tagWord = t => { const w = String(t).replace(/[-_]+/g, ' ').trim(); return w ? w[0].toUpperCase() + w.slice(1) : String(t); };

export function browseView(ctx) {
  const { S, cfg, catalog } = ctx, p = ctx.params;
  p.q ??= ''; p.domain ??= ''; p.tag ??= ''; p.region ??= ''; p.template ??= ''; p.limit ??= PAGE;
  let seq = 0, key = '';
  /** pages fetched so far for the current filter (browsing without a query uses the catalog cursor) */
  let st = { acc: /** @type {any[]} */ ([]), cursor: /** @type {string|null} */ (null), end: false };
  const reset = () => { p.limit = PAGE; refresh(); };
  const input = h('input.ea-in', { type: 'search', id: 'ea-q', value: p.q, oninput: () => { p.q = input.value; reset(); } });
  const cats = cfg.categories || [];
  // a category is a domain, or (with `tag`) a tag inside a domain
  const catOf = id => cats.find(c => c.id === id);
  const pick = () => { const c = catOf(sel.value); p.domain = c ? (c.tag ? c.domain || '' : c.id) : ''; p.tag = c && c.tag ? c.tag : ''; reset(); };
  const sel = cats.length ? h('select.ea-in', { id: 'ea-d', onchange: pick }, h('option', { value: '' }, S('allTopics', 'All topics')), cats.map(c => h('option', { value: c.id }, c.label))) : null;
  if (sel) sel.value = (cats.find(c => (c.tag ? c.tag === p.tag && (c.domain || '') === p.domain : !p.tag && c.id === p.domain)) || { id: '' }).id;
  const tagBox = h('div.ea-slot'), count = h('p.ea-note', { role: 'status' }), list = h('ul.ea-list'), more = h('div.ea-slot');

  function refresh(focusFrom = -1) {
    const mine = ++seq, q = p.q.trim();
    const f = { domain: p.domain || undefined, tag: p.tag || undefined, region: p.region || undefined, template: p.template || undefined, compat: cfg.compat };
    const k = JSON.stringify([q, p.domain, p.tag, p.region, p.template]);
    if (k !== key) { key = k; st = { acc: [], cursor: null, end: false }; }
    const mySt = st;
    tagBox.replaceChildren(...[p.tag && btn(S('removeFilter', 'Showing: {tag}. Remove this filter', { tag: (cats.find(c => c.tag === p.tag)?.label) || p.tag.replace(/[-_]+/g, ' ') }), () => { p.tag = ''; reset(); }, '.ea-chip'),
      p.region && btn(S('removeFilter', 'Showing: {tag}. Remove this filter', { tag: tagWord(p.region) }), () => { p.region = ''; reset(); }, '.ea-chip'),
      p.template && btn(S('removeFilter', 'Showing: {tag}. Remove this filter', { tag: tagWord(p.template.split('/')[1] || p.template) }), () => { p.template = ''; reset(); }, '.ea-chip')].filter(Boolean));
    const job = q
      ? Promise.resolve(catalog.search(q, { ...f, limit: p.limit + 1 })).then(r => ({ items: r.items.slice(0, p.limit), more: r.items.length > p.limit }))
      : (async () => {
        while (mySt.acc.length < p.limit && !mySt.end) { const r = await catalog.list({ ...f, limit: p.limit - mySt.acc.length, cursor: mySt.cursor }); mySt.acc.push(...r.items); mySt.cursor = r.next; mySt.end = r.next === null; }
        return { items: mySt.acc, more: !mySt.end };
      })();
    return ctx.track(job.then(r => {
      if (mine !== seq || !ctx.alive()) return;
      list.replaceChildren(...r.items.map(e => entryItem(ctx, e)));
      count.textContent = !r.items.length ? S('noResults', 'Nothing found. Try a shorter word or another topic.')
        : r.more ? S('shownMore', '{n} shown, more available', { n: r.items.length }) : S('shown', '{n} shown', { n: r.items.length });
      more.replaceChildren(...(!r.more ? [] : p.limit >= MAX_SHOWN ? [h('p.ea-note', null, S('refine', 'Add a word or choose a topic to narrow the list.'))]
        : [btn(S('showMore', 'Show more'), () => { const from = r.items.length; more.replaceChildren(); p.limit += PAGE; refresh(from); })]));
      if (focusFrom >= 0) list.children[focusFrom]?.children[0]?.focus();
    }, e => {
      ctx.log(e); if (mine !== seq || !ctx.alive()) return;
      list.replaceChildren(); count.textContent = S('loadFailed', 'This could not be loaded.'); more.replaceChildren(btn(S('retry', 'Try again'), () => refresh()));
    }));
  }
  refresh();
  return {
    title: S('tab.browse', 'Browse'),
    nodes: [h('form.ea-search', { role: 'search', onsubmit: ev => ev.preventDefault() },
      h('label.ea-field', { for: 'ea-q' }, S('searchLabel', 'Search by name, place or topic'), input),
      sel && h('label.ea-field', { for: 'ea-d' }, S('topic', 'Topic'), sel)), tagBox, count, list, more],
  };
}

export function downloadsView(ctx) {
  const { S, packs } = ctx;
  const box = h('div.ea-slot');
  let shown = PAGE;
  const run = (fn, done) => ctx.track(Promise.resolve().then(fn).then(() => { if (ctx.alive()) { ctx.announce(done); draw(); } }, e => { ctx.log(e); if (ctx.alive()) ctx.announce(S('actionFailed', 'That did not work. Please try again.')); }));
  function row(it) {
    const state = it.status === 'downloading' ? S('downloading', 'Downloading…') : it.pinned ? S('kept', 'Kept on this device') : S('removable', 'May be removed when space is needed');
    const remove = btn(S('remove', 'Remove'), () => {
      if (remove.dataset.sure) return run(() => packs.evict(it.id), S('removed', 'Removed'));
      remove.dataset.sure = '1'; remove.textContent = S('removeSure', 'Remove {title}? Press again to confirm', { title: it.title || it.id });
    });
    return h('li.ea-row', { data: { pack: it.id } },
      h('span', null, h('span.ea-name', null, it.title || it.id), ' ', h('span.ea-sub', null, [size(it.bytes), state].join(' · '))),
      h('div.ea-chips', null,
        btn(S('open', 'Open'), () => ctx.go('pack', { id: it.id, entry: it.entry })),
        it.pinned ? packs.unpin && btn(S('unpin', 'Stop keeping'), () => run(() => packs.unpin(it.id), S('unpinned', 'No longer kept')))
          : btn(S('pin', 'Keep on this device'), () => run(() => packs.pin(it.id), S('pinned', 'Kept on this device'))),
        remove));
  }
  const draw = () => load(ctx, box, () => packs.usage(), u => {
    const items = u.items || [], m = meter(S('storageUsed', 'Storage used'));
    if (u.budget) m.set(u.bytes / u.budget);
    return [
      h('p', { role: 'status' }, u.budget ? S('usedOf', '{used} used of {budget}', { used: size(u.bytes), budget: size(u.budget) }) : S('used', '{used} used', { used: size(u.bytes) })),
      u.budget && m.el,
      ctx.settings.get().lowData && h('p.ea-note', null, S('lowDataOn', 'Low data mode is on: pictures and sound are not downloaded.')),
      items.length ? h('ul.ea-list', null, items.slice(0, shown).map(row)) : h('p.ea-note', null, S('noDownloads', 'Nothing extra is downloaded. Everything this app needs is already installed; anything you download later is kept here.')),
      items.length > shown && btn(S('showMore', 'Show more'), () => { shown += PAGE; draw(); }),
    ];
  });
  draw();
  return { title: S('tab.downloads', 'Downloads'), nodes: [box] };
}

/** Developer builds only (cfg.debug from shells/web/debug-unlock.mjs): the switch that unlocks every game for testing. */
function debugSwitch(ctx) {
  const { S, cfg } = ctx, d = cfg.debug;
  const box = h('input.ea-check', { type: 'checkbox', role: 'switch', id: 'ea-debug-unlock', checked: Boolean(d.unlockAll()), onchange: () => ctx.track(Promise.resolve(d.set?.(Boolean(box.checked)))) });
  return h('label.ea-row', null, h('span', null, S('debug.label', 'Developer: unlock all games (testing only)'), ' ', h('span.ea-sub', null, S('debug.hint', 'Opens every paid game on this device without a purchase. Not in store builds.'))), box);
}

export function settingsView(ctx) {
  const { S, cfg, settings } = ctx;
  const cur = () => Math.round(100 * Math.min(3, Math.max(1, Number(settings.get().textZoom) || 1)));
  const out = h('strong', { 'aria-live': 'polite' });
  const range = h('input.ea-range', { type: 'range', id: 'ea-zoom', min: '100', max: '300', step: '10', 'aria-label': S('textSize', 'Text size'), oninput: () => setZoom(Number(range.value)) });
  function setZoom(pct) { settings.set({ textZoom: Math.min(300, Math.max(100, pct)) / 100 }); sync(); }
  function sync() { const v = cur(); range.value = String(v); range.setAttribute('aria-valuetext', v + '%'); out.textContent = v + '%'; }
  const toggle = (key, label, hint) => {
    const box = h('input.ea-check', { type: 'checkbox', role: 'switch', checked: Boolean(settings.get()[key]), onchange: () => settings.set({ [key]: Boolean(box.checked) }) });
    return h('label.ea-row', null, h('span', null, label, ' ', h('span.ea-sub', null, hint)), box);
  };
  const theme = h('select.ea-in', { id: 'ea-theme', onchange: () => settings.set({ theme: theme.value }) }, THEME_NAMES.map(n => h('option', { value: n }, S('theme.' + n, n[0].toUpperCase() + n.slice(1)))));
  theme.value = settings.get().theme || cfg.theme?.preset || 'dawn';
  const hand = h('select.ea-in', { id: 'ea-handed', onchange: () => settings.set({ handed: hand.value }) },
    [['right', S('handedRight', 'Right hand')], ['left', S('handedLeft', 'Left hand')]].map(([v, t]) => h('option', { value: v }, t)));
  hand.value = settings.get().handed === 'left' ? 'left' : 'right';
  // the stick-side choice only matters in an app that has a flight or fly template (all templates count when the app does not say)
  const flying = !cfg.compat || Object.keys(cfg.compat).some(id => /^(flight|fly)\//.test(id));
  const store = h('div.ea-slot');
  load(ctx, store, () => ctx.packs.usage(), u => h('p.ea-note', null, u.budget ? S('usedOf', '{used} used of {budget}', { used: size(u.bytes), budget: size(u.budget) }) : S('used', '{used} used', { used: size(u.bytes) })));
  sync();
  return {
    title: S('tab.settings', 'Settings'),
    nodes: [
      section(S('textSize', 'Text size'), h('div.ea-row', null, h('span', null, S('textSizeHint', 'From 100% to 300%. Every screen scrolls.')), out,
        range, h('div.ea-chips', null, btn(S('smaller', 'Smaller text'), () => setZoom(cur() - 25)), btn(S('larger', 'Larger text'), () => setZoom(cur() + 25))))),
      section(S('comfort', 'Comfort'),
        toggle('reducedMotion', S('reducedMotion', 'Reduce motion'), S('reducedMotionHint', 'Turns off transitions and gentle movement.')),
        toggle('lowData', S('lowData', 'Low data mode'), S('lowDataHint', 'Skips pictures and sound. Everything still works with text.')),
        h('label.ea-field', { for: 'ea-theme' }, S('colours', 'Colours'), theme),
        flying && h('label.ea-field', { for: 'ea-handed' }, S('handed', 'Flight controls: stick side'), hand)),
      cfg.debug && section(S('debug.title', 'Developer'), debugSwitch(ctx)),
      section(S('storage', 'Storage'), store, cfg.downloads !== false && btn(S('manage', 'Manage downloads'), () => ctx.go('downloads'))),
      section(S('about', 'About'), cfg.about && h('p.ea-note', null, [cfg.about.name, cfg.about.version].filter(Boolean).join(' ')), btn(S('credits', 'Sources and credits'), () => ctx.go('credits'))),
      siblingsSection(ctx),
    ].filter(Boolean),
  };
}

/** Sources of one pack (params.pack, plus citations seen while playing) or, without a pack, the credits of the app. */
export function creditsView(ctx) {
  const { S, cfg, env } = ctx, { pack, cites = [] } = ctx.params;
  const link = (title, url) => (url ? h('a', { href: url, target: '_blank', rel: 'noopener', onclick: ev => { if (env.openLink) { ev.preventDefault(); env.openLink(url); } } }, title) : title);
  const item = (title, url, ...sub) => h('li.ea-row', null, h('span', null, h('span.ea-name', null, link(title, url)), ' ', h('span.ea-sub', null, sub.filter(Boolean).join(' · '))));
  const nodes = [];
  if (pack) {
    const src = new Map();
    for (const [id, s] of Object.entries(pack.data?.sources || {})) if (s && s.title) src.set(id, s);
    for (const c of cites) if (!src.has(c.id)) src.set(c.id, c);
    const media = (pack.media?.items || []).filter(m => m.attribution);
    if (src.size) nodes.push(section(S('facts', 'Facts and data'), h('ul.ea-list', null, [...src.values()].map(s => item(s.title, s.url, s.license, s.asOf && S('asOf', 'as of {date}', { date: s.asOf }))))));
    if (media.length) nodes.push(section(S('media', 'Pictures and sound'), h('ul.ea-list', null, media.map(m => item(m.attribution, m.sourceUrl, m.author, m.license)))));
    if (!nodes.length) nodes.push(h('p.ea-note', null, S('noSources', 'No sources are listed for this item.')));
  } else {
    const list = cfg.credits || [];
    nodes.push(h('p.ea-note', null, S('creditsIntro', 'Every fact in this app names its source. Open any item and choose Sources to see them.')));
    if (list.length) nodes.push(section(S('usedHere', 'Data and media used in this app'), h('ul.ea-list', null, list.map(c => item(c.title, c.url, c.license, c.note)))));
  }
  return { title: pack ? S('sourcesFor', 'Sources: {title}', { title: pack.manifest?.title || '' }) : S('credits', 'Sources and credits'), nodes };
}
