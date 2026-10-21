// @ts-check
// GOLDEN TEMPLATE: play/quiz. Copy this folder to start a new turn-based template (tools/earth new template does it for you).
// Read engine/core/template.mjs for the contract. Everything a template needs is shown here, with comments on WHY.
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

const REVIEW_PAGE = 5; // missed questions listed on the result screen at a time; "Show more" adds the next page

export default defineTemplate({
  id: 'play/quiz',
  version: '1.2.0',
  schema: SCHEMA,
  describe: 'Multiple-choice questions with sourced answers, instant feedback and a review of mistakes.',

  create(pack, env) {
    const d = pack.data;
    const settings = { shuffleQuestions: true, shuffleChoices: true, passScore: 0.7, mode: 'classic', seconds: 20, lives: 3, hints: 0, ...(d.settings || {}) };
    const mode = ['classic', 'timed', 'survival'].includes(settings.mode) ? settings.mode : 'classic';
    const timed = mode === 'timed';
    const survival = mode === 'survival';
    const mediaByHash = new Map(((pack.media && pack.media.items) || []).map(m => [m.hash, m]));
    const S = (k, fb) => env.strings(k, fb); // every UI string goes through env.strings so it can be localized later

    // 1. All randomness happens ONCE at creation, from env.rng, and is stored in state, so snapshot/restore and determinism hold.
    const rng = env.rng.fork('quiz');
    let order = d.questions.map((_, i) => i);
    if (settings.shuffleQuestions) order = rng.shuffle(order);
    if (settings.count) order = order.slice(0, settings.count);
    const choiceOrders = order.map(qi => { const ids = d.questions[qi].choices.map((_, i) => i); return settings.shuffleChoices ? rng.shuffle(ids) : ids; });

    // Hints (1.1): per question, the order in which wrong choices are removed. Fixed once from its own rng stream.
    const hintRng = env.rng.fork('hints');
    const hintOrders = order.map(qi => hintRng.shuffle(d.questions[qi].choices.map((_, i) => i).filter(i => i !== d.questions[qi].answer)));

    // 2. The whole game is this one object. snapshot() returns it; restore() replaces it.
    let st = { phase: 'intro', order, choiceOrders, i: 0, score: 0, answers: /** @type {{q:number, picked:number, correct:boolean, timedOut?:boolean}[]} */ ([]),
      lives: survival ? settings.lives : 0, hintsLeft: settings.hints, removed: /** @type {number[]} */ ([]), deadline: 0, hintsUsed: 0, out: false, reviewShown: REVIEW_PAGE };

    const q = () => d.questions[st.order[st.i]];
    const n = () => st.order.length;
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);
    const choiceId = originalIndex => `c${st.choiceOrders[st.i].indexOf(originalIndex)}`;

    // Time comes only from env.now(). The deadline is fixed when a question is shown (stored in state, so snapshots keep it).
    const startQuestion = () => { st.removed = []; st.deadline = timed ? env.now() + settings.seconds * 1000 : 0; };
    const secondsLeft = () => Math.max(0, Math.ceil((st.deadline - env.now()) / 1000));
    const expired = () => timed && st.phase === 'question' && env.now() >= st.deadline;
    const mediaBlock = qq => { const m = qq.media && mediaByHash.get(qq.media); return m ? [{ media: { hash: qq.media, alt: qq.mediaAlt || m.alt || qq.prompt, optional: true } }] : []; };
    function record(picked, timedOut) {
      const correct = !timedOut && picked === q().answer;
      if (correct) st.score++;
      else if (survival) { st.lives--; if (st.lives <= 0) st.out = true; }
      st.answers.push({ q: st.order[st.i], picked, correct, ...(timedOut ? { timedOut: true } : {}) });
      st.phase = 'feedback';
    }

    // 3. screen(): pure function of state. No side effects here.
    function screen() {
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('questions', 'Questions'), String(n())]] }], actions: [{ id: 'start', label: S('start', 'Start') }] };
        case 'question':
        {
          const body = [...(q().context ? [{ text: q().context }] : []), ...mediaBlock(q())];
          if (timed) body.push({ kv: [[S('timeLeft', 'Time left'), `${secondsLeft()} s`]] });
          if (survival) body.push({ kv: [[S('lives', 'Lives'), String(st.lives)]] });
          const choices = st.choiceOrders[st.i].map((orig, k) => ({ id: `c${k}`, label: q().choices[orig], orig })).filter(c => !st.removed.includes(c.orig)).map(({ id, label }) => ({ id, label }));
          const actions = st.hintsLeft > 0 && choices.length > 2 ? [{ id: 'hint', label: `${S('hint', 'Hint')} (${st.hintsLeft})` }] : [];
          return { kind: 'question', title: q().prompt, progress: { i: st.i + 1, n: n() }, ...(body.length ? { body } : {}), choices, ...(actions.length ? { actions } : {}),
            meta: { questionId: q().id, score: st.score, mode, ...(timed ? { secondsLeft: secondsLeft() } : {}), ...(survival ? { lives: st.lives } : {}), hintsLeft: st.hintsLeft } };
        }
        case 'feedback': {
          const last = st.answers[st.answers.length - 1]; const qq = d.questions[last.q];
          return { kind: 'feedback', title: last.correct ? S('correct', 'Correct') : last.timedOut ? S('timeUp', 'Time is up') : S('incorrect', 'Not quite'), progress: { i: st.i + 1, n: n() },
            body: [{ fact: `${qq.context ? qq.context + ' ' : ''}${qq.prompt} ${qq.choices[qq.answer]}`, source: qq.source }, ...(qq.explain ? [{ text: qq.explain }] : [])], citations: cite(qq.source),
            actions: [{ id: 'next', label: st.i + 1 < n() && !st.out ? S('next', 'Next') : S('finish', 'See result') }], meta: { correct: last.correct, score: st.score, ...(last.timedOut ? { timedOut: true } : {}), ...(survival ? { lives: st.lives } : {}) } };
        }
        case 'result': {
          const mistakes = st.answers.filter(a => !a.correct).map(a => d.questions[a.q]);
          const pct = n() ? st.score / n() : 0;
          const passed = survival ? !st.out && n() > 0 : pct >= settings.passScore;
          const shownN = Math.min(mistakes.length, st.reviewShown || REVIEW_PAGE), shown = mistakes.slice(0, shownN), more = mistakes.length - shownN;
          return { kind: 'result', title: passed ? S('passed', 'Well done') : S('tryAgain', 'Keep practising'),
            body: [{ kv: [[S('score', 'Score'), `${st.score} / ${n()}`], ...(survival ? [[S('lives', 'Lives'), String(st.lives)]] : [])] }, ...(mistakes.length ? [{ text: S('review', 'Review') }, { list: shown.map(m => `${m.context ? m.context + ' ' : ''}${m.prompt} ${m.choices[m.answer]}`) }, ...(more > 0 ? [{ text: `${S('reviewShowing', 'Showing')} ${shownN} / ${mistakes.length}` }] : [])] : [])],
            citations: [...new Map(shown.flatMap(m => cite(m.source)).map(c => [c.id, c])).values()],
            actions: [...(more > 0 ? [{ id: 'more', label: S('showMore', 'Show more') }] : []), { id: 'restart', label: S('restart', 'Play again') }], meta: { score: st.score, total: n(), pct: Math.round(pct * 100), passed, mode, ...(survival ? { lives: st.lives } : {}) } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes (besides tick() in real-time templates).
    function act(id) {
      if (st.phase === 'intro' && id === 'start') { st.phase = n() ? 'question' : 'result'; if (st.phase === 'question') startQuestion(); return; }
      if (st.phase === 'question' && id === 'hint') {
        if (expired()) { record(-1, true); return; }
        const left = hintOrders[st.i].filter(orig => !st.removed.includes(orig));
        if (st.hintsLeft > 0 && st.choiceOrders[st.i].length - st.removed.length > 2 && left.length) { st.removed.push(left[0]); st.hintsLeft--; st.hintsUsed++; }
        return;
      }
      if (st.phase === 'question' && /^c\d+$/.test(id)) {
        if (expired()) { record(-1, true); return; } // answered after the deadline: counts as time-up
        record(st.choiceOrders[st.i][Number(id.slice(1))], false); return;
      }
      if (st.phase === 'feedback' && id === 'next') { st.i++; st.phase = st.i < n() && !st.out ? 'question' : 'result'; if (st.phase === 'question') startQuestion(); return; }
      if (st.phase === 'result' && id === 'more') { st.reviewShown = (st.reviewShown || REVIEW_PAGE) + REVIEW_PAGE; return; }
      if (st.phase === 'result' && id === 'restart') { st = { ...st, reviewShown: REVIEW_PAGE, phase: 'intro', i: 0, score: 0, answers: [], lives: survival ? settings.lives : 0, hintsLeft: settings.hints, removed: [], deadline: 0, hintsUsed: 0, out: false }; return; }
    }
    // Real-time step: used only to notice that the deadline passed (the clock itself is env.now()).
    const tick = () => { if (expired()) record(-1, true); };

    return {
      screen, act, ...(timed ? { tick } : {}),
      result: () => ({ completed: st.phase === 'result', score: st.score, total: n(), passed: survival ? st.phase === 'result' && !st.out && n() > 0 : n() ? st.score / n() >= settings.passScore : false, mode, hintsUsed: st.hintsUsed, ...(survival ? { lives: st.lives } : {}) }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles let scenario tests say "$correct" without knowing the data. Tests only; the UI never calls them.
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'feedback') return 'next';
        if (st.phase === 'result') return 'restart';
        if (name === 'correct') return choiceId(q().answer);
        if (name === 'wrong') { const k = st.choiceOrders[st.i].findIndex(orig => orig !== q().answer && !st.removed.includes(orig)); return `c${k}`; }
        if (name === 'hint') return 'hint';
        return undefined;
      },
    };
  },
});
