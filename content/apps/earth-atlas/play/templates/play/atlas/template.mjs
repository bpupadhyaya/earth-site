// @ts-check
// play/atlas: a picture game. A place is shown on its map (with its flag); choose the place card that belongs to it. A wrong
// card greys out and you try again; streaks and quick finds score more; every find unlocks a short fact with its source.
// Structure follows the golden play/quiz template. The screens carry picture data (`body[].atlas`, `choices[].card`) that the engine
// UI draws (engine/ui/render-dom.mjs); the text of the screens stays complete, so any renderer can play it.
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

const BASE = 100, SECOND = 40, LAST = 10, STREAK_STEP = 10, STREAK_CAP = 5;

export default defineTemplate({
  id: 'play/atlas',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'Find the right place card for a place shown on its map and flag: streaks, second chances, a fact with its source for every find.',

  create(pack, env) {
    const d = pack.data;
    const settings = { rounds: 10, ...(d.settings || {}) };
    const S = (k, fb) => env.strings(k, fb);

    // 1. Randomness once, at creation: which rounds, in which order, and the order of the cards of every round.
    const rng = env.rng.fork('atlas');
    const total = Math.max(1, Math.min(settings.rounds, d.rounds.length));
    // A pool larger than one play is drawn afresh every play: Play again redraws from the whole pool.
    const draw = () => { const order = rng.shuffle(d.rounds.map((_, i) => i)).slice(0, total); return { order, shown: order.map(r => rng.shuffle(d.rounds[r].options.map((_, i) => i))) }; };   // shown: option indexes in display order

    // 2. The whole game is one object.
    let st = { ...draw(), phase: total ? 'pick' : 'result', i: 0, tried: /** @type {string[]} */ ([]), score: 0, streak: 0, best: 0, mistakes: 0, firstTry: 0, missed: /** @type {number[]} */ ([]), last: /** @type {any} */ (null) };

    const round = () => d.rounds[st.order[st.i]];
    const opts = () => st.shown[st.i].map(k => round().options[k]);
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);
    const stars = () => { const acc = st.firstTry / total; return acc >= 0.85 ? 3 : acc >= 0.55 ? 2 : 1; };
    const place = () => { const p = round().place; return { name: p.name, iso2: p.iso2 || '', box: p.box, outline: p.outline, mark: p.mark || null, lines: p.lines || [], view: p.view || null, context: p.context || [] }; };
    const card = o => ({ at: o.at || null, shape: o.shape ? { outline: o.shape.outline } : null, clues: (o.clues || []).map(c => c.t), note: o.note || '' });
    const choiceOf = (o, k, reveal) => ({ id: `o${k}`, label: o.name,
      state: reveal ? (o.id === round().answer ? 'correct' : st.tried.includes(o.id) ? 'wrong' : 'other') : (st.tried.includes(o.id) ? 'wrong' : 'open'), card: card(o) });
    const meta = () => ({ score: st.score, streak: st.streak, best: st.best, mistakes: st.mistakes, round: st.i + 1, rounds: total });

    // 3. screen(): pure function of state.
    function screen() {
      const prog = { i: Math.min(st.i + 1, total), n: total };
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('rounds', 'Rounds'), String(total)]] }], actions: [{ id: 'start', label: S('start', "Let's go") }] };
        case 'pick': {
          const r = round();
          const clue = st.tried.length ? [{ text: S('tryAgain', 'Not that one. Try another card.') }] : [];
          return { kind: 'pick', title: d.prompt || S('prompt', 'Find the right card'), progress: prog,
            body: [{ atlas: place() }, { text: r.place.name }, ...clue], choices: opts().map((o, k) => choiceOf(o, k, false)), meta: { ...meta(), tries: st.tried.length } };
        }
        case 'reveal': {
          const r = round(), l = st.last, right = r.options.find(o => o.id === r.answer);
          const head = l.tries === 0 ? S('great', 'Spot on!') : S('gotIt', 'Got it!');
          return { kind: 'reveal', title: `${head} ${right.name}`, progress: prog,
            body: [{ atlas: { ...place(), found: right.at || null } }, { text: `${r.place.name}: ${right.name}  +${l.points}` },
              ...(st.streak >= 2 ? [{ text: `${S('streak', 'Streak')}: ${st.streak}` }] : []),
              { fact: r.explain || right.note || `${right.name}`, source: r.source }],
            choices: opts().map((o, k) => choiceOf(o, k, true)), citations: [...new Map([r.source, ...opts().flatMap(o => (o.clues || []).map(c => c.source))].flatMap(cite).map(c => [c.id, c])).values()],
            actions: [{ id: 'next', label: st.i + 1 >= total ? S('finish', 'See your stars') : S('next', 'Next') }],
            meta: { ...meta(), correct: l.tries === 0, tries: l.tries, points: l.points } };
        }
        case 'result': {
          const review = st.missed.map(i => d.rounds[st.order[i]]);
          return { kind: 'result', title: `${'★'.repeat(stars())}${'☆'.repeat(3 - stars())}`,
            body: [{ kv: [[S('score', 'Score'), String(st.score)], [S('firstTry', 'Found first try'), `${st.firstTry} / ${total}`], [S('bestStreak', 'Best streak'), String(st.best)]] },
              ...(review.length ? [{ text: S('toRevisit', 'Worth another look') }, { list: review.map(r => `${r.place.name}: ${r.options.find(o => o.id === r.answer).name}`) }] : [])],
            citations: [...new Map(review.flatMap(r => cite(r.source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'restart', label: S('restart', 'Play again') }],
            meta: { score: st.score, firstTry: st.firstTry, total, mistakes: st.mistakes, best: st.best, stars: stars() } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes.
    function act(id) {
      if (id === 'start') return;   // the play opens on its first round; older scenarios still press start
      if (st.phase === 'pick' && /^o\d+$/.test(id)) {
        const o = opts()[Number(id.slice(1))];
        if (!o || st.tried.includes(o.id)) return;
        if (o.id === round().answer) {
          const tries = st.tried.length;
          st.streak = tries === 0 ? st.streak + 1 : 0;
          st.best = Math.max(st.best, st.streak);
          const points = tries === 0 ? BASE + STREAK_STEP * Math.min(STREAK_CAP, st.streak - 1) : tries === 1 ? SECOND : LAST;
          st.score += points; if (tries === 0) st.firstTry++;
          st.last = { tries, points }; st.phase = 'reveal'; return;
        }
        st.tried.push(o.id); st.streak = 0; st.mistakes++;
        if (!st.missed.includes(st.i)) st.missed.push(st.i);
        return;
      }
      if (st.phase === 'reveal' && id === 'next') {
        if (st.i + 1 >= total) { st.phase = 'result'; return; }
        st.i++; st.tried = []; st.last = null; st.phase = 'pick'; return;
      }
      if (st.phase === 'result' && id === 'restart') { st = { ...st, ...draw(), phase: total ? 'pick' : 'result', i: 0, tried: [], score: 0, streak: 0, best: 0, mistakes: 0, firstTry: 0, missed: [], last: null }; return; }
    }

    return {
      screen, act,
      result: () => ({ completed: st.phase === 'result', score: st.score, total, mistakes: st.mistakes, firstTry: st.firstTry, stars: st.phase === 'result' ? stars() : 0, passed: st.phase === 'result' && stars() >= 2 }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles (tests only): $correct picks the right card, $wrong a wrong one that has not been tried (the right one when none is left).
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'reveal') return 'next';
        if (st.phase === 'result') return 'restart';
        const list = opts(), right = list.findIndex(o => o.id === round().answer);
        if (name === 'wrong') { const k = list.findIndex(o => o.id !== round().answer && !st.tried.includes(o.id)); return `o${k >= 0 ? k : right}`; }
        return `o${right}`;
      },
    };
  },
});
