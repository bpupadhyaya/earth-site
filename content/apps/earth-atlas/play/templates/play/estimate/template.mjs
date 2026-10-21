// @ts-check
// play/estimate: guess a real quantity by picking one of 4-6 range bands generated around the true value,
// then see the real value with its unit and source. Score per item is a log-scale closeness: 100, 50 or 0.
// Structure follows the golden play/quiz template.
import { defineTemplate } from '../../../engine/core/template.mjs';
import { SCHEMA } from './schema.mjs';

/** Round to 2 significant figures and group thousands, deterministic (no locale). @param {number} x */
function nice(x) {
  const r = Number(x.toPrecision(2));
  const [int, frac] = String(r).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}
const exactText = x => { const [int, frac] = String(x).split('.'); return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : ''); };

export default defineTemplate({
  id: 'play/estimate',
  version: '1.0.0',
  schema: SCHEMA,
  describe: 'Estimate real quantities by choosing a range, then see the true value with its unit and source.',

  create(pack, env) {
    /** Square and cubic units are written with a superscript digit: km2 becomes km². @param {string} u */
    const unitText = u => String(u).replace(/\b([a-zA-Z]{1,3})([23])\b/g, (_, a, n) => a + (n === '2' ? '²' : '³'));
    const d = pack.data;
    const settings = { bands: 5, bandRatio: 4, shuffle: true, passScore: 0.6, ...(d.settings || {}) };
    const S = (k, fb) => env.strings(k, fb);

    // 1. Randomness once, at creation: which items, and which band of each item holds the truth.
    const rng = env.rng.fork('estimate');
    let order = d.items.map((_, i) => i);
    if (settings.shuffle) order = rng.shuffle(order);
    if (settings.count) order = order.slice(0, settings.count);
    const nb = settings.bands;
    // Band k spans [v * r^(k-t-1/2), v * r^(k-t+1/2)], so the truth sits at the middle (in log terms) of band t.
    const plans = order.map(qi => {
      const v = d.items[qi].value; const r = settings.bandRatio;
      // settings.maxValue: no band may start at or above it (an area above the Earth's surface is no answer), so the true band
      // is moved up the list until the top band starts below it; with no maxValue every position is open, as before.
      const lowest = settings.maxValue > 0 ? Math.min(nb - 1, Math.max(0, Math.ceil(nb - 1.5 - Math.log(settings.maxValue / v) / Math.log(r) + 1e-9))) : 0;
      const t = lowest + Math.floor(rng.next() * (nb - lowest));
      const bands = Array.from({ length: nb }, (_, k) => ({ lo: v * Math.pow(r, k - t - 0.5), hi: v * Math.pow(r, k - t + 0.5) }));
      return { qi, t, labels: bands.map(b => `${nice(b.lo)} - ${nice(b.hi)}`) };
    });

    // 2. The whole game is one object.
    let st = { phase: 'intro', plans, i: 0, points: 0, answers: /** @type {{p:number, picked:number, pts:number}[]} */ ([]) };

    const n = () => st.plans.length;
    const plan = () => st.plans[st.i];
    const item = () => d.items[plan().qi];
    const cite = src => (src && d.sources?.[src] ? [{ id: src, title: d.sources[src].title, url: d.sources[src].url }] : []);
    const pointsFor = dist => Math.max(0, 100 - 50 * dist); // log-scale: each band away costs one log step of bandRatio
    const max = () => n() * 100;

    // 3. screen(): pure function of state.
    function screen() {
      switch (st.phase) {
        case 'intro':
          return { kind: 'intro', title: d.title || pack.manifest.title, body: [...(d.intro ? [{ text: d.intro }] : []), { kv: [[S('items', 'Questions'), String(n())]] }], actions: [{ id: 'start', label: S('start', 'Start') }] };
        case 'question':
          return { kind: 'question', title: item().prompt, progress: { i: st.i + 1, n: n() },
            body: [{ text: `${S('unit', 'Unit')}: ${unitText(item().unit)}` }],
            choices: plan().labels.map((label, k) => ({ id: `b${k}`, label })), meta: { itemId: item().id, points: st.points } };
        case 'feedback': {
          const last = st.answers[st.answers.length - 1]; const p = st.plans[last.p]; const it = d.items[p.qi];
          const dist = Math.abs(last.picked - p.t);
          return { kind: 'feedback', title: dist === 0 ? S('correct', 'In the right range') : dist === 1 ? S('close', 'Close') : S('incorrect', 'Not quite'), progress: { i: st.i + 1, n: n() },
            body: [{ fact: `${it.prompt} ${exactText(it.value)} ${unitText(it.unit)}`, source: it.source }, { kv: [[S('yourRange', 'Your range'), p.labels[last.picked]], [S('points', 'Points'), String(last.pts)]] }, ...(it.explain ? [{ text: it.explain }] : [])],
            citations: cite(it.source),
            actions: [{ id: 'next', label: st.i + 1 < n() ? S('next', 'Next') : S('finish', 'See result') }], meta: { distance: dist, points: last.pts, total: st.points } };
        }
        case 'result': {
          const pct = max() ? st.points / max() : 0;
          const missed = st.answers.filter(a => a.pts < 100).map(a => d.items[st.plans[a.p].qi]);
          return { kind: 'result', title: pct >= settings.passScore ? S('passed', 'Well done') : S('tryAgain', 'Keep practising'),
            body: [{ kv: [[S('score', 'Points'), `${st.points} / ${max()}`], [S('exact', 'In the right range'), `${st.answers.filter(a => a.pts === 100).length} / ${n()}`]] },
              ...(missed.length ? [{ text: S('review', 'Review') }, { list: missed.map(m => `${m.prompt} ${exactText(m.value)} ${unitText(m.unit)}`) }] : [])],
            citations: [...new Map(missed.flatMap(m => cite(m.source)).map(c => [c.id, c])).values()],
            actions: [{ id: 'restart', label: S('restart', 'Play again') }], meta: { points: st.points, max: max(), pct: Math.round(pct * 100), passed: pct >= settings.passScore } };
        }
      }
      throw new Error(`unknown phase ${st.phase}`);
    }

    // 4. act(id): the only place state changes.
    function act(id) {
      if (st.phase === 'intro' && id === 'start') { st.phase = n() ? 'question' : 'result'; return; }
      if (st.phase === 'question' && /^b\d+$/.test(id)) {
        const picked = Number(id.slice(1));
        const pts = pointsFor(Math.abs(picked - plan().t));
        st.points += pts; st.answers.push({ p: st.i, picked, pts });
        st.phase = 'feedback'; return;
      }
      if (st.phase === 'feedback' && id === 'next') { st.i++; st.phase = st.i < n() ? 'question' : 'result'; return; }
      if (st.phase === 'result' && id === 'restart') { st = { ...st, phase: 'intro', i: 0, points: 0, answers: [] }; return; }
    }

    return {
      screen, act,
      result: () => ({ completed: st.phase === 'result', score: st.points, total: max(), passed: max() ? st.points / max() >= settings.passScore : false }),
      snapshot: () => JSON.parse(JSON.stringify(st)),
      restore: s => { st = JSON.parse(JSON.stringify(s)); },
      // 5. Oracles (tests only): $correct = the band holding the truth, $wrong = the band farthest from it.
      oracle: name => {
        if (st.phase === 'intro') return 'start';
        if (st.phase === 'feedback') return 'next';
        if (st.phase === 'result') return 'restart';
        const t = plan().t;
        if (name === 'correct') return `b${t}`;
        if (name === 'wrong') return `b${t < nb / 2 ? nb - 1 : 0}`;
        return undefined;
      },
    };
  },
});
