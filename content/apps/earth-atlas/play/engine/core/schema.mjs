// @ts-check
// Minimal JSON Schema validator (draft 2020-12 subset) with no dependencies. Runs on device and in the factory.
// Supported: type (incl. arrays, "integer"), enum, const, properties, required, additionalProperties,
// items, minItems, maxItems, uniqueItems, minLength, maxLength, pattern, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, multipleOf, oneOf, anyOf, allOf, not, $ref (#/$defs/x, #/definitions/x), default (ignored).
// Unsupported keywords are ignored on purpose: keep template schemas inside this subset so every validator agrees.

/** @typedef {{ path: string, message: string }} SchemaError */

/**
 * @param {any} schema
 * @param {any} value
 * @param {{ root?: any }} [opts]
 * @returns {SchemaError[]}
 */
export function validate(schema, value, opts = {}) {
  const root = opts.root ?? schema;
  /** @type {SchemaError[]} */
  const errors = [];
  walk(schema, value, [], root, errors, 0);
  return errors;
}

/** @param {any} schema @param {any} value @param {string} [what] */
export function assertValid(schema, value, what = 'value') {
  const errs = validate(schema, value);
  if (errs.length) throw new Error(`${what} does not match schema: ` + errs.slice(0, 8).map(e => `${e.path}: ${e.message}`).join('; ') + (errs.length > 8 ? ` (+${errs.length - 8} more)` : ''));
  return value;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}
function typeMatches(t, v) {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return t === actual;
}
function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) throw new Error(`Unsupported $ref "${ref}" (only local refs #/... are allowed)`);
  let cur = root;
  for (const part of ref.slice(2).split('/')) { cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]; if (cur === undefined) throw new Error(`Unresolved $ref "${ref}"`); }
  return cur;
}
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a && typeof a === 'object') { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => deepEqual(a[k], b[k])); }
  return false;
}

/** Error path text from the segment stack: '$', '$.a', '$.a[2].b'. Built only when an error is recorded. @param {(string|number)[]} segs */
const render = segs => { let p = '$'; for (const k of segs) p += typeof k === 'number' ? `[${k}]` : `.${k}`; return p; };

/** @param {any} s @param {any} v @param {(string|number)[]} path segment stack (shared, pushed and popped around child walks) @param {any} root @param {SchemaError[]} errors @param {number} depth */
/** Length in code points without building an array (the same count as [...v].length). @param {string} v */
function codePoints(v) { let n = 0; for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < v.length) { const d = v.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) i++; } n++; } return n; }
const NO_PROPS = {};
const bad = (errors, path, message) => errors.push({ path: render(path), message });
function walk(s, v, path, root, errors, depth) {
  if (depth > 64) { errors.push({ path: render(path), message: 'schema nesting too deep' }); return; }
  if (s === true || s === undefined) return;
  if (s === false) { errors.push({ path: render(path), message: 'no value allowed here' }); return; }
  if (s.$ref) { walk(resolveRef(s.$ref, root), v, path, root, errors, depth + 1); return; }

  if (s.type !== undefined) {
    const ok = Array.isArray(s.type) ? s.type.some(t => typeMatches(t, v)) : typeMatches(s.type, v);
    if (!ok) { bad(errors, path, `expected ${[].concat(s.type).join('|')}, got ${typeOf(v)}`); return; }
  }
  if (s.enum !== undefined && !s.enum.some(e => deepEqual(e, v))) bad(errors, path, `must be one of ${JSON.stringify(s.enum)}`);
  if (s.const !== undefined && !deepEqual(s.const, v)) bad(errors, path, `must equal ${JSON.stringify(s.const)}`);

  if (typeof v === 'string') {
    if (s.minLength !== undefined && codePoints(v) < s.minLength) bad(errors, path, `shorter than ${s.minLength}`);
    if (s.maxLength !== undefined && codePoints(v) > s.maxLength) bad(errors, path, `longer than ${s.maxLength}`);
    if (s.pattern !== undefined && !new RegExp(s.pattern, 'u').test(v)) bad(errors, path, `does not match /${s.pattern}/`);
  }
  if (typeof v === 'number') {
    if (s.minimum !== undefined && v < s.minimum) bad(errors, path, `less than ${s.minimum}`);
    if (s.maximum !== undefined && v > s.maximum) bad(errors, path, `greater than ${s.maximum}`);
    if (s.exclusiveMinimum !== undefined && v <= s.exclusiveMinimum) bad(errors, path, `must be > ${s.exclusiveMinimum}`);
    if (s.exclusiveMaximum !== undefined && v >= s.exclusiveMaximum) bad(errors, path, `must be < ${s.exclusiveMaximum}`);
    if (s.multipleOf !== undefined && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9) bad(errors, path, `not a multiple of ${s.multipleOf}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems !== undefined && v.length < s.minItems) bad(errors, path, `fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && v.length > s.maxItems) bad(errors, path, `more than ${s.maxItems} items`);
    if (s.uniqueItems) for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (deepEqual(v[i], v[j])) { bad(errors, path, `duplicate items at ${i} and ${j}`); i = v.length; break; }
    if (s.items !== undefined) for (let i = 0; i < v.length; i++) { path.push(i); walk(s.items, v[i], path, root, errors, depth + 1); path.pop(); }
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (s.required) for (const k of s.required) if (!(k in v)) bad(errors, path, `missing required "${k}"`);
    const props = s.properties || NO_PROPS;
    for (const k in props) if (k in v) { const sub = props[k]; path.push(k); walk(sub, v[k], path, root, errors, depth + 1); path.pop(); }
    if (s.additionalProperties !== undefined && s.additionalProperties !== true) {
      for (const k of Object.keys(v)) if (!(k in props)) { if (s.additionalProperties === false) bad(errors, path, `unknown property "${k}"`); else { path.push(k); walk(s.additionalProperties, v[k], path, root, errors, depth + 1); path.pop(); } }
    }
  }
  if (s.allOf) for (const sub of s.allOf) walk(sub, v, path, root, errors, depth + 1);
  if (s.anyOf && !s.anyOf.some(sub => validate(sub, v, { root }).length === 0)) bad(errors, path, 'matches none of anyOf');
  if (s.oneOf) { const n = s.oneOf.filter(sub => validate(sub, v, { root }).length === 0).length; if (n !== 1) bad(errors, path, `matches ${n} of oneOf (need exactly 1)`); }
  if (s.not && validate(s.not, v, { root }).length === 0) bad(errors, path, 'matches forbidden schema (not)');
}
