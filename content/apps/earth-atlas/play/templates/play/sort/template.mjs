// @ts-check
// play/sort: put 4-7 items in order of a property (for example largest first) by selecting an item and moving it up or down.
// Structure follows the golden play/quiz template. Score = items in the exactly right position.
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

export default defineTemplate({
  id: 'play/sort',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'Order items by a measured property, then see the true values with units and sources.',

  create(pack, env) {
    const d = pack.data;
    const settings = { count: 5, rounds: 1, passScore: 0.7, ...(d.settings || {}) };
    const S = (k, fb) => env.strings(k, fb);
    const sign = d.property.direction === 'asc' ? 1 : -1;
    const trueOrder = ids => ids.slice().sort((a, b) => sign * (d.items[a].value - d.items[b].value) || a - b);

    // 1. Randomness once, at creation: which items per round and their starting (never already correct) arrangement.
    const rng = env.rng.fork('sort');
    const count = Math.max(2, Math.min(settings.count, d.items.length));
    const rounds = Math.max(1, Math.min(settings.rounds, Math.floor(d.items.length / count)));
    const pool = rng.shuffle(d.items.map((_, i) => i));
    const boards = [];
    for (let r = 0; r < rounds; r++) {
      const ids = pool.slice(r * count, (r + 1) * count);
      let start = rng.shuffle(ids);
      const sameValues = (a, b) => a.every((x, k) => d.items[x].value === d.items[b[k]].value);
      if (sameValues(start, trueOrder(ids))) start = [...start.slice(1), start[0]];
      boards.push({ ids, start });
    }

    // 2. The whole game is one object. cur = arrangement now (item indexes top to bottom), sel = selected item or -1.
    let st = { phase: 'intro', boards, round: 0, cur: boards[0].start.slice(), sel: -1, score: 0, moves: 0, review: /** @type {number[]} */ ([]) };

    const total = count * rounds;
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);
    const fmt = it => `${it.value} ${d.property.unit}`.trim();
    const dirText = () => (sign < 0 ? S('highFirst', 'highest first') : S('lowFirst', 'lowest first'));
    const hits = (arr, ids) => { const t = trueOrder(ids); return arr.map((x, k) => d.items[x].value === d.items[t[k]].value); };

    // 3. screen(): pure function of state.
    function screen() {
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('property', 'Order by'), `${d.property.label}, ${dirText()}`], [S('rounds', 'Rounds'), String(rounds)]] }], actions: [{ id: 'start', label: S('start', 'Start') }] };
        case 'arrange': {
          const actions = [];
          if (st.sel >= 0) { actions.push({ id: 'up', label: S('moveUp', 'Move up') }, { id: 'down', label: S('moveDown', 'Move down') }); }
          actions.push({ id: 'submit', label: S('submit', 'Check order') });
          return { kind: 'arrange', title: `${S('orderBy', 'Order by')} ${d.property.label}: ${dirText()}`, progress: { i: st.round + 1, n: rounds },
            body: [{ text: st.sel >= 0 ? S('moveHint', 'Move the selected item, or pick another.') : S('selectHint', 'Select an item, then move it up or down.') }],
            choices: st.cur.map((x, k) => ({ id: `i${x}`, label: `${k + 1}. ${d.items[x].label}`, ...(x === st.sel ? { state: 'selected' } : {}) })),
            actions, meta: { moves: st.moves, selected: st.sel >= 0 ? d.items[st.sel].id : null, round: st.round + 1 } };
        }
        case 'reveal': {
          const ids = st.boards[st.round].ids; const t = trueOrder(ids); const ok = hits(st.cur, ids);
          const right = ok.filter(Boolean).length;
          const last = st.round + 1 >= rounds;
          return { kind: 'reveal', title: right === count ? S('allRight', 'Perfect order') : `${right} / ${count} ${S('inPlace', 'in the right place')}`, progress: { i: st.round + 1, n: rounds },
            body: [{ list: t.map((x, k) => `${k + 1}. ${d.items[x].label}: ${fmt(d.items[x])}`) },
              ...t.filter(x => d.items[x].explain).map(x => ({ text: d.items[x].explain }))],
            citations: [...new Map(t.flatMap(x => cite(d.items[x].source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'next', label: last ? S('finish', 'See result') : S('next', 'Next') }], meta: { right, count, score: st.score } };
        }
        case 'result': {
          const pct = total ? st.score / total : 0;
          return { kind: 'result', title: pct >= settings.passScore ? S('passed', 'Well done') : S('tryAgain', 'Keep practising'),
            body: [{ kv: [[S('score', 'Exact positions'), `${st.score} / ${total}`], [S('moves', 'Moves'), String(st.moves)]] },
              ...(st.review.length ? [{ text: S('review', 'Review') }, { list: st.review.map(x => `${d.items[x].label}: ${fmt(d.items[x])}`) }] : [])],
            citations: [...new Map(st.review.flatMap(x => cite(d.items[x].source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'restart', label: S('restart', 'Play again') }], meta: { score: st.score, total, moves: st.moves, pct: Math.round(pct * 100), passed: pct >= settings.passScore } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes.
    function act(id) {
      if (st.phase === 'intro' && id === 'start') { st.phase = total ? 'arrange' : 'result'; return; }
      if (st.phase === 'arrange') {
        if (/^i\d+$/.test(id)) { const x = Number(id.slice(1)); if (st.cur.includes(x)) st.sel = st.sel === x ? -1 : x; return; }
        if ((id === 'up' || id === 'down') && st.sel >= 0) {
          const k = st.cur.indexOf(st.sel); const j = id === 'up' ? k - 1 : k + 1;
          if (j < 0 || j >= st.cur.length) return;
          [st.cur[k], st.cur[j]] = [st.cur[j], st.cur[k]]; st.moves++; return;
        }
        if (id === 'submit') {
          const ids = st.boards[st.round].ids; const ok = hits(st.cur, ids);
          st.score += ok.filter(Boolean).length;
          st.cur.forEach((x, k) => { if (!ok[k] && !st.review.includes(x)) st.review.push(x); });
          st.sel = -1; st.phase = 'reveal'; return;
        }
        return;
      }
      if (st.phase === 'reveal' && id === 'next') {
        st.round++;
        if (st.round >= rounds) { st.round = rounds - 1; st.phase = 'result'; return; }
        st.cur = st.boards[st.round].start.slice(); st.phase = 'arrange'; return;
      }
      if (st.phase === 'result' && id === 'restart') { st = { ...st, phase: 'intro', round: 0, cur: st.boards[0].start.slice(), sel: -1, score: 0, moves: 0, review: [] }; return; }
    }

    return {
      screen, act,
      result: () => ({ completed: st.phase === 'result', score: st.score, total, moves: st.moves, passed: total ? st.score / total >= settings.passScore : false }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles (tests only). $correct returns the next action that leads to the true order; $wrong submits the arrangement as it is.
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'reveal') return 'next';
        if (st.phase === 'result') return 'restart';
        const ids = st.boards[st.round].ids; const t = trueOrder(ids);
        if (name === 'wrong') return 'submit';
        const p = st.cur.findIndex((x, k) => d.items[x].value !== d.items[t[k]].value);
        if (p < 0) return 'submit';
        const want = st.cur.findIndex((x, k) => k >= p && d.items[x].value === d.items[t[p]].value);
        const wantItem = st.cur[want];
        if (st.sel !== wantItem) return `i${wantItem}`;
        return 'up';
      },
    };
  },
});
