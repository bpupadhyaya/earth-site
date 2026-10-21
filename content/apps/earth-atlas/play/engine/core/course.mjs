// @ts-check
// Course logic: an ordered curriculum defined as data (apps/<slug>/app.json games[].course) evaluated over the marks a player has
// earned. Pure functions over JSON, no imports, no storage: the UI (engine/ui/course.mjs) reads the play records the progress store
// already keeps, folds them into one small course record and asks `evaluate` what is locked, open and done.
//
// Course data
//   { title?, intro?, notice?, gate?: <stage id>, passMark?: 0..1 (default 0.7),
//     stages: [{ id, title, goal, after?: [stage id] (default: the stage before), debrief?: text,
//                rank?: { packs: [pack id], any: [rank id] }           (unlocks when a pack's record holds one of these ranks)
//                learn?: [{ pack, title, kind: 'lesson' | 'quiz', min?, optional? }],
//                practice?: [{ pack, title, min?, seat?, optional? }],      (flights)
//                checkride?: [{ pack, title, min?, seat? }] }] }            (flights; open after the stage's other items are met)
// A mark is what one pack's last finished play left: { r: best ratio 0..1 or null, p: ever passed (true) / passed flag unknown (null),
// seats: seats it was passed from, rank, done }. `gate` names the stage that must be done before any piloting pack of the game opens.

export const DEFAULT_PASS = 0.7;
const ROLES = /** @type {const} */ (['learn', 'practice', 'checkride']);

/** A ratio 0..1 from a score and a total (a total of 1 or none means the score already is a ratio). */
const ratio = (s, t) => (Number.isFinite(s) ? Math.min(1, Math.max(0, Number(t) > 1 ? s / t : s)) : null);

/**
 * The mark one stored play record gives (null when the pack has not been finished).
 * @param {any} rec a progress record: { best?, result?, durable?, completed? }
 * @returns {{ r: number | null, p: boolean | null, seat: string | null, rank: string | null, done: boolean } | null}
 */
export function markOf(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const best = rec.best && typeof rec.best === 'object' ? rec.best : null, res = rec.result && typeof rec.result === 'object' ? rec.result : null;
  const done = Boolean(best || (res && res.completed));
  if (!done) return null;
  const r = ratio(best?.score ?? res?.score, best ? best.total : res?.total);
  const p = res && typeof res.passed === 'boolean' ? res.passed : null;
  const rank = typeof rec.durable?.rank === 'string' ? rec.durable.rank : typeof res?.rank === 'string' ? res.rank : null;
  return { r, p, seat: typeof res?.seat === 'string' ? res.seat : null, rank, done: true };
}

/**
 * Fold a new mark into the stored one (a record never gets worse: best ratio, ever passed, every seat passed from).
 * @param {any} old @param {any} mark @param {number} [at]
 */
export function merge(old, mark, at = 0) {
  if (!mark) return old || null;
  const o = old || { r: null, p: null, seats: [], rank: null, done: false, at: 0 };
  const seats = new Set(o.seats || []);
  if (mark.p === true && mark.seat) seats.add(mark.seat);
  return {
    r: mark.r == null ? o.r : o.r == null ? mark.r : Math.max(o.r, mark.r),
    p: mark.p === true || o.p === true ? true : mark.p === false || o.p === false ? false : null,
    seats: [...seats], rank: mark.rank || o.rank || null, done: true, at: at || o.at || 0,
  };
}

/** Compare two stored marks; true when they hold the same facts (the timestamp is ignored). */
export const sameMark = (a, b) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });

/** Every pack id the course names, in order. @param {any} course */
export function packsOf(course) {
  const out = [];
  for (const s of course?.stages || []) for (const role of ROLES) for (const q of s[role] || []) if (q && typeof q.pack === 'string' && !out.includes(q.pack)) out.push(q.pack);
  for (const s of course?.stages || []) for (const p of s.rank?.packs || []) if (typeof p === 'string' && !out.includes(p)) out.push(p);
  return out;
}

/** The flight packs (practice and checkride) the course names. @param {any} course */
export function flightPacksOf(course) {
  const out = [];
  for (const s of course?.stages || []) for (const role of ['practice', 'checkride']) for (const q of s[role] || []) if (q && typeof q.pack === 'string' && !out.includes(q.pack)) out.push(q.pack);
  return out;
}

/** Problems with a course definition (empty when it is sound). @param {any} course @returns {string[]} */
export function validateCourse(course) {
  const bad = [];
  if (!course || typeof course !== 'object') return ['course is not an object'];
  const stages = Array.isArray(course.stages) ? course.stages : [];
  if (!stages.length) bad.push('course has no stages');
  const ids = new Set();
  stages.forEach((s, i) => {
    const at = `stage ${i + 1}`;
    if (!s || typeof s.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(s.id)) return bad.push(`${at}: id must be a lowercase slug`);
    if (ids.has(s.id)) bad.push(`${at}: duplicate id ${s.id}`);
    ids.add(s.id);
    if (!s.title || !s.goal) bad.push(`${s.id}: title and goal are required`);
    let n = 0;
    for (const role of ROLES) for (const q of s[role] || []) {
      n++;
      if (!q || typeof q.pack !== 'string' || !q.title) bad.push(`${s.id}.${role}: each item needs pack and title`);
      else if (role === 'learn' && !['lesson', 'quiz'].includes(q.kind)) bad.push(`${s.id}.${q.pack}: learn kind must be lesson or quiz`);
      if (q && q.min != null && !(q.min > 0 && q.min <= 1)) bad.push(`${s.id}.${q.pack}: min must be in (0, 1]`);
    }
    if (!n) bad.push(`${s.id}: no items`);
    if (!(s.learn || []).some(q => !q.optional) && !(s.practice || []).length && !(s.checkride || []).length) bad.push(`${s.id}: nothing required`);
  });
  stages.forEach(s => { for (const a of s?.after || []) if (!ids.has(a)) bad.push(`${s.id}: after names unknown stage ${a}`); });
  if (course.gate != null && !ids.has(course.gate)) bad.push(`gate names unknown stage ${course.gate}`);
  return bad;
}

/**
 * @typedef {{ pack: string, title: string, role: 'learn'|'practice'|'checkride', kind: 'lesson'|'quiz'|'flight', min: number, seat?: string,
 *   optional: boolean, state: 'done'|'tried'|'open'|'waiting', ratio: number | null }} Item
 * @typedef {{ id: string, title: string, goal: string, state: 'locked'|'available'|'active'|'done', items: Item[], required: number, met: number,
 *   missing: string[], debrief: { text: string, quizAvg: number | null, flightAvg: number | null, checkride: number | null } | null }} Stage
 */

/**
 * Where a player stands in a course.
 * @param {any} course @param {Record<string, any>} marks stored marks by pack id
 * @returns {{ stages: Stage[], gateOpen: boolean, gate: string | null, next: { stage: string, item: Item } | null, done: boolean, stagesDone: number }}
 */
export function evaluate(course, marks = {}) {
  const pass = Number.isFinite(course?.passMark) ? course.passMark : DEFAULT_PASS;
  const defs = Array.isArray(course?.stages) ? course.stages : [];
  /** @type {Stage[]} */ const out = [];
  const byId = new Map();
  defs.forEach((d, i) => {
    /** @type {Item[]} */ const items = [];
    for (const role of ROLES) for (const q of d[role] || []) {
      const kind = role === 'learn' ? q.kind : 'flight', min = Number.isFinite(q.min) ? q.min : pass, m = marks[q.pack] || null;
      let ok = false;
      if (m && m.done) {
        if (kind === 'lesson') ok = true;
        else if (kind === 'quiz') ok = m.r != null && m.r >= min;
        else {
          const passed = m.p === true || (m.p == null && m.r != null && m.r >= pass);
          ok = passed && (!Number.isFinite(q.min) || (m.r != null && m.r >= q.min)) && (!q.seat || (m.seats || []).includes(q.seat));
        }
      }
      items.push({ pack: q.pack, title: String(q.title || q.pack), role, kind, min, ...(q.seat ? { seat: q.seat } : {}), optional: Boolean(q.optional),
        state: ok ? 'done' : m && m.done ? 'tried' : 'open', ratio: m && m.r != null ? m.r : null });
    }
    // a checkride waits until the stage's other required items are met
    const others = items.filter(x => x.role !== 'checkride' && !x.optional);
    const othersMet = others.every(x => x.state === 'done');
    for (const x of items) if (x.role === 'checkride' && x.state !== 'done' && !othersMet) x.state = 'waiting';
    const req = items.filter(x => !x.optional), met = req.filter(x => x.state === 'done').length;
    const stage = /** @type {Stage} */ ({ id: d.id, title: String(d.title), goal: String(d.goal || ''), state: 'locked', items, required: req.length, met, missing: [], debrief: null, _i: i });
    out.push(stage); byId.set(d.id, stage);
  });
  // unlocking: every stage named in `after` (default: the one before) must be done, and the rank rule, when there is one, must hold
  out.forEach((s, i) => {
    const d = defs[i], need = Array.isArray(d.after) ? d.after : i > 0 ? [defs[i - 1].id] : [];
    const finished = s.required > 0 && s.met === s.required;
    const missing = need.filter(a => byId.get(a)?.state !== 'done').map(a => `stage:${a}`);
    if (d.rank && Array.isArray(d.rank.packs) && Array.isArray(d.rank.any)) {
      const held = d.rank.packs.some(p => marks[p] && d.rank.any.includes(marks[p].rank));
      if (!held) missing.push(`rank:${d.rank.any.join('|')}`);
    }
    s.missing = missing;
    const open = missing.length === 0;
    s.state = !open ? 'locked' : finished ? 'done' : s.met > 0 || s.items.some(x => x.state === 'tried') ? 'active' : 'available';
    if (s.state === 'done') {
      const avg = list => { const v = list.map(x => x.ratio).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const rides = s.items.filter(x => x.role === 'checkride');
      s.debrief = { text: String(d.debrief || ''), quizAvg: avg(s.items.filter(x => x.kind === 'quiz')), flightAvg: avg(s.items.filter(x => x.role === 'practice')), checkride: rides.length ? avg(rides) : null };
    }
    delete (/** @type {any} */ (s))._i;
  });
  const first = out.find(s => s.state !== 'done' && s.state !== 'locked') || null;
  const next = first ? { stage: first.id, item: first.items.find(x => !x.optional && x.state !== 'done' && x.state !== 'waiting') || first.items.find(x => x.state !== 'done' && x.state !== 'waiting') } : null;
  const gateStage = course?.gate ? byId.get(course.gate) : null;
  const stagesDone = out.filter(s => s.state === 'done').length;
  return { stages: out, gateOpen: !gateStage || gateStage.state === 'done', gate: gateStage ? gateStage.id : null, next: next && next.item ? /** @type {any} */ (next) : null, done: out.length > 0 && stagesDone === out.length, stagesDone };
}
