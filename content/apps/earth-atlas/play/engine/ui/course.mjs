// @ts-check
// The Course of a game (docs/FLIGHT-V1.md group A): an ordered curriculum from app.json `games[].course`, shown as a path of stages
// (locked / available / in progress / done) with a Continue button, a plain explanation of what to finish next, a debrief the first
// time a stage is complete, and a gate that keeps the pilot's seat closed until the entry stage (ground school) is passed.
// The logic is engine/core/course.mjs (pure). Nothing new is stored by this module except one small record per game in the progress
// store (`course:<game id>`: the best mark of each pack of the course and which stage debriefs were shown). The record is rewritten
// from the pack records every time the Course is opened, so it outlives the bounded list of recent plays.
import { h, btn, section, meter } from './dom.mjs';
import { gameById } from './gallery.mjs';
import { evaluate, markOf, merge, sameMark, packsOf, validateCourse } from '../core/course.mjs';

const CSS = `
.ea-stages { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.8em; }
.ea-stage { display: flex; flex-direction: column; gap: 0.5em; padding: 0.9em 1em; border-radius: 0.9em; background: color-mix(in srgb, var(--card) 82%, transparent); border: 2px solid transparent; }
.ea-stage[data-state="active"], .ea-stage[data-state="available"] { border-color: var(--accent); }
.ea-stage[data-state="locked"] { opacity: 0.82; }
.ea-stage-head { display: flex; align-items: center; gap: 0.7em; }
.ea-stage-head .ea-name { font-weight: 700; flex: 1 1 auto; min-width: 0; }
.ea-stage-state { flex: none; padding: 0.15em 0.65em; border-radius: 999px; font-size: 0.85em; font-weight: 650; background: color-mix(in srgb, var(--fg) 12%, transparent); }
.ea-stage[data-state="done"] .ea-stage-state { background: color-mix(in srgb, #8fd89a 45%, transparent); }
.ea-stage[data-state="done"] .ea-num { background: color-mix(in srgb, #8fd89a 45%, transparent); }
.ea-stage[data-state="active"] .ea-num, .ea-stage[data-state="available"] .ea-num { background: var(--accent); color: var(--bg); }
.ea-stage p { margin: 0; }
.ea-sum { cursor: pointer; min-height: max(44px, 2.5em); display: flex; align-items: center; font-weight: 650; }
.ea-sitems[open] > .ea-sum { margin-bottom: 0.3em; }
.ea-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4em; }
.ea-citem { display: flex; flex-direction: row; align-items: center; gap: 0.7em; min-height: max(44px, 2.5em); padding: 0.5em 0.8em; border-radius: 0.7em; font: inherit; text-align: left; color: var(--fg); background: color-mix(in srgb, var(--fg) 6%, transparent); border: 2px solid transparent; width: 100%; }
button.ea-citem { cursor: pointer; }
button.ea-citem:hover { border-color: var(--accent); }
.ea-citem[data-state="done"] .ea-mark { background: color-mix(in srgb, #8fd89a 45%, transparent); }
.ea-mark { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 1.8em; height: 1.8em; border-radius: 999px; font-weight: 700; background: color-mix(in srgb, var(--fg) 12%, transparent); }
.ea-citem .ea-txt { display: flex; flex-direction: column; min-width: 0; }
.ea-debrief { border: 2px solid var(--accent); border-radius: 0.9em; padding: 0.9em 1em; display: flex; flex-direction: column; gap: 0.4em; }
`;

/** The game's course, when it has a sound one; else null. @param {any} g */
export const courseOf = g => (g && g.course && typeof g.course === 'object' && validateCourse(g.course).length === 0 ? g.course : null);
const keyOf = g => `course:${g.id}`;
const pct = r => `${Math.round(100 * r)}%`;

/** Read the stored course record, fold in what the pack records say now, write it back when something changed. */
async function load(ctx, g, course) {
  const { progress } = ctx;
  const rec = (await Promise.resolve(progress.get(keyOf(g))).catch(() => null)) || {};
  const marks = { ...(rec.marks || {}) };
  let changed = !rec.marks;
  const ids = packsOf(course);
  const recs = await Promise.all(ids.map(id => Promise.resolve(progress.get(id)).catch(() => null)));
  ids.forEach((id, i) => {
    const m = markOf(recs[i]);
    if (!m) return;
    const next = merge(marks[id], m, ctx.now());
    if (!marks[id] || !sameMark(marks[id], next)) { marks[id] = next; changed = true; }
  });
  const celebrated = Array.isArray(rec.celebrated) ? rec.celebrated.slice() : [];
  const save = async () => { try { await progress.set(keyOf(g), { course: 1, marks, celebrated, at: ctx.now() }); } catch (e) { ctx.log(e); } };
  if (changed) await save();
  return { marks, celebrated, save };
}

/**
 * Is the pilot's seat open for this game? Resolves { open: true } or { open: false, stage } (the entry stage to finish).
 * Never throws: a failure to read means open (the course must never lock a player out by accident).
 * @param {any} ctx @param {any} g a normalised game @returns {Promise<{ open: boolean, stage?: string, title?: string }>}
 */
export async function seatOpen(ctx, g) {
  const course = courseOf(g);
  if (!course || !course.gate) return { open: true };
  try {
    const rec = await Promise.resolve(ctx.progress.get(keyOf(g))).catch(() => null);
    const marks = { ...(rec?.marks || {}) };
    const ids = packsOf(course);
    const recs = await Promise.all(ids.map(id => Promise.resolve(ctx.progress.get(id)).catch(() => null)));
    ids.forEach((id, i) => { const m = markOf(recs[i]); if (m) marks[id] = merge(marks[id], m, 0); });
    const ev = evaluate(course, marks);
    if (ev.gateOpen) return { open: true };
    const st = ev.stages.find(s => s.id === ev.gate);
    return { open: false, stage: st?.id, title: st?.title };
  } catch (e) { ctx.log(e); return { open: true }; }
}

/** What stops a locked stage, in words. */
function why(ctx, ev, s) {
  const { S } = ctx;
  return s.missing.map(m => {
    if (m.startsWith('stage:')) return S('course.finish', 'Finish first: {title}', { title: ev.stages.find(x => x.id === m.slice(6))?.title || m.slice(6) });
    return S('course.rank', 'Reach the rank: {rank}', { rank: m.slice(5).replace(/-/g, ' ').replace(/\|/g, ' or ') });
  }).join(' · ');
}

const ROLE = { learn: ['course.role.learn', 'Learn'], practice: ['course.role.practice', 'Practice flight'], checkride: ['course.role.checkride', 'Checkride'] };

/** One row of a stage: mark, title, what it needs, and (when the stage is open) a button that opens the pack. */
function itemRow(ctx, g, s, it, open) {
  const { S } = ctx;
  const role = S(...ROLE[it.role]);
  const need = it.kind === 'lesson' ? S('course.lesson', 'Lesson') : it.kind === 'quiz' ? S('course.quiz', 'Quiz: {min} to pass', { min: pct(it.min) }) : [role, it.seat ? S('course.seat', 'as {seat}', { seat: it.seat }) : '', it.state !== 'done' && it.role === 'checkride' ? S('course.rideMin', '{min} to pass', { min: pct(it.min) }) : ''].filter(Boolean).join(' · ');
  const status = it.state === 'done' ? [S('course.done', 'Done'), it.ratio != null ? pct(it.ratio) : ''].filter(Boolean).join(' · ')
    : it.state === 'tried' ? S('course.tried', 'Tried: best {best}, needs {min}', { best: it.ratio != null ? pct(it.ratio) : '-', min: pct(it.min) })
      : it.state === 'waiting' ? S('course.waiting', 'After the items above') : it.optional ? S('course.optional', 'Recommended') : S('course.todo', 'To do');
  const kids = [h('span.ea-mark', { 'aria-hidden': 'true' }, it.state === 'done' ? '✓' : it.role === 'checkride' ? '★' : ''),
    h('span.ea-txt', null, h('span.ea-name', null, it.title), h('span.ea-sub', null, [need, status].filter(Boolean).join(' · ')))];
  const can = open && it.state !== 'waiting';
  if (!can) return h('li', null, h('div.ea-citem', { data: { pack: it.pack, state: it.state } }, ...kids));
  return h('li', null, h('button.ea-citem', { type: 'button', data: { pack: it.pack, state: it.state }, onclick: () => openItem(ctx, g, it) }, ...kids));
}

function openItem(ctx, g, it) {
  const entry = { id: it.pack, t: it.title, ...(it.role === 'learn' ? {} : { gm: g.id }) };
  ctx.go('pack', { id: it.pack, entry, ...(it.role === 'learn' ? { learn: g.id } : {}) });
}

const stateLabel = (S, st) => ({ done: S('course.state.done', 'Done'), active: S('course.state.active', 'In progress'), available: S('course.state.available', 'Open'), locked: S('course.state.locked', 'Locked') })[st];

/** The Course screen of a game: `go('course', { id, blocked? })`. */
export function courseView(ctx) {
  const { S } = ctx, P = ctx.params, box = h('div.ea-slot');
  if (typeof document !== 'undefined' && !document.getElementById('ea-course-css')) document.head.append(h('style', { id: 'ea-course-css' }, CSS));
  box.replaceChildren(h('p.ea-note', null, S('loading', 'Loading…')));
  ctx.track(gameById(ctx, P.id).then(async g => {
    if (!ctx.alive()) return;
    const course = g && courseOf(g);
    if (!g || !course) { box.replaceChildren(h('p.ea-note', { role: 'alert' }, S('course.none', 'This game has no course.'))); return; }
    ctx.setTitle(S('course.title', '{title}: course', { title: g.title }));
    const { marks, celebrated, save } = await load(ctx, g, course);
    if (!ctx.alive()) return;
    const ev = evaluate(course, marks);
    const fresh = ev.stages.filter(s => s.state === 'done' && !celebrated.includes(s.id));
    if (fresh.length) { celebrated.push(...fresh.map(s => s.id)); await save(); }
    const nextStage = ev.next ? ev.stages.find(s => s.id === ev.next.stage) : null;
    const blockedMsg = P.blocked ? S('course.blocked', 'The pilot\'s seat opens when "{stage}" is passed. Finish its quizzes below, then fly: {title}.', { stage: ev.stages.find(s => s.id === ev.gate)?.title || '', title: P.blocked }) : '';

    const debrief = s => h('div.ea-debrief', { role: 'status', data: { debrief: s.id } },
      h('h3.ea-h', null, S('course.complete', 'Stage complete: {title}', { title: s.title })),
      s.debrief?.text && h('p', null, s.debrief.text),
      h('p.ea-sub', null, [
        s.debrief?.quizAvg != null && S('course.quizAvg', 'Quiz average {pct}', { pct: pct(s.debrief.quizAvg) }),
        s.debrief?.flightAvg != null && S('course.flightAvg', 'Practice flights {pct}', { pct: pct(s.debrief.flightAvg) }),
        s.debrief?.checkride != null && S('course.rideAvg', 'Checkride {pct}', { pct: pct(s.debrief.checkride) })].filter(Boolean).join(' · ')),
      (() => { const n = ev.stages[ev.stages.findIndex(x => x.id === s.id) + 1]; return n ? h('p.ea-note', null, n.state === 'locked' ? S('course.nextLocked', 'Next: {title} (still locked)', { title: n.title }) : S('course.nextOpen', 'Next: {title}', { title: n.title })) : h('p.ea-note', null, S('course.allDone', 'That was the last stage.')); })());

    const meterEl = meter(S('course.progress', 'Course progress'));
    meterEl.set(ev.stages.length ? ev.stagesDone / ev.stages.length : 0);

    const path = h('ol.ea-stages', { 'aria-label': S('course.path', 'Stages') }, ev.stages.map((s, i) => {
      const open = s.state !== 'locked';
      return h('li.ea-stage', { data: { stage: s.id, state: s.state } },
        h('div.ea-stage-head', null, h('span.ea-num', { 'aria-hidden': 'true' }, s.state === 'done' ? '✓' : String(i + 1)), h('span.ea-name', null, s.title), h('span.ea-stage-state', null, stateLabel(S, s.state))),
        h('p', null, s.goal),
        s.state === 'locked' && h('p.ea-msg', { data: { why: s.id } }, why(ctx, ev, s)),
        s.state !== 'locked' && h('p.ea-sub', null, S('course.met', '{met} of {n} required items done', { met: s.met, n: s.required })),
        h('details.ea-sitems', { open: s.state === 'active' || s.state === 'available' }, h('summary.ea-sum', null, S('course.items', 'Items ({n})', { n: s.items.length })),
          h('ul.ea-items', null, s.items.map(it => itemRow(ctx, g, s, it, open)))));
    }));

    box.replaceChildren(h('div.ea-sec', null, ...[
      blockedMsg && h('p.ea-msg', { role: 'alert', data: { blocked: '1' } }, blockedMsg),
      ...fresh.map(debrief),
      ev.next ? h('div.ea-chips', null, btn(S('course.continue', 'Continue: {title}', { title: ev.next.item.title }), () => openItem(ctx, g, ev.next.item), '.ea-go'),
        nextStage && h('span.ea-note', null, S('course.inStage', 'In: {title}', { title: nextStage.title })))
        : ev.done ? h('p.ea-msg', null, S('course.finished', 'Course finished.')) : h('p.ea-msg', null, S('course.stuck', 'Finish the earlier stages to open the next one.')),
      h('p.ea-sub', { data: { done: String(ev.stagesDone) } }, S('course.stagesDone', '{done} of {n} stages done', { done: ev.stagesDone, n: ev.stages.length })), meterEl.el,
      section(S('course.path', 'Stages'), path),
      course.intro && h('p', null, course.intro),
      course.notice && h('p.ea-note', null, course.notice),
    ].filter(Boolean)));
  }));
  return { title: P.title || S('course.titleShort', 'Course'), nodes: [box] };
}
