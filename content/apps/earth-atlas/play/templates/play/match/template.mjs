// @ts-check
// play/match: pair each item of the left column with its partner in the right column (tap left, tap right).
// Structure follows the golden play/quiz template. Rounds of `boardSize` pairs; wrong pairs are shown and cleared.
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

export default defineTemplate({
  id: 'play/match',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'Pair items from two columns, with sourced feedback, a mistake count and a review.',

  create(pack, env) {
    const d = pack.data;
    const settings = { boardSize: 5, rounds: 1, ...(d.settings || {}) };
    const S = (k, fb) => env.strings(k, fb);

    // 1. Randomness once, at creation: which pairs, in which round, and the order of both columns of every round.
    const rng = env.rng.fork('match');
    const size = Math.max(1, Math.min(settings.boardSize, d.pairs.length));
    const rounds = Math.max(1, Math.min(settings.rounds, Math.floor(d.pairs.length / size)));
    const pool = rng.shuffle(d.pairs.map((_, i) => i)).slice(0, size * rounds);
    const boards = [];
    for (let r = 0; r < rounds; r++) {
      const ids = pool.slice(r * size, (r + 1) * size);
      boards.push({ left: rng.shuffle(ids), right: rng.shuffle(ids) }); // pair indexes, in display order
    }

    // 2. The whole game is one object. matched = pair indexes solved; sel = pair index of the chosen left item.
    let st = { phase: 'intro', boards, round: 0, matched: /** @type {number[]} */ ([]), sel: -1, mistakes: 0, taps: 0, firstTry: 0, missed: /** @type {number[]} */ ([]), last: /** @type {any} */ (null) };

    const total = size * rounds;
    const board = () => st.boards[st.round];
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);
    const leftsLeft = () => board().left.map((p, k) => ({ p, k })).filter(x => !st.matched.includes(x.p));
    const rightsLeft = () => board().right.map((p, k) => ({ p, k })).filter(x => !st.matched.includes(x.p));
    const roundDone = () => board().left.every(p => st.matched.includes(p));

    // 3. screen(): pure function of state.
    function screen() {
      const prog = { i: Math.min(st.matched.length + 1, total), n: total };
      const done = st.matched.map(p => `${d.pairs[p].left} = ${d.pairs[p].right}`);
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('pairs', 'Pairs'), String(total)]] }], actions: [{ id: 'start', label: S('start', 'Start') }] };
        case 'left':
          return { kind: 'pick-left', title: d.leftTitle ? S('pickLeft', 'Choose one:') + ' ' + d.leftTitle : S('pickLeft', 'Choose one:'), progress: prog,
            body: done.length ? [{ text: S('matchedSoFar', 'Matched so far') }, { list: done }] : [],
            choices: leftsLeft().map(x => ({ id: `l${x.k}`, label: d.pairs[x.p].left })), meta: { mistakes: st.mistakes, taps: st.taps, round: st.round + 1, rounds } };
        case 'right':
          return { kind: 'pick-right', title: `${d.pairs[st.sel].left}: ${d.rightTitle || S('pickRight', 'find its partner')}`, progress: prog,
            body: done.length ? [{ text: S('matchedSoFar', 'Matched so far') }, { list: done }] : [],
            choices: rightsLeft().map(x => ({ id: `r${x.k}`, label: d.pairs[x.p].right })), meta: { mistakes: st.mistakes, taps: st.taps, round: st.round + 1, rounds } };
        case 'feedback': {
          const l = st.last; const p = d.pairs[l.left];
          const body = l.ok
            ? [{ fact: `${p.left} = ${p.right}`, source: p.source }, ...(p.explain ? [{ text: p.explain }] : [])]
            : [{ text: `${p.left} ${S('notWith', 'does not go with')} ${d.pairs[l.right].right}` }];
          const finished = st.matched.length >= total;
          return { kind: 'feedback', title: l.ok ? S('correct', 'Correct') : S('incorrect', 'Not quite'), progress: prog, body, citations: l.ok ? cite(p.source) : [],
            actions: [{ id: 'next', label: finished ? S('finish', 'See result') : S('next', 'Next') }], meta: { correct: l.ok, mistakes: st.mistakes, taps: st.taps } };
        }
        case 'result': {
          const review = st.missed.map(p => d.pairs[p]);
          return { kind: 'result', title: st.mistakes === 0 ? S('perfect', 'Perfect match') : S('tryAgain', 'Keep practising'),
            body: [{ kv: [[S('matched', 'Pairs matched'), `${st.matched.length} / ${total}`], [S('mistakes', 'Mistakes'), String(st.mistakes)], [S('moves', 'Moves'), String(st.taps)]] },
              ...(review.length ? [{ text: S('review', 'Review') }, { list: review.map(p => `${p.left} = ${p.right}`) }] : [])],
            citations: [...new Map(review.flatMap(p => cite(p.source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'restart', label: S('restart', 'Play again') }],
            meta: { matched: st.matched.length, total, mistakes: st.mistakes, taps: st.taps, firstTry: st.firstTry } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes.
    function act(id) {
      if (st.phase === 'intro' && id === 'start') { st.phase = total ? 'left' : 'result'; return; }
      if (st.phase === 'left' && /^l\d+$/.test(id)) {
        const p = board().left[Number(id.slice(1))];
        if (p === undefined || st.matched.includes(p)) return;
        st.sel = p; st.taps++; st.phase = 'right'; return;
      }
      if (st.phase === 'right' && /^r\d+$/.test(id)) {
        const p = board().right[Number(id.slice(1))];
        if (p === undefined || st.matched.includes(p)) return;
        st.taps++;
        const ok = p === st.sel;
        if (ok) { st.matched.push(p); if (!st.missed.includes(p)) st.firstTry++; }
        else { st.mistakes++; if (!st.missed.includes(st.sel)) st.missed.push(st.sel); }
        st.last = { left: st.sel, right: p, ok }; st.sel = -1; st.phase = 'feedback'; return;
      }
      if (st.phase === 'feedback' && id === 'next') {
        if (st.matched.length >= total) { st.phase = 'result'; return; }
        if (roundDone()) st.round++;
        st.phase = 'left'; return;
      }
      if (st.phase === 'result' && id === 'restart') { st = { ...st, phase: 'intro', round: 0, matched: [], sel: -1, mistakes: 0, taps: 0, firstTry: 0, missed: [], last: null }; return; }
    }

    return {
      screen, act,
      result: () => ({ completed: st.phase === 'result', score: st.matched.length, total, mistakes: st.mistakes, moves: st.taps, passed: st.phase === 'result' && st.mistakes === 0 }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles (tests only): $correct picks the true partner, $wrong a different remaining item when one exists.
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'feedback') return 'next';
        if (st.phase === 'result') return 'restart';
        if (st.phase === 'left') { const x = leftsLeft()[0]; return x ? `l${x.k}` : undefined; }
        if (st.phase === 'right') {
          const rs = rightsLeft();
          const x = name === 'wrong' ? (rs.find(r => r.p !== st.sel) || rs[0]) : rs.find(r => r.p === st.sel);
          return x ? `r${x.k}` : undefined;
        }
        return undefined;
      },
    };
  },
});
