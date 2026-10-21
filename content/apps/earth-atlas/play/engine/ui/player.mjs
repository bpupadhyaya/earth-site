// @ts-check
// Pack player host. Opens a pack through the injected pack store, shows the download state when it is not on the device, runs the
// template instance, draws its screens with render-dom, and owns the canvas and the frame loop of real-time `world` screens.
//
// Frame loop (only while the current screen has a world handle or the template has tick()): tick(dt) -> screen() ->
// renderer.frame(world, body). The DOM is rebuilt only when heading or buttons change; ticking text (clocks, instruments) is
// refreshed at most twice a second in place, so focus and a press in flight are never lost.
// Budget: host work per frame, outside the template and the renderer, stays under 0.25 ms (measured in tests/app.test.mjs).
import { createEnv } from '../core/env.mjs';
import { guardInstance } from '../core/template.mjs';
import { renderScreen, updateScreen } from './render-dom.mjs';
import { h, btn, size, meter } from './dom.mjs';
import { entryItem } from './views.mjs';
import { gameOf } from './gallery.mjs';
import { plateSrc } from './scene-plate.mjs';
import { playSeed, dayNumber } from '../core/share.mjs';
import { createFlightControls } from './controls.mjs';
import { createHud } from './flight-hud.mjs';
import { resultExtras, rememberDaily, siblingsSection } from './growth.mjs';
import { availableActions } from '../core/screen.mjs';

const WAIT = {
  offline: 'You are offline. The download starts when a connection is available.',
  metered: 'Waiting for Wi-Fi before downloading.',
  'low-data': 'Low data mode is on, so this was not downloaded.',
};
const BODY_MS = 500;
/** A picture-game screen draws its own map: no stock picture above it. */
const hasAtlas = s => Boolean(s?.body?.some(b => b.atlas));

/** Watch and Learn: one step of the template's own player every this many ms (turn-based, real-time), at most this many steps. */
const WATCH_MS = [1600, 300], WATCH_MAX = 4000;
/** What decides a rebuild: heading and controls. */
const controls = s => JSON.stringify([s.kind, s.title, s.choices, s.actions, s.citations, Boolean(s.world)]);
const ticking = s => JSON.stringify([s.body, s.progress]);

export function playerView(ctx) {
  const { S, cfg, env, packs, progress } = ctx, P = ctx.params, id = P.id;
  const raf = env.raf || (typeof globalThis.requestAnimationFrame === 'function' ? cb => globalThis.requestAnimationFrame(cb) : null);
  const caf = env.caf || (typeof globalThis.cancelAnimationFrame === 'function' ? i => globalThis.cancelAnimationFrame(i) : () => {});
  /** @type {any} */ let entry = ctx.params.entry || null;
  /** @type {any} */ let pack = null, tpl = null, inst = null, renderer = null, dl = null, off = null, rafId = 0;
  let sig = '', bodySig = '', lastBody = 0, last = 0, seq = 0, plays = 0, seed = '', canvasW = 0, canvasH = 0;
  let loop = false, paused = false, done = false, acted = false, drawn = false;
  // Watch and Learn (params.watch): the template's autoplay() or oracle('correct') presses for the player; nothing is recorded
  const watching = Boolean(P.watch);
  let wPaused = false, wSteps = 0, wLast = 0, wSay = '';
  /** @type {any} */ let wControls = null, best = undefined;
  /** The template's durable record (its progress()), as last stored or last read from the store; undefined when there is none. */
  /** @type {any} */ let durable;
  const seen = new Map();
  const canvas = h('canvas.ea-world', { hidden: true, role: 'img' });
  const stage = h('div.ea-stage', { inert: watching }), after = h('div.ea-after');
  // optional picture panel above the game screen (never behind text; engine/ui/scene-plate.mjs)
  const plateImg = h('img', { alt: '', decoding: 'async', loading: 'lazy' }), plate = h('figure.ea-plate', { hidden: true, 'aria-hidden': 'true' }, plateImg);
  let plateOn = false;
  const narr = h('p.ea-narr', { role: 'status', 'aria-live': 'polite' }, S('watchIntro', 'The game plays itself, one calm step at a time. Watch, then try it yourself.'));
  const pauseBtn = btn(S('pause', 'Pause'), () => { wPaused = !wPaused; pauseBtn.textContent = wPaused ? S('goOn', 'Go on') : S('pause', 'Pause'); if (!wPaused) { wLast = ctx.now(); loop = true; schedule(); } });
  const watchBar = h('section.ea-watch', { hidden: !watching, 'aria-label': S('watch', 'Watch and Learn (Auto Play)') }, narr, h('div.ea-chips', null, pauseBtn, btn(S('stopWatching', 'Stop watching'), () => ctx.back())));
  // flight input for world screens: shown when the screen's world handle asks for controls or has a pending pick
  const fc = createFlightControls({ canvas, pick: (x, y) => (renderer && renderer.pick ? renderer.pick(x, y) : null), strings: S, settings: { handed: ctx.settings.get().handed } });
  const offSettings = ctx.settings.subscribe ? ctx.settings.subscribe(v => fc.settings({ handed: v.handed })) : null;
  const srcBtn = h('button.ea-btn', { type: 'button', hidden: true, onclick: () => ctx.go('credits', { pack, cites: [...seen.values()] }) }, S('sources', 'Sources'));
  // the flight screen: while a real-time flight world is shown the canvas is the whole display and the rest is overlay (flight-hud.mjs)
  let flying = false, drawer = false, pickShown = '', layout = null, relayoutAt = 0;
  const setDrawer = open => { drawer = open === undefined ? !drawer : Boolean(open); hud.setOpen(drawer); if (flying) ctx.fly(true, drawer); };
  const pausePress = () => { const a = pauseAction(); if (a) act(a.id); };
  const hud = createHud({ S, back: () => ctx.back(), menu: setDrawer, pause: pausePress });
  let lastScreen = null;
  const pauseAction = () => (lastScreen && lastScreen.actions || []).find(a => a.id === 'pause') || null;
  const title = () => entry?.t || pack?.manifest?.title || S('thisItem', 'This item');
  const opts = () => ({ theme: pack.theme, onAct: act, strings: S });

  /** Show the flight controls and the pick buttons the screen asks for (rebuilt only when the request changes). */
  const wire = (s, on) => { on = on && !watching && inst && inst.raw.input; fc.configure(on ? s.world.controls : null, on ? s.world.pick : null); };

  /** A plain message screen (loading, download, problem) in place of the pack screen. */
  function state(text, ...kids) {
    stop(); dl = null; drawn = false; canvas.hidden = true; fc.configure(null); after.replaceChildren(); fly(false);
    const head = h('h1.ea-h', { tabIndex: -1 }, title());
    stage.replaceChildren(h('section.ea-state', null, head, h('p', { role: 'status' }, text), ...kids));
    return head;
  }
  const problem = e => { ctx.log(e); inst = null; state(S('openFailed', 'This item could not be opened.'), btn(S('retry', 'Try again'), open), btn(S('back', 'Back'), () => ctx.back())); };
  const watch = () => { if (!off && packs.watch) off = packs.watch(id, () => { if (ctx.alive() && !inst) open(); }); };

  /** Enter or leave the flight screen; the host app root carries the class that puts the canvas under everything. */
  function fly(on) {
    if (on === flying) return;
    flying = on; if (!on) { drawer = false; hud.setOpen(false); layout = null; }
    ctx.fly(on, drawer);
    if (on) relayout(true);
  }
  /** Which part of the picture is free for instruments: measured from the controls where they are now. */
  function relayout(force) {
    if (!flying) return;
    const t = ctx.now();
    if (!force && t - relayoutAt < 400) return;
    relayoutAt = t;
    const vw = globalThis.innerWidth || canvas.clientWidth || 640, vh = globalThis.innerHeight || canvas.clientHeight || 400;
    const q = sel => fc.el.querySelector ? fc.el.querySelector(sel) : null;
    layout = { redock: true, ...hud.layout(['.ea-fc-g-throttle', '.ea-fc-g-trim', '.ea-fc-g-yaw', '.ea-fc-stick', '.ea-fc-btns'].map(q), vw, vh) };
  }
  /** Is this a screen to fly: a real-time flight world with the host's flight controls (step-by-step play keeps the ordinary page). */
  const NOT_FLYING = ['brief', 'briefing', 'intro', 'debrief', 'result', 'pad'];
  const isFlight = s => Boolean(s && s.world && cfg.render && s.world.mode === 'flight' && s.world.controls && !NOT_FLYING.includes(s.kind) && inst && inst.raw.input && !(s.meta && s.meta.mode === 'stepped'));

  function open() {
    const mine = ++seq;
    return ctx.track((async () => {
      /** @type {any} */ let r;
      try { r = await packs.open(id, P.preview ? { preview: true } : undefined); } catch (e) { ctx.log(e); r = { status: 'error' }; }
      if (!ctx.alive() || mine !== seq || inst) return;
      if (r.status === 'ready' && r.pack) { const fresh = Boolean(P.fresh || watching); P.fresh = false; return start(r.pack, fresh); }
      if (r.status === 'downloading') {
        watch();
        if (!dl) { const m = meter(S('downloadProgress', 'Download progress')); state(S('downloading', 'Downloading…'), m.el, btn(S('checkAgain', 'Check again'), open)); dl = m; }
        return dl.set(r.progress);
      }
      if (r.status === 'not-downloaded') return state(S('notDownloaded', 'This item is not on this device yet.') + (entry?.kb ? ' ' + S('downloadSize', 'Download size: {size}.', { size: size(entry.kb * 1000) }) : ''), btn(S('download', 'Download'), request, '.ea-go'));
      if (r.status === 'locked') return state(S('locked', 'This item is not unlocked on this device.'), (cfg.onLocked || entry?.gm || entry?.gl) && btn(S('seeOptions', 'See options'), () => (cfg.onLocked ? cfg.onLocked(entry || { id }) : ctx.replace('about', { id, entry }))));
      problem(r.error || r.status);
    })());
  }

  function request() {
    return ctx.track((async () => {
      /** @type {any} */ let r;
      try { r = await packs.request(id); } catch (e) { return problem(e); }
      if (!ctx.alive()) return;
      if (r && r.accepted === false && WAIT[r.reason]) { watch(); state(S('wait.' + r.reason, WAIT[r.reason]), btn(S('checkAgain', 'Check again'), open)).focus(); return; }
      await open();
      if (!inst) stage.querySelector('h1')?.focus();
    })());
  }

  async function start(pk, fresh) {
    pack = pk; if (off) { off(); off = null; }
    entry = entry || { id, t: pk.manifest.title, tp: pk.manifest.template, d: pk.manifest.domain, g: pk.manifest.tags };
    ctx.track(gameOf(ctx, entry).then(g => { const src = plateSrc(ctx, g, id); if (src && ctx.alive() && pk.manifest.template !== 'play/atlas') { plateImg.src = src; plateOn = true; plate.hidden = Boolean(lastScreen?.world) || hasAtlas(lastScreen); } }).catch(() => {}));
    ctx.setTitle(watching ? S('watchTitle', 'Watch and Learn: {title}', { title: title() }) : title()); srcBtn.hidden = false;
    try {
      tpl = tpl || await ctx.templates.load(pk.manifest.template);
      // params.kept: this view was left for another one (sources) and is being returned to; otherwise resume an unfinished play
      const kept = fresh ? null : ctx.params.kept;
      ctx.params.kept = null;
      const stored = await progress.get(id), rec = fresh ? null : kept || stored;
      if (!ctx.alive()) return;
      if (durable === undefined && stored && stored.durable !== undefined) durable = stored.durable;
      if (best === undefined) best = stored?.best || null;
      // params.seed: a play from a code or the challenge of the day starts from that seed; another unfinished play is not resumed
      const resume = Boolean(rec && rec.snapshot !== undefined && (kept || (!rec.completed && (P.seed == null || rec.seed === P.seed))));
      if (resume && !kept && P.seed == null && (rec.rival != null || rec.daily != null)) Object.assign(P, { seed: rec.seed, rival: rec.rival, daily: rec.daily });
      const fresh1 = () => P.seed ?? playSeed(`${ctx.now()}-${++plays}`);
      const make = () => guardInstance(tpl.create(pk, { ...createEnv({ seed, now: ctx.now, settings: ctx.settings.get() }), services: cfg.services || {}, strings: (k, fb) => S(k, fb), log: ctx.log,
        // the durable record of earlier plays of this pack (a copy: the template may keep and change it)
        progress: { record: durable === undefined ? null : JSON.parse(JSON.stringify(durable)) } }), { strict: false });
      seed = resume ? rec.seed : fresh1();
      inst = make();
      if (resume) try { inst.restore(rec.snapshot); } catch (e) { ctx.log(e); seed = fresh1(); inst = make(); }
      done = false; acted = kept ? kept.acted : resume; drawn = false; after.replaceChildren(); last = wLast = ctx.now(); wSteps = 0;
      draw(true);
    } catch (e) { problem(e); }
  }

  function act(actionId) {
    if (!inst) return;
    try { inst.act(actionId); } catch (e) { ctx.log(e); }
    const was = done;
    acted = true; draw(true);
    if (inst && (was || !done)) save();          // finish() has stored the record when this press completed the play
  }

  /** Keep the play record current so that "Continue" resumes here. The snapshot is taken now; the store may write later. */
  function put(rec) { if (watching) return; ctx.track(Promise.resolve().then(() => progress.set(id, { title: title(), entry, at: ctx.now(), ...rec, ...(best ? { best } : {}) }))); }
  /** The durable record now: the template's progress(), or what earlier plays left when it has none yet. */
  const keep = () => { const d = inst.progress(); if (d !== undefined) durable = d; return durable === undefined ? {} : { durable }; };
  /** After an action, and when the player leaves. A play that goes on after it is complete (exploring) stays complete and keeps its record current. */
  function save() {
    try { put(done ? { seed, snapshot: inst.snapshot(), completed: true, result: inst.result(), ...keep() } : { seed, snapshot: inst.snapshot(), completed: false, rival: P.rival, daily: P.daily, ...keep() }); } catch (e) { ctx.log(e); }
  }

  /** @param {boolean} byUser true after a press (focus follows to the new heading), false when time moved the screen on */
  function draw(byUser) {
    /** @type {any} */ let s, r;
    try { s = inst.screen(); r = inst.result(); } catch (e) { return problem(e); }
    const c = controls(s);
    for (const ci of s.citations || []) seen.set(ci.id, ci);
    bodySig = ticking(s); lastBody = ctx.now();
    if (drawn && c === sig) updateScreen(stage, s, opts());
    else {
      const a = document.activeElement, inside = Boolean(a && stage.contains(a)), keep = inside && !byUser ? a.dataset?.id : null;
      renderScreen(stage, s, { ...opts(), focus: byUser || inside });
      // a press that brings another screen (kind or title) starts at the top: the briefing's Start must not leave the new screen's map scrolled out of view
      if (byUser && lastScreen && (lastScreen.kind !== s.kind || lastScreen.title !== s.title) && typeof globalThis.scrollTo === 'function') globalThis.scrollTo(0, 0);
      if (keep) [...stage.querySelectorAll('button')].find(b => b.dataset.id === keep)?.focus();
      sig = c; drawn = true;
    }
    const on = Boolean(s.world && cfg.render);
    canvas.hidden = !on;
    plate.hidden = !plateOn || Boolean(s.world) || hasAtlas(s);
    lastScreen = s;
    fly(on && isFlight(s));
    if (flying) { hud.setPause(pauseAction()); if (s.world.pick && s.world.pick.id !== pickShown) { pickShown = s.world.pick.id; setDrawer(true); } else if (!s.world.pick) pickShown = ''; }
    wire(s, on);
    if (on) {
      if (!renderer) { fit(); renderer = cfg.render.createRenderer(canvas, { quality: cfg.quality || 'auto', reducedMotion: Boolean(ctx.settings.get().reducedMotion) }); }
      canvas.setAttribute('aria-label', s.title);
      if (flying) { fit(); relayout(true); }
      renderer.frame(s.world, fc.overlays(), layout);
    }
    if (r && r.completed) { if (!done) { done = true; finish(r); } }
    else if (done) { done = false; after.replaceChildren(); }
    loop = Boolean(s.world || (inst.raw.tick && !done) || (watching && !done && !wPaused));
    schedule();
  }

  function fit() { const w = canvas.clientWidth || 640, h = canvas.clientHeight || Math.round(w * 0.625), k = env.pixelRatio || 1; canvasW = canvas.clientWidth || 0; canvasH = canvas.clientHeight || 0; canvas.width = Math.round(w * k); canvas.height = Math.round(h * k); }
  function schedule() { if (loop && !rafId && !paused && raf && inst && ctx.alive()) rafId = raf(frame); }
  function stop() { if (rafId) caf(rafId); rafId = 0; loop = false; }

  function frame() {
    rafId = 0;
    if (!inst || paused || !ctx.alive()) return;
    const t = ctx.now(), dt = Math.min(0.1, Math.max(0, (t - last) / 1000)); last = t;
    try {
      if (watching) { if (wControls && inst.raw.input) inst.input(wControls); } else if (inst.raw.input) inst.input(fc.read(dt));
      inst.tick(dt);
      if (watching && !wPaused && !done && t - wLast >= WATCH_MS[inst.raw.tick ? 1 : 0]) { wLast = t; wStep(); return schedule(); }
      const s = inst.raw.screen();
      if (controls(s) !== sig) return draw(false);
      if (s.world && renderer) { wire(s, true); if (canvas.clientWidth && (canvas.clientWidth !== canvasW || canvas.clientHeight !== canvasH)) { fit(); relayout(true); } else relayout(false); lastScreen = s; renderer.frame(s.world, fc.overlays(), layout); }
      if (t - lastBody >= BODY_MS) {
        lastBody = t;
        if (ticking(s) !== bodySig || (!done && inst.result()?.completed)) return draw(false);
      }
    } catch (e) { return problem(e); }
    schedule();
  }

  /** The result screen of some templates carries its own "Play again": the chrome then does not add a second one. */
  function ownReplay() {
    try { return (inst.screen().actions || []).some(a => a.label === S('replay', 'Play again')); } catch (e) { return false; }
  }
  /** A tag id for people: internal ids use dashes ("capital-of-country"). */
  const tagLabel = t => { const w = String(t).replace(/[-_]+/g, ' ').trim(); return w ? w[0].toUpperCase() + w.slice(1) : String(t); };

  /** One step of Watch and Learn: ask the template what its own player does now, say it, do it. */
  function wStep() {
    /** @type {any} */ let a = null, s = null;
    try { s = inst.screen(); a = inst.raw.autoplay ? inst.raw.autoplay() : { act: inst.oracle('correct') }; } catch (e) { ctx.log(e); }
    if (!s || !a || (!a.act && !a.controls && !a.say) || (a.act && !availableActions(s).includes(a.act)) || ++wSteps > WATCH_MAX) return wEnd();
    wControls = a.controls || null;
    const pick = (s.choices || []).find(c => c.id === a.act), press = (s.actions || []).find(c => c.id === a.act);
    const say = a.say || (pick ? S('watchAnswer', '{title} Answer: {label}.', { title: s.title, label: pick.label }) : press ? S('watchStep', '{title}: {label}.', { title: s.title, label: press.label }) : '');
    if (say && say !== wSay) narr.textContent = wSay = say;
    if (a.act) { try { inst.act(a.act); } catch (e) { ctx.log(e); } draw(false); }
  }
  function wEnd() {
    wPaused = true; loop = false; pauseBtn.hidden = true;
    narr.textContent = S('watchNone', 'This game cannot go on by itself from here. Choose Play to try it yourself.');
    after.replaceChildren(h('div.ea-chips', null, btn(S('playYourself', 'Play it yourself'), () => ctx.replace('pack', { id, entry, preview: P.preview }), '.ea-go')));
  }

  function finish(r) {
    if (watching) {
      narr.textContent = S('watchDone', 'That is the whole game, played to the end. Now try it yourself.'); pauseBtn.hidden = true;
      after.replaceChildren(h('div.ea-chips', null, btn(S('playYourself', 'Play it yourself'), () => ctx.replace('pack', { id, entry, preview: P.preview }), '.ea-go'),
        btn(S('watchAgain', 'Watch again'), () => { pauseBtn.hidden = false; wPaused = false; narr.textContent = wSay = ''; ctx.track(start(pack, true)); })));
      return;
    }
    if (Number.isFinite(r.score) && (!best || r.score > best.score)) best = { score: r.score, total: r.total, at: ctx.now() };
    try { put({ completed: true, result: r, ...keep() }); } catch (e) { ctx.log(e); }
    if (P.daily != null) ctx.track(rememberDaily(ctx, P.daily, id, r));
    ctx.announce(S('finished', 'Finished'));
    const next = h('div.ea-slot'), more = h('div.ea-slot'), x = resultExtras(ctx, { id, title: title(), seed, result: r, rival: P.rival });
    const tags = (entry.g || []).slice(0, 4);
    after.replaceChildren(...[x.compare,
      h('section.ea-sec', { 'aria-label': S('whatNext', 'What next') }, h('h2.ea-h', null, S('whatNext', 'What next')),
        h('div.ea-chips', null, ownReplay() ? null : btn(S('replay', 'Play again'), () => ctx.track(start(pack, true))), next, btn(S('tab.home', 'Home'), () => ctx.go('home')), x.share)),
      x.panel, more,
      tags.length && h('section.ea-sec', { 'aria-label': S('moreAbout', 'More about') }, h('h2.ea-h', null, S('moreAbout', 'More about')),
        h('div.ea-chips', null, tags.map(t => btn(tagLabel(t), () => ctx.go('browse', { tag: t, domain: entry.d }), '.ea-chip')))),
      // one quiet row, once in a run of the app
      ctx.once('siblings') && siblingsSection(ctx, 1, dayNumber(ctx.now()))].filter(Boolean));
    const mine = inst;
    ctx.track(related().then(items => {
      if (!ctx.alive() || inst !== mine || !done || !items.length) return;
      next.replaceChildren(btn(S('next', 'Next: {title}', { title: items[0].t }), () => ctx.replace('pack', { id: items[0].id, entry: items[0] }), '.ea-go'));
      more.replaceChildren(h('section.ea-sec', { 'aria-label': S('moreLike', 'More like this') }, h('h2.ea-h', null, S('moreLike', 'More like this')), h('ul.ea-list', null, items.map(e => entryItem(ctx, e)))));
    }));
  }

  /** Up to four entries to play next: the same topic and first tag, the same region first, then the same level and the next levels up, then the rest. */
  async function related() {
    if (cfg.related) return ((await cfg.related(entry)) || []).filter(e => e.id !== id).slice(0, 4);
    // in an app of games, the next pack comes from the same game (played) or the same game's knowledge (learned)
    const f = { domain: entry.d, ...(entry.gm ? { game: entry.gm } : entry.gl?.length ? { learn: P.learn && entry.gl.includes(P.learn) ? P.learn : entry.gl[0] } : {}), compat: cfg.compat, limit: 200 }, reg = entry.r?.[0], lvl = Number.isFinite(entry.df) ? entry.df : 0;
    const pick = async g => (await ctx.catalog.list({ ...f, ...g })).items.filter(e => e.id !== id);
    let items = [];
    if (entry.g?.length && reg) items = await pick({ tag: entry.g[0], region: reg });
    if (items.length < 2 && entry.g?.length) items = items.concat(await pick({ tag: entry.g[0] }));
    if (items.length < 2) items = items.concat(await pick({}));
    const rank = e => (e.tp === entry.tp ? 0 : 4) + (reg && (e.r || []).includes(reg) ? 0 : 2) + ((e.df ?? 0) >= lvl ? 0 : 1);
    const uniq = [...new Map(items.map(e => [e.id, e])).values()];
    return uniq.map((e, i) => ({ e, i, k: rank(e), step: Math.abs((e.df ?? 0) - lvl) })).sort((a, b) => a.k - b.k || a.step - b.step || a.i - b.i).slice(0, 4).map(x => x.e);
  }

  state(S('loading', 'Loading…'));
  open();
  return {
    title: title(), ownHeading: true, immersive: true, flush: true, actions: [srcBtn], nodes: [canvas, fc.el, hud.el, hud.backdrop, hud.probe, watchBar, plate, stage, after],
    pause() { paused = true; if (rafId) caf(rafId); rafId = 0; },
    resume() { paused = false; last = ctx.now(); schedule(); },
    dispose() {
      if (inst && acted && !watching) save();
      if (inst && !watching) try { ctx.params.kept = { seed, acted, snapshot: inst.snapshot() }; } catch (e) { ctx.log(e); }
      stop(); if (off) off(); off = null;
      fly(false);
      if (renderer?.dispose) renderer.dispose();
      if (offSettings) offSettings();
      fc.dispose();
      plateImg.removeAttribute('src');   // free the picture when the screen is left
      inst = null;
    },
  };
}
