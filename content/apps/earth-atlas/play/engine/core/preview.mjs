// @ts-check
// Free preview budget: every game for sale can be tried for a fixed amount of real play time (default 90 seconds), once per game per
// install. The player adds the time it measured (an injected clock; menus, About, rules, results and pauses are never counted); this
// module only keeps the sums, on the shell's key-value adapter, so a restart or a second visit never grants the preview again.
//
//   const pv = await loadPreview({ kv, budgetMs });
//   pv.left(gameId)              ms still free (0 once the budget is used); pv.used(gameId) ms spent
//   await pv.add(gameId, ms)     add real play time (never below 0, never beyond the budget); resolves the left time
//   pv.budgetMs                  the configured budget
// Storage: one small record { used: { [gameId]: ms } } under `earth.preview.v1`; at most MAX_GAMES games are remembered.

import { readJson, writeJson } from './kv.mjs';

export const PREVIEW_KEY = 'earth.preview.v1';
export const DEFAULT_PREVIEW_MS = 90 * 1000;
const MAX_GAMES = 400;
const SCHEMA = { type: 'object', required: ['used'], properties: { used: { type: 'object' } } };

/** @param {{ kv: import('./kv.mjs').KeyValueAdapter, budgetMs?: number }} opts */
export async function loadPreview(opts) {
  const budget = Number.isFinite(opts.budgetMs) && /** @type {number} */ (opts.budgetMs) > 0 ? Math.round(/** @type {number} */ (opts.budgetMs)) : DEFAULT_PREVIEW_MS;
  const stored = await readJson(opts.kv, PREVIEW_KEY, SCHEMA, { used: {} });
  /** @type {Map<string, number>} */ const used = new Map();
  for (const [g, ms] of Object.entries(stored.value.used || {})) if (typeof ms === 'number' && ms >= 0 && Number.isFinite(ms)) used.set(g, Math.min(ms, budget));
  let chain = Promise.resolve(true);
  const persist = () => { chain = chain.then(() => writeJson(opts.kv, PREVIEW_KEY, { used: Object.fromEntries(used) })); return chain; };
  const left = game => Math.max(0, budget - (used.get(String(game)) || 0));
  return {
    budgetMs: budget,
    source: stored.source,
    used: game => used.get(String(game)) || 0,
    left,
    /** @param {string} game @param {number} ms @returns {Promise<number>} the time left after adding */
    async add(game, ms) {
      const g = String(game);
      if (!g || !Number.isFinite(ms) || ms <= 0) return left(g);
      if (!used.has(g) && used.size >= MAX_GAMES) used.delete(/** @type {string} */ (used.keys().next().value));
      used.set(g, Math.min(budget, (used.get(g) || 0) + ms));
      await persist();
      return left(g);
    },
  };
}
