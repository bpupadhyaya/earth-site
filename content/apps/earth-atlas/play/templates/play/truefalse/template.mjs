// @ts-check
// play/truefalse: read a statement, choose True or False, see the sourced fact. Structure follows the golden play/quiz template.
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

export default defineTemplate({
  id: 'play/truefalse',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'True-or-false statements with sourced answers, a streak counter and a review of mistakes.',

  create(pack, env) {
    const d = pack.data;
    const settings = { shuffle: true, passScore: 0.7, ...(d.settings || {}) };
    const S = (k, fb) => env.strings(k, fb);

    // 1. Randomness once, at creation, from env.rng, stored in state.
    const rng = env.rng.fork('truefalse');
    let order = d.statements.map((_, i) => i);
    if (settings.shuffle) order = rng.shuffle(order);
    if (settings.count) order = order.slice(0, settings.count);

    // 2. The whole game is this one object.
    let st = { phase: 'intro', order, i: 0, score: 0, streak: 0, best: 0, answers: /** @type {{s:number, picked:boolean, correct:boolean}[]} */ ([]) };

    const cur = () => d.statements[st.order[st.i]];
    const n = () => st.order.length;
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);
    const verdict = b => (b ? S('true', 'True') : S('false', 'False'));

    // 3. screen(): pure function of state.
    function screen() {
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('statements', 'Statements'), String(n())]] }], actions: [{ id: 'start', label: S('start', 'Start') }] };
        case 'question':
          return { kind: 'question', title: cur().text, progress: { i: st.i + 1, n: n() },
            choices: [{ id: 'true', label: verdict(true) }, { id: 'false', label: verdict(false) }], meta: { statementId: cur().id, score: st.score, streak: st.streak } };
        case 'feedback': {
          const last = st.answers[st.answers.length - 1]; const s = d.statements[last.s];
          return { kind: 'feedback', title: last.correct ? S('correct', 'Correct') : S('incorrect', 'Not quite'), progress: { i: st.i + 1, n: n() },
            body: [{ fact: `${s.text} ${verdict(s.truth)}`, source: s.source }, ...(s.explain ? [{ text: s.explain }] : [])], citations: cite(s.source),
            actions: [{ id: 'next', label: st.i + 1 < n() ? S('next', 'Next') : S('finish', 'See result') }], meta: { correct: last.correct, score: st.score, streak: st.streak } };
        }
        case 'result': {
          const mistakes = st.answers.filter(a => !a.correct).map(a => d.statements[a.s]);
          const pct = n() ? st.score / n() : 0;
          return { kind: 'result', title: pct >= settings.passScore ? S('passed', 'Well done') : S('tryAgain', 'Keep practising'),
            body: [{ kv: [[S('score', 'Score'), `${st.score} / ${n()}`], [S('bestStreak', 'Best streak'), String(st.best)]] },
              ...(mistakes.length ? [{ text: S('review', 'Review') }, { list: mistakes.map(m => `${m.text} ${verdict(m.truth)}`) }] : [])],
            citations: [...new Map(mistakes.flatMap(m => cite(m.source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'restart', label: S('restart', 'Play again') }], meta: { score: st.score, total: n(), best: st.best, pct: Math.round(pct * 100), passed: pct >= settings.passScore } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes.
    function act(id) {
      if (st.phase === 'intro' && id === 'start') { st.phase = n() ? 'question' : 'result'; return; }
      if (st.phase === 'question' && (id === 'true' || id === 'false')) {
        const picked = id === 'true';
        const correct = picked === cur().truth;
        if (correct) { st.score++; st.streak++; st.best = Math.max(st.best, st.streak); } else st.streak = 0;
        st.answers.push({ s: st.order[st.i], picked, correct });
        st.phase = 'feedback'; return;
      }
      if (st.phase === 'feedback' && id === 'next') { st.i++; st.phase = st.i < n() ? 'question' : 'result'; return; }
      if (st.phase === 'result' && id === 'restart') { st = { ...st, phase: 'intro', i: 0, score: 0, streak: 0, best: 0, answers: [] }; return; }
    }

    return {
      screen, act,
      result: () => ({ completed: st.phase === 'result', score: st.score, total: n(), best: st.best, passed: n() ? st.score / n() >= settings.passScore : false }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles (tests only).
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'feedback') return 'next';
        if (st.phase === 'result') return 'restart';
        if (name === 'correct') return cur().truth ? 'true' : 'false';
        if (name === 'wrong') return cur().truth ? 'false' : 'true';
        return undefined;
      },
    };
  },
});
