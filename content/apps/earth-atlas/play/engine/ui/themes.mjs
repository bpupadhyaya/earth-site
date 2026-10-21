// @ts-check
// Bounded set of theme presets. A pack picks one by name (theme.json "preset") and may set one accent colour.
// Palettes are eye-comfort first: warm low-glare backgrounds, high-contrast text, no pure white or pure black.
export const THEMES = {
  dawn:   { bg: '#f7f3ea', fg: '#2a2622', muted: '#6b645b', accent: '#b4532a', card: '#fffdf8', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  ocean:  { bg: '#eef4f6', fg: '#1f2a30', muted: '#5a6b74', accent: '#1f6f8b', card: '#f9fcfd', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  forest: { bg: '#eff4ec', fg: '#1f2a1e', muted: '#5b6b58', accent: '#3b7a3a', card: '#f8fbf6', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  sand:   { bg: '#f6efe3', fg: '#2b241a', muted: '#6e6254', accent: '#9a6b1f', card: '#fdf9f1', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  night:  { bg: '#1b1d22', fg: '#e7e4dc', muted: '#a6a39b', accent: '#e0a458', card: '#242730', font: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  // Earth brand family (direction A "Daybreak", docs/BRAND.md; tokens: brand/earth/A-daybreak/tokens.json). Every text pair >= 4.5:1.
  earth:         { bg: '#f3f6f6', fg: '#10202a', muted: '#4d5d66', accent: '#b3471c', card: '#fcfdfd', font: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  'earth-night': { bg: '#0b1720', fg: '#e9eff1', muted: '#a2b2ba', accent: '#ff9a52', card: '#13222d', font: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
};
// Per-bucket accent tints for the earth presets (theme.json { "preset": "earth", "accent": EARTH_TINTS.fly.light }); each passes 4.5:1
// on that preset's bg and card. Tint only the accent; never the background or text colours.
export const EARTH_TINTS = {
  explore: { light: '#1b6a94', dark: '#6cc8f2' },
  fly:     { light: '#3d5f9e', dark: '#9db8ef' },
  learn:   { light: '#b3471c', dark: '#ff9a52' },
  nature:  { light: '#2f7040', dark: '#8fd89a' },
  tools:   { light: '#86600f', dark: '#ffd59a' },
};
// The full-bleed background behind every page (`--stage`) and whether the theme is dark (`--dark`: 1 or 0, for the logo and glass
// surfaces). The Earth presets get the Daybreak sky: space blue with the deep atmosphere rising and one warm sunrise glow at the top
// right (docs/BRAND.md); the other presets keep their flat background.
const STAGE = {
  earth: 'radial-gradient(130% 70% at 88% -12%, #ffd59a66, #ff9a5224 38%, #ff9a5200 62%), radial-gradient(120% 80% at 0% 0%, #6cc8f259, #6cc8f200 60%), linear-gradient(180deg, #cfe6f1 0%, #e6f0f3 38%, #f3f6f6 100%)',
  'earth-night': 'radial-gradient(120% 55% at 100% -8%, #ff9a5270, #e2582a30 36%, #e2582a00 62%), radial-gradient(90% 60% at -10% 10%, #2f86c470, #2f86c400 60%), linear-gradient(180deg, #1c5784 0%, #164873 26%, #113656 55%, #0c2236 82%, #0b1720 100%)',
};
for (const [k, t] of Object.entries(THEMES)) Object.assign(t, { stage: STAGE[k] || t.bg, dark: k === 'night' || k === 'earth-night' ? '1' : '0' });
// Approved Earth accents (brand/earth palette, docs/BRAND.md) for game cards and generated game icons: one per game, never for text.
export const GAME_TINTS = { atmosphere: '#6cc8f2', steel: '#9db8ef', sunrise: '#ff9a52', ember: '#e2582a', leaf: '#8fd89a', horizon: '#ffd59a' };
export const THEME_NAMES = Object.keys(THEMES);
/** @param {{preset: string, accent?: string}} theme */
export function resolveTheme(theme) { const t = THEMES[theme?.preset] || THEMES.dawn; return theme?.accent ? { ...t, accent: theme.accent } : t; }
