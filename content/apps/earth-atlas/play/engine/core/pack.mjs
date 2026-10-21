// @ts-check
// Pack loading and validation (platform-free). Reading files from disk is the factory's job (tools/lib/packio.mjs);
// on device the shell hands the engine the same parsed objects.

import { validate } from './schema.mjs';
import { dataProblems } from './template.mjs';
import { shortHash } from './hash.mjs';

export const DOMAINS = ['countries', 'oceans', 'climate', 'wildlife', 'geology', 'peoples', 'food', 'history', 'sky', 'fly', 'maps', 'tools', 'other'];
export const ENTITLEMENTS = ['free', 'premium', 'pass'];
export const AGE_BANDS = ['all', '8+', '12+', '16+'];

export const MANIFEST_SCHEMA = {
  type: 'object',
  required: ['id', 'title', 'template', 'requires', 'domain', 'tags', 'difficulty', 'age', 'entitlement', 'languages'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*-[0-9a-f]{6}$', maxLength: 80 },
    title: { type: 'string', minLength: 1, maxLength: 80 },
    subtitle: { type: 'string', maxLength: 120 },
    template: { type: 'string', pattern: '^[a-z]+/[a-z0-9-]+$' },
    requires: { type: 'object', required: ['template'], additionalProperties: false, properties: { template: { type: 'string', pattern: '^\\^?\\d+(\\.\\d+){0,2}$' }, engine: { type: 'string' } } },
    domain: { type: 'string', enum: DOMAINS },
    tags: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' }, maxItems: 20, uniqueItems: true },
    region: { type: 'array', items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' }, maxItems: 20 },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    age: { type: 'string', enum: AGE_BANDS },
    entitlement: { type: 'string', enum: ENTITLEMENTS },
    languages: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[a-z]{2}(-[A-Z]{2})?$' } },
    minutes: { type: 'integer', minimum: 1, maximum: 600 },
    created: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    hero: { type: 'boolean' },
    // optional words for the About page and the game menu (engine/ui/flow.mjs); without them the template's describe/howTo/rules are shown
    about: { type: 'string', minLength: 1, maxLength: 600 },                                                    // what it is, a short paragraph
    howTo: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 240 } }, // how to play, short steps
    rules: { type: 'array', minItems: 1, maxItems: 16, items: { type: 'string', minLength: 1, maxLength: 240 } }, // the rules page
  },
};

export const THEME_SCHEMA = {
  type: 'object', required: ['preset'], additionalProperties: false,
  properties: { preset: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' }, accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, sound: { type: 'string', enum: ['none', 'soft', 'arcade'] } },
};

export const MEDIA_SCHEMA = {
  type: 'object', required: ['items'], additionalProperties: false,
  properties: { items: { type: 'array', maxItems: 500, items: { type: 'object', required: ['hash', 'kind', 'alt', 'license', 'attribution'], additionalProperties: false, properties: {
    hash: { type: 'string', pattern: '^[0-9a-f]{16,64}$' }, kind: { type: 'string', enum: ['image', 'audio', 'model', 'map'] }, alt: { type: 'string', maxLength: 300 },
    license: { type: 'string', enum: ['CC0', 'PD', 'CC-BY', 'CC-BY-SA', 'own'] }, author: { type: 'string' }, sourceUrl: { type: 'string' }, attribution: { type: 'string' }, required: { type: 'boolean', const: false }, bytes: { type: 'integer', minimum: 0 } } } } },
};

export const RECIPE_SCHEMA = {
  type: 'object', required: ['generator', 'params', 'slug', 'domain'], additionalProperties: false,
  properties: {
    generator: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },        // "manual" for hand-authored packs
    version: { type: 'string' },                                         // generator version that last built it (provenance)
    params: { type: 'object' },                                           // what makes this pack this pack (part of its identity)
    seed: { type: 'string' },
    slug: { type: 'string', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', maxLength: 50 },
    domain: { type: 'string', enum: DOMAINS },
    knowledge: { type: 'object', additionalProperties: { type: 'string' } }, // domain -> snapshot hash used at build time (provenance only)
    built: { type: 'string' },
  },
};

/** Permanent pack id: derived from identity (generator + params + slug + domain), never from content or knowledge version.
 * Allocation-free: any agent anywhere computes the same id for the same recipe. @param {any} recipe */
export function packIdFor(recipe) {
  const identity = { generator: recipe.generator, params: recipe.params, slug: recipe.slug, domain: recipe.domain };
  return `${recipe.domain}-${recipe.slug}-${shortHash(identity)}`;
}
/** Shard directory for a pack id: packs/<domain>/<xx>/<id>. @param {string} id */
export function packDirFor(id) { const domain = id.split('-')[0]; const h = id.slice(-6); return `packs/${domain}/${h.slice(0, 2)}/${id}`; }

/**
 * Validate a parsed pack against its template. Returns a list of problems (empty = valid).
 * @param {{ manifest: any, data: any, theme: any, media: any, recipe?: any, tests?: any[] }} pack
 * @param {import('./template.mjs').Template} tpl
 */
export function packProblems(pack, tpl) {
  const p = [];
  const add = (where, errs) => p.push(...errs.map(e => `${where} ${e.path ?? ''}: ${e.message ?? e}`.replace(/\s+:/, ':')));
  add('manifest.json', validate(MANIFEST_SCHEMA, pack.manifest));
  add('theme.json', validate(THEME_SCHEMA, pack.theme));
  add('media.json', validate(MEDIA_SCHEMA, pack.media));
  if (pack.recipe) { add('recipe.json', validate(RECIPE_SCHEMA, pack.recipe)); if (!p.length && pack.manifest.id !== packIdFor(pack.recipe)) p.push(`manifest.json id: must be ${packIdFor(pack.recipe)} (derived from recipe.json)`); }
  if (pack.manifest?.template && tpl && pack.manifest.template !== tpl.id) p.push(`manifest.json template: ${pack.manifest.template} but template ${tpl.id} given`);
  if (tpl && pack.manifest?.requires?.template) { const want = pack.manifest.requires.template.replace(/^\^/, ''); if (!compatible(tpl.version, want)) p.push(`manifest.json requires.template ${pack.manifest.requires.template} is not satisfied by ${tpl.id}@${tpl.version}`); }
  if (tpl) p.push(...dataProblems(tpl, pack.data).map(e => `data.json ${e}`));
  const tests = pack.tests || [];
  if (tests.length < 1 || tests.length > 3) p.push(`tests/: need 1-3 scenario tests, found ${tests.length}`);
  return p;
}

/** Caret compatibility: same major, and at least the wanted minor.patch. @param {string} have @param {string} want */
export function compatible(have, want) {
  const h = have.split('.').map(Number), w = want.split('.').map(Number);
  if (h[0] !== (w[0] ?? 0)) return false;
  if ((h[1] ?? 0) !== (w[1] ?? 0)) return (h[1] ?? 0) > (w[1] ?? 0);
  return (h[2] ?? 0) >= (w[2] ?? 0);
}
