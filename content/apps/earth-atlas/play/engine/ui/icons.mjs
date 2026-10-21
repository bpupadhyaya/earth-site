// @ts-check
// App icons for the home grid and the About page. A game shows its own icon when the app supplies one (config `icons.url(entry)`,
// for example a file made by a factory icon tool); otherwise a generated tile: a rounded square lit from above with a glyph for the
// kind of game (template), or for the topic (catalog domain) when the kind has none. Colours come only from the theme tokens, mixed
// in code; the first region or tag moves the shade, so games about one place read as a set. The tile is an SVG data address, so it
// works offline and in every WebView.

/** Glyph of the topic (catalog domain): used when the kind of game has none of its own. Paths on a 64 x 64 grid, drawn as strokes. */
const GLYPH = {
  countries: 'M20 12v42M20 14c8-4 14 4 22 0s10-2 10-2v20s-4 2-10 2-14-4-22 0',
  oceans: 'M10 30q6-6 12 0t12 0 12 0 12 0M10 42q6-6 12 0t12 0 12 0 12 0',
  climate: 'M32 18a10 10 0 1 1 0 20 10 10 0 1 1 0-20M32 8v5M32 43v5M14 28h5M45 28h5',
  wildlife: 'M16 48C16 24 34 14 50 14c0 22-12 34-34 34zM16 48l20-20',
  geology: 'M8 50l16-26 9 13 7-9 16 22z',
  peoples: 'M24 26a7 7 0 1 0 0-.1M40 26a7 7 0 1 0 0-.1M12 50c0-9 6-14 12-14s12 5 12 14M28 50c0-9 6-14 12-14s12 5 12 14',
  food: 'M10 32h44c0 12-10 18-22 18S10 44 10 32zM24 14v10M32 12v12M40 14v10',
  history: 'M18 12h28M18 52h28M20 12c0 12 24 14 24 20s-24 8-24 20M44 12c0 12-24 14-24 20s24 8 24 20',
  sky: 'M32 20a12 12 0 1 1 0 24 12 12 0 1 1 0-24M8 38c8-10 40-22 48-16',
  fly: 'M32 8v46M8 32l24-8 24 8M22 52l10-5 10 5',
  maps: 'M32 52S16 36 16 26a16 16 0 1 1 32 0c0 10-16 26-16 26zM32 20a6 6 0 1 0 0 12 6 6 0 1 0 0-12',
  tools: 'M14 46l20-20M40 12a10 10 0 0 0-8 14l14 14a10 10 0 0 0 6-12l-6 6-6-2-2-6 6-6z',
  other: 'M32 12a20 20 0 1 0 0 40 20 20 0 1 0 0-40M12 32h40M32 12c-8 8-8 32 0 40M32 12c8 8 8 32 0 40',
};
/** Glyph of the kind of game (template name), so the games of one topic look different from each other. */
const KIND = {
  quiz: 'M14 14h36a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H30l-10 8v-8h-6a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4zM26 23a6 6 0 1 1 7 6v3M33 37v1',
  truefalse: 'M10 34l7 7 13-15M38 24l14 14M52 24L38 38',
  match: 'M15 16a5 5 0 1 0 .1 0M15 40a5 5 0 1 0 .1 0M49 16a5 5 0 1 0 .1 0M49 40a5 5 0 1 0 .1 0M20 21l24 24M20 45l24-24',
  sort: 'M14 50V42M26 50V34M38 50V26M50 50V16',
  estimate: 'M12 44a20 20 0 0 1 40 0M32 44l10-14M10 50h44',
  flashcards: 'M14 22h28v24H14zM22 22v-6h28v24h-8',
  'map-pin': GLYPH.maps,
  timeline: 'M8 32h48M16 32v-10M32 32v10M48 32v-10',
  lesson: 'M32 18v32M32 18c-6-4-14-4-20-2v32c6-2 14-2 20 2M32 18c6-4 14-4 20-2v32c-6-2-14-2-20 2',
  globe: GLYPH.other,
  almanac: 'M14 18h36v32H14zM14 26h36M22 12v10M42 12v10',
  converter: 'M12 24h36l-8-8M52 40H16l8 8',
  balloon: 'M32 10a14 14 0 0 1 14 14c0 10-9 16-14 20-5-4-14-10-14-20a14 14 0 0 1 14-14zM28 44h8v6h-8z',
  rotor: 'M10 18h44M32 18v8M18 34a14 8 0 0 0 28 0 14 8 0 0 0-28 0M46 34h10M22 44l-4 6M42 44l4 6',
  'ground-ops': 'M14 50V18h20v32M34 26h8l6 6v14a3 3 0 0 1-6 0V36M18 26h12',
  'chart-reading': 'M10 50l12-14 10 8 10-16 12 10M10 14v36h44',
  career: 'M10 50h12V40h12V30h12V20h8',
  'lesson-gate': 'M14 50V16h36v34M14 28h36M26 40l5 5 9-10',
  'seat-roles': 'M22 12v26h20l4 14M22 38l-4 14M16 24h6',
  orbital: 'M32 26a6 6 0 1 1 0 12 6 6 0 1 1 0-12M8 32a24 10-20 0 0 48 0 24 10-20 0 0-48 0',
};

const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); const n = m ? parseInt(m[1], 16) : 0x777777; return [n >> 16, (n >> 8) & 255, n & 255]; };
/** Mix two #rrggbb colours: t = 0 gives a, 1 gives b. */
export const mix = (a, b, t) => '#' + hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t).toString(16).padStart(2, '0')).join('');
const small = s => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.charCodeAt(0)) % 997; return x / 996; };

/**
 * The generated tile of a catalog entry as an SVG data address.
 * @param {{ id?: string, d?: string, tp?: string, r?: string[], g?: string[] }} entry @param {{ accent: string, fg: string, bg: string, card: string }} theme
 */
export function tileIcon(entry, theme) {
  const [fam, kind] = String(entry.tp || '').split('/');
  // the shade follows the first region (or tag) so games about one place read as a set; the family takes it a step lighter or darker
  const k = small((entry.r || [])[0] || (entry.g || [])[0] || entry.id || ''), lift = { learn: 0.22, explore: 0.12, tools: -0.1, fly: -0.15, flight: -0.2 }[fam] || 0;
  const c = lift >= 0 ? mix(theme.accent, theme.card, lift) : mix(theme.accent, theme.fg, -lift);
  const base = k < 0.5 ? mix(c, theme.fg, 0.9 * (0.5 - k)) : mix(c, theme.card, 0.8 * (k - 0.5));
  const top = mix(base, theme.card, 0.3), bottom = mix(base, theme.fg, 0.38), ink = mix(theme.card, theme.bg, 0.15), shade = mix(bottom, theme.fg, 0.5);
  const glyph = KIND[kind] || (fam === 'fly' || fam === 'flight' ? GLYPH.fly : '') || GLYPH[entry.d || ''] || GLYPH.other;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`
    + `<radialGradient id="l" cx=".3" cy=".1" r=".75"><stop offset="0" stop-color="${theme.card}" stop-opacity=".6"/><stop offset="1" stop-color="${theme.card}" stop-opacity="0"/></radialGradient></defs>`
    + `<rect x="2" y="4" width="60" height="58" rx="14" fill="${shade}"/><rect x="2" y="2" width="60" height="58" rx="14" fill="url(#g)"/><rect x="2" y="2" width="60" height="30" rx="14" fill="url(#l)"/>`
    + `<g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="4.5"><path d="${glyph}" stroke="${shade}" transform="translate(1 2)"/><path d="${glyph}" stroke="${ink}"/></g></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

/** Icon address for an entry: the app's own icon when it has one, else the generated tile. */
export function iconFor(ctx, entry) {
  let own = null;
  try { own = ctx.cfg.icons?.url?.(entry) || null; } catch (e) { ctx.log(e); }
  return own || tileIcon(entry, ctx.theme());
}
