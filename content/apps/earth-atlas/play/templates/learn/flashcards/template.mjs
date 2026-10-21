// @ts-check
// learn/flashcards: flip a card, mark it known or not yet, and let a small Leitner-box schedule bring cards back in the session.
// Structure follows the golden template play/quiz (numbered parts). All Leitner state lives in snapshot().
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

export default defineTemplate({
  id: 'learn/flashcards',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'Flip sourced cards, mark them known or not yet; cards you miss come back sooner (Leitner boxes) until the session is done.',

  create(pack, env) {
    const d = pack.data;
    const settings = { shuffle: true, boxes: 3, ...(d.settings || {}) };
    const S = (k, fb) => env.strings(k, fb); // every UI string goes through env.strings

    // 1. Randomness once, at creation, from env.rng; the chosen session order is stored in state.
    const rng = env.rng.fork('flashcards');
    let order = d.cards.map((_, i) => i);
    if (settings.shuffle) order = rng.shuffle(order);
    if (settings.sessionSize) order = order.slice(0, settings.sessionSize);
    const BOXES = settings.boxes;
    const gapFor = box => 2 + box * 2; // box 1 returns after 4 cards, box 2 after 6, ...
    const maxTurns = order.length * (BOXES + 3) + 6; // hard stop so a session always ends

    // 2. The whole session is this one object (Leitner boxes included).
    const fresh = () => ({ queue: order.slice(), box: Object.fromEntries(order.map(c => [String(c), 1])), turns: 0, unseen: order.length, missed: /** @type {number[]} */ ([]) });
    let st = { phase: 'intro', order, ...fresh() };

    const n = () => st.order.length;
    const cur = () => d.cards[st.queue[0]];
    const retired = () => st.order.filter(c => st.box[String(c)] >= BOXES).length;
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);

    // 3. screen(): pure function of state.
    function screen() {
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('cards', 'Cards'), String(n())]] }], actions: [{ id: 'start', label: S('start', 'Start') }] };
        case 'front':
          return { kind: 'front', title: cur().front, progress: { i: Math.min(retired() + 1, n()), n: n() },
            body: [{ kv: [[S('box', 'Box'), `${st.box[String(st.queue[0])]} / ${BOXES}`]] }],
            actions: [{ id: 'flip', label: S('flip', 'Show answer') }], meta: { cardId: cur().id, box: st.box[String(st.queue[0])], known: retired(), left: st.queue.length } };
        case 'back': {
          const c = cur();
          return { kind: 'back', title: c.front, progress: { i: Math.min(retired() + 1, n()), n: n() },
            body: [{ fact: c.back, source: c.source }, ...(c.explain ? [{ text: c.explain }] : [])], citations: cite(c.source),
            actions: [{ id: 'known', label: S('known', 'I knew it') }, { id: 'unknown', label: S('unknown', 'Not yet') }], meta: { cardId: c.id, box: st.box[String(st.queue[0])], known: retired(), left: st.queue.length } };
        }
        case 'result': {
          const known = retired();
          const review = st.order.filter(c => st.box[String(c)] < BOXES).map(c => d.cards[c]);
          const missed = st.missed.map(c => d.cards[c]);
          const rows = (st.order.length && review.length ? review : missed);
          return { kind: 'result', title: known === n() ? S('allKnown', 'All cards known') : S('moreToReview', 'Some cards need review'),
            body: [{ kv: [[S('known', 'Known'), `${known} / ${n()}`], [S('toReview', 'To review'), String(n() - known)], [S('turns', 'Cards shown'), String(st.turns)]] },
              ...(rows.length ? [{ text: review.length ? S('reviewNext', 'Review next time') : S('hardOnes', 'Cards you missed along the way') }, { list: rows.map(c => `${c.front}: ${c.back}`) }] : [])],
            citations: [...new Map(rows.flatMap(c => cite(c.source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'restart', label: S('restart', 'Study again') }], meta: { known, total: n(), toReview: n() - known, turns: st.turns, missed: st.missed.length } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes.
    function act(id) {
      if (st.phase === 'intro' && id === 'start') { st.phase = n() ? 'front' : 'result'; return; }
      if (st.phase === 'front' && id === 'flip') { st.phase = 'back'; return; }
      if (st.phase === 'back' && (id === 'known' || id === 'unknown')) {
        const ci = st.queue.shift();
        if (st.unseen > 0) st.unseen--; // cards never shown yet always stay ahead of returning ones, so every card gets its first look
        const k = String(ci);
        st.turns++;
        if (id === 'known') st.box[k] = Math.min(BOXES, st.box[k] + 1);
        else { st.box[k] = 1; if (!st.missed.includes(ci)) st.missed.push(ci); }
        if (st.box[k] < BOXES) st.queue.splice(Math.min(st.unseen + gapFor(st.box[k]), st.queue.length), 0, ci);
        st.phase = (st.queue.length && st.turns < maxTurns) ? 'front' : 'result';
        return;
      }
      if (st.phase === 'result' && id === 'restart') { st = { phase: 'intro', order: st.order, ...fresh() }; return; }
    }

    return {
      screen, act,
      result: () => ({ completed: st.phase === 'result', score: retired(), total: n(), passed: st.phase === 'result' && retired() === n(), known: retired(), toReview: n() - retired() }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles for tests only: $correct = flip then "I knew it"; $wrong = flip then "Not yet".
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'front') return 'flip';
        if (st.phase === 'result') return 'restart';
        if (name === 'correct') return 'known';
        if (name === 'wrong') return 'unknown';
        return undefined;
      },
    };
  },
});
