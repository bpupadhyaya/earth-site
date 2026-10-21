// @ts-check
// THE TEMPLATE CONTRACT. Every template exports `default defineTemplate({...})`. Read templates/play/quiz for the worked example.
//
//   defineTemplate({
//     id: 'play/quiz',            folder path under templates/
//     version: '1.0.0',           semver; bump major on a breaking data-schema change
//     schema: {...},              JSON Schema (engine/core/schema.mjs subset) for pack data.json
//     describe: 'one line',       what the player does
//     label?: 'Flights'          optional: a short name for the kind of game (group heading in the Topics view of home)
//     howTo?: ['short step', ...] optional: how to play, a few short steps for the About page and the menu (a pack's manifest
//                                 howTo wins over it; without either the UI shows `describe`)
//     rules?: ['short rule', ...] optional: the rules page of the game menu (a pack's manifest rules win over it)
//     create(pack, env) {         pack = loaded pack (manifest, data, theme, media); env = see below
//       return {
//         screen()  -> Screen     what to show now (engine/core/screen.mjs)
//         act(id)   -> void       the player pressed the choice/action with this id (ids come from screen())
//         tick?(dt) -> void       optional real-time step in seconds (flight, simulations); turn-based templates omit it
//         input?(controls) -> void optional: the player's flight controls of this frame as data (engine/ui/controls.mjs), handed in by the
//                                 host before tick(dt). The template asks for controls in screen().world.controls; it never sees events
//         result()  -> object     player-visible outcome so far: { completed, score, ... } (tests and the catalog read it)
//         snapshot()-> JSON       serializable state; create(...).restore(snapshot) must reproduce the same screens
//         restore(s)-> void
//         oracle?(name) -> id     'correct' / 'wrong' return an action id: scenario tests, and Watch and Learn (the UI presses
//                                 oracle('correct') at a calm pace, one step at a time, and never records that play)
//         autoplay?() -> { act?, controls?, say? } | null   optional, for Watch and Learn when oracle('correct') is not enough (real-time
//                                 templates): the next action id, the controls to hand to input() every frame until the next step,
//                                 and a narration line; null ends the demonstration. The UI calls it every 1.6 s (turn-based) or
//                                 0.3 s (templates with tick)
//         report?(outcome) -> any optional channel for the SHELL to hand a result in from outside the template (for example a lesson
//                                 outcome {pack, score, version} into flight/lesson-gate); reached through guardInstance, never through raw
//         progress?() -> JSON     optional: the durable record the engine should persist locally (templates never touch storage)
//       }
//     }
//   })
//
// env (built by the engine, by the harness in tests; everything deterministic and offline):
//   rng        engine/core/rng.mjs stream seeded per play
//   now()      milliseconds since epoch (injectable; real-time templates use it for sun/sky)
//   settings   { textZoom: 1..3, lowData: bool, reducedMotion: bool, handed: 'right' | 'left' }
//   services   optional shared engine services provided by the app, for example { world, nav, landing }; a template must work without them
//   strings(k, fallback) UI string lookup (localization later; always returns a string)
//   log(msg)   debug output (no-op in production)
// network (optional declaration on defineTemplate): network: { optional: true, purpose: 'what it is for', hosts: ['example.org'] }
//   A template that can use the network says so here; the offline gate then allows it. It must work fully without it. Default: none.
// Rules: no DOM, no fetch, no Math.random, no Date.now (use env.now), no imports from other templates, no imports from apps/ or factory/.

import { validate } from './schema.mjs';
import { screenProblems, availableActions } from './screen.mjs';

/** @typedef {ReturnType<typeof defineTemplate>} Template */

/**
 * @param {{ id: string, version: string, schema: any, describe: string, label?: string, howTo?: string[], rules?: string[], create: (pack: any, env: any) => any }} def
 */
export function defineTemplate(def) {
  for (const k of ['id', 'version', 'schema', 'describe', 'create']) if (!(k in def)) throw new Error(`defineTemplate: missing "${k}"`);
  if ('label' in def && typeof def.label !== 'string') throw new Error('defineTemplate: label must be a string');
  for (const k of ['howTo', 'rules']) if (k in def && !(Array.isArray(def[k]) && def[k].every(x => typeof x === 'string'))) throw new Error(`defineTemplate: ${k} must be a list of strings`);
  if (!/^[a-z]+\/[a-z0-9-]+$/.test(def.id)) throw new Error(`defineTemplate: id must be "<family>/<name>", got "${def.id}"`);
  if (!/^\d+\.\d+\.\d+$/.test(def.version)) throw new Error(`defineTemplate: version must be semver, got "${def.version}"`);
  if (typeof def.create !== 'function') throw new Error('defineTemplate: create must be a function');
  return Object.freeze({ ...def, kind: 'earth-template' });
}

/**
 * Wrap an instance so that every screen is validated and every action is checked against the current screen.
 * The engine and the harness both use this; templates get precise errors instead of silent misbehaviour.
 * @param {any} instance @param {{ strict?: boolean }} [opts]
 */
export function guardInstance(instance, opts = {}) {
  for (const k of ['screen', 'act', 'result', 'snapshot', 'restore']) if (typeof instance[k] !== 'function') throw new Error(`template instance lacks ${k}()`);
  let last = null;
  const screen = () => { const s = instance.screen(); const p = screenProblems(s); if (p.length) throw new Error(`invalid screen (${s?.kind}): ${p.join('; ')}`); last = s; return s; };
  return {
    screen,
    act: id => { const s = last || screen(); const ok = availableActions(s); if (!ok.includes(id)) { if (opts.strict !== false) throw new Error(`action "${id}" not available on screen "${s.kind}" (available: ${ok.join(', ') || 'none'})`); return; } instance.act(id); last = null; },
    tick: dt => { if (instance.tick) { instance.tick(dt); last = null; } },
    /** Optional per-frame controls (see contract header). No-op when the template has no input(). */
    input: controls => { if (typeof instance.input === 'function') instance.input(controls); },
    result: () => instance.result(),
    snapshot: () => instance.snapshot(),
    restore: s => { instance.restore(s); last = null; },
    oracle: name => (instance.oracle ? instance.oracle(name) : undefined),
    /** Optional shell channel (see contract header). No-op when the template has no report(). */
    report: outcome => { if (typeof instance.report !== 'function') return undefined; const r = instance.report(outcome); last = null; return r; },
    /** Optional durable record to persist locally. undefined when the template has no progress(). */
    progress: () => (typeof instance.progress === 'function' ? JSON.parse(JSON.stringify(instance.progress())) : undefined),
    raw: instance,
  };
}

/** Validate pack data against a template schema; returns error strings. @param {Template} tpl @param {any} data */
export const dataProblems = (tpl, data) => validate(tpl.schema, data).map(e => `${e.path}: ${e.message}`);
