// @ts-check
// The screen model: what a template shows at any moment, as data. The engine UI renders it (DOM today, native later);
// the harness inspects it in tests. Templates never touch the DOM, canvas or platform APIs directly.
//
// A screen is plain JSON:
//   kind      free string naming the screen type ("intro", "question", "feedback", "result", "world", ...)
//   title     short heading (string)
//   body      list of blocks: { text } | { fact, source } | { list: [strings] } | { media: {hash, alt, optional} } | { kv: [[k,v],...] }
//             picture block { atlas: { name, iso2, box, outline, [found] } }: a place on its map (outline = rings of flat u,v lists in 0..1000,
//             see templates/play/atlas/README.md) with its flag; `found` = [u, v] pins the answer. The renderer draws it big, hides the
//             stock picture above the game and shows progress as dots (engine/ui/atlas-draw.mjs).
//   choices   list of { id, label, [state], [card] } the player can pick (answers, options). state: open | wrong | correct | other.
//             card { at: [u, v], clues: [strings], note } turns a choice into a city card with a mini map of the atlas outline.
//   actions   list of { id, label } buttons (next, start, restart, hint, ...)
//   progress  { i, n } optional
//   citations list of { id, title, url } shown as "Sources" (automatic attribution)
//   world     optional handle for real-time views: { scene, camera } rendered by engine/render (flight templates)
//   layout    optional 'actions-first' | 'default'. The renderer puts the action buttons right after the first body block on
//             long briefing screens (docs/PRESENTATION-FLOW.md) by a heuristic; set 'actions-first' to force it, 'default' to forbid it.
//   meta      anything else the template wants tests to see (score, correct, mistakes...)
// Every id in choices/actions is a valid argument to instance.act(id).

import { validate } from './schema.mjs';

export const SCREEN_SCHEMA = {
  type: 'object',
  required: ['kind', 'title'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', minLength: 1, maxLength: 40 },
    title: { type: 'string', maxLength: 200 },
    body: { type: 'array', items: { type: 'object' }, maxItems: 200 },
    choices: { type: 'array', maxItems: 12, items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string', minLength: 1 }, label: { type: 'string' }, state: { type: 'string' } } } },
    actions: { type: 'array', maxItems: 8, items: { type: 'object', required: ['id', 'label'], properties: { id: { type: 'string', minLength: 1 }, label: { type: 'string' } } } },
    progress: { type: 'object', required: ['i', 'n'], properties: { i: { type: 'integer', minimum: 0 }, n: { type: 'integer', minimum: 0 } } },
    citations: { type: 'array', items: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' } } } },
    layout: { type: 'string', enum: ['actions-first', 'default'] },
    world: { type: 'object' },
    meta: { type: 'object' },
  },
};

/** @param {any} s @returns {string[]} */
export function screenProblems(s) {
  const errs = validate(SCREEN_SCHEMA, s).map(e => `${e.path}: ${e.message}`);
  const ids = [...(s?.choices || []), ...(s?.actions || [])].map(x => x.id);
  if (new Set(ids).size !== ids.length) errs.push('duplicate action/choice ids');
  return errs;
}

/** Ids the player can act on right now. @param {any} s */
export const availableActions = s => [...(s.choices || []), ...(s.actions || [])].map(x => x.id);

/** Every player-visible string on a screen (for wording and zoom checks). @param {any} s */
export function screenText(s) {
  const out = [s.title];
  for (const b of s.body || []) { if (b.text) out.push(b.text); if (b.fact) out.push(b.fact); if (b.list) out.push(...b.list); if (b.kv) for (const [k, v] of b.kv) out.push(String(k), String(v)); if (b.media?.alt) out.push(b.media.alt); }
  for (const c of [...(s.choices || []), ...(s.actions || [])]) out.push(c.label);
  return out.filter(x => typeof x === 'string');
}

/** Read a dotted path such as "meta.score" or "choices.0.id". @param {any} obj @param {string} path */
export function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
