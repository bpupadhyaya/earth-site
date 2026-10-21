// @ts-check
// Sharing without a server: challenge codes, the challenge of the day, share text and links to sibling apps.
// Pure and offline. Nothing here reads a clock, storage or the network; the caller hands everything in.
//
// CHALLENGE CODE: 16 characters shown as XXXX-XXXX-XXXX-XXXX.
//   alphabet  23456789ABCDEFGHJKMNPQRSTUVWXYZ (31 symbols: no 0, 1, I, L or O, so nothing can be mistaken for something else)
//   payload   14 characters = one 69-bit number: pack tail (24 bits: the six hex characters that end every pack id)
//             | id check (8 bits of a hash of the whole pack id) | seed (20 bits) | score + 1, or 0 for "no score" (17 bits)
//   checksum  2 characters: sum of the payload digits mod 31, and position-weighted sum mod 31. Because 31 is prime this finds
//             every single wrong character and every swap of two payload characters.
// A code names a pack that the receiving app already has in its own catalog; it carries no content, no name and no identity.

import { fnv1a64 } from './hash.mjs';
import { createRng } from './rng.mjs';

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 16;
/** Seeds that fit a code: whole numbers 0 .. SEED_SPACE - 1, written in decimal. */
export const SEED_SPACE = 1 << 20;
/** Largest score a code can carry; other scores are left out and the challenge still works. */
export const MAX_SCORE = (1 << 17) - 2;
/** Key of the "challenge of the day" record in the progress store (never a pack id). */
export const DAILY_KEY = 'daily';

const BASE = 31, DATA = CODE_LENGTH - 2;
const ID_TAIL = /-([0-9a-f]{6})$/;
const SEED = /^(0|[1-9]\d{0,6})$/;
const idCheck = id => parseInt(fnv1a64(String(id)).slice(-2), 16);
const checks = d => { let a = 0, b = 0; for (let i = 0; i < DATA; i++) { a += d[i]; b += (i + 1) * d[i]; } return [a % BASE, b % BASE]; };
const group = s => s.replace(/(.{4})(?=.)/g, '$1-');
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

/** A seed for a new play that fits a challenge code. @param {string|number} text anything that differs per play @returns {string} */
export const playSeed = text => String(parseInt(fnv1a64(String(text)).slice(-5), 16));

/** Whole days since 1970-01-01 in UTC. @param {number} ms milliseconds since the epoch, from the injected clock */
export const dayNumber = ms => Math.floor(Number(ms) / 864e5);

/**
 * @param {{ packId: string, seed: string|number, score?: number|null }} c
 * @returns {string} the code, or '' when this play cannot be put in a code (seed not made by playSeed, unusual pack id)
 */
export function encodeChallenge(c) {
  const m = ID_TAIL.exec(String(c?.packId)), seed = String(c?.seed);
  if (!m || !SEED.test(seed) || Number(seed) >= SEED_SPACE) return '';
  const score = Number.isInteger(c.score) && /** @type {number} */ (c.score) >= 0 && /** @type {number} */ (c.score) <= MAX_SCORE ? /** @type {number} */ (c.score) + 1 : 0;
  let v = (((BigInt(parseInt(m[1], 16)) << 8n | BigInt(idCheck(c.packId))) << 20n | BigInt(seed)) << 17n) | BigInt(score);
  const d = [];
  for (let i = 0; i < DATA; i++) { d.unshift(Number(v % 31n)); v /= 31n; }
  return group([...d, ...checks(d)].map(x => CODE_ALPHABET[x]).join(''));
}

/**
 * Read a code as typed or pasted: case, spaces and hyphens do not matter, and a code inside a longer pasted message is found.
 * @param {string} text
 * @returns {{ ok: true, code: string, tail: string, check: number, seed: string, score: number|null }
 *   | { ok: false, reason: 'empty'|'length'|'characters'|'checksum'|'format', length?: number, bad?: string[] }}
 */
export function decodeChallenge(text) {
  const up = String(text ?? '').toUpperCase();
  const inside = up.match(/(?:^|[^0-9A-Z])([0-9A-Z]{4}(?:[- ][0-9A-Z]{4}){3})(?![0-9A-Z])/);
  const raw = (inside ? inside[1] : up).replace(/[^0-9A-Z]/g, '');
  if (!raw) return { ok: false, reason: 'empty' };
  if (raw.length !== CODE_LENGTH) return { ok: false, reason: 'length', length: raw.length };
  const bad = [...new Set(raw)].filter(ch => !CODE_ALPHABET.includes(ch));
  if (bad.length) return { ok: false, reason: 'characters', bad };
  const d = [...raw].map(ch => CODE_ALPHABET.indexOf(ch)), [a, b] = checks(d);
  if (a !== d[DATA] || b !== d[DATA + 1]) return { ok: false, reason: 'checksum' };
  let v = 0n;
  for (let i = 0; i < DATA; i++) v = v * 31n + BigInt(d[i]);
  if (v >> 69n) return { ok: false, reason: 'format' };
  const score = Number(v & 0x1ffffn);
  return { ok: true, code: group(raw), tail: Number(v >> 45n).toString(16).padStart(6, '0'), check: Number((v >> 37n) & 0xffn),
    seed: String(Number((v >> 17n) & 0xfffffn)), score: score ? score - 1 : null };
}

/** Is this the pack a decoded code names? @param {{ tail: string, check: number }} c @param {string} packId */
export const challengeMatches = (c, packId) => ID_TAIL.exec(String(packId))?.[1] === c.tail && idCheck(packId) === c.check;

/**
 * The challenge of the day: the same entry and seed for everyone who has the same entries, on the same UTC day.
 * Each entry comes up once every `entries.length` days, in an order that changes every round, and never two days running.
 * @template {{ id: string }} E
 * @param {readonly E[]} entries packs that are on every install of this app version (a bounded list, at most a few hundred)
 * @param {number} day dayNumber(now)
 * @returns {{ entry: E, seed: string, day: number } | null}
 */
export function dailyPick(entries, day) {
  const list = [...new Map((entries || []).filter(e => e && e.id).map(e => [e.id, e])).values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const n = list.length, d = Math.floor(Number(day));
  if (!n || !Number.isFinite(d)) return null;
  const round = Math.floor(d / n), pos = d - round * n;
  let entry = list[pos];
  if (n > 2) {
    const order = r => createRng(`daily/${r}`).shuffle(list), o = order(round);
    if (o[0] === order(round - 1)[n - 1]) [o[0], o[1]] = [o[1], o[0]];
    entry = o[pos];
  }
  return { entry, seed: playSeed(`daily/${d}/${entry.id}`), day: d };
}

const STORE = { ios: /^https:\/\/apps\.apple\.com\/\S+$/, android: /^https:\/\/play\.google\.com\/store\/apps\/\S+$/ };

/** The store page for this platform, or null. Only App Store and Google Play addresses pass. @param {any} urls { ios, android } @param {string} [platform] */
export function storeLink(urls, platform) {
  const u = urls && platform ? urls[platform] : null;
  return typeof u === 'string' && STORE[platform]?.test(u) ? u : null;
}

/** Sibling apps from the app description that have a store page on this platform. @param {any} siblings [{ name, kind?, storeUrl: { ios, android } }] @param {string} [platform] */
export function siblingList(siblings, platform) {
  return (Array.isArray(siblings) ? siblings : []).map(s => ({ name: String(s?.name || ''), kind: s?.kind ? String(s.kind) : '', url: storeLink(s?.storeUrl, platform) }))
    .filter(s => s.name && s.url);
}

/** English text of every share string, by key. A string table with the same keys replaces them. */
export const SHARE_STRINGS = {
  'share.scored': 'I got {score} of {total} in "{title}" ({app}). Can you match it?',
  'share.scoredNoTotal': 'I got {score} in "{title}" ({app}). Can you match it?',
  'share.played': 'I played "{title}" in {app}. Try the same one.',
  'share.code': 'In the app, choose "Enter a code" and type: {code}',
  'share.ios': 'iPhone and iPad: {url}',
  'share.android': 'Android: {url}',
};

/**
 * The message handed to the system share sheet. Everything the friend needs is in the text: the code and where to get the app.
 * @param {{ title: string, app: string, code: string, score?: number|null, total?: number|null, storeUrl?: any }} o
 * @param {(key: string, fallback: string, vars?: Record<string, any>) => string} [S] string lookup; default: the English text
 */
export function challengeText(o, S = (k, fb, vars) => fill(fb, vars)) {
  const key = !Number.isFinite(o.score) ? 'share.played' : Number.isFinite(o.total) ? 'share.scored' : 'share.scoredNoTotal';
  const say = (k, vars) => fill(S(k, SHARE_STRINGS[k], vars), vars);
  const lines = [say(key, { score: o.score, total: o.total, title: o.title, app: o.app }), say('share.code', { code: o.code })];
  for (const p of ['ios', 'android']) { const url = storeLink(o.storeUrl, p); if (url) lines.push(say('share.' + p, { url })); }
  return lines.join('\n');
}
