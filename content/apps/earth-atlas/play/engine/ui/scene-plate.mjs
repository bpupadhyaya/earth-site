// @ts-check
// Scene plate: an optional picture shown INSIDE an actual game screen (quiz, lesson, map and briefing screens) to make the
// scene feel real. It is a separate panel above the screen's text card; text is never drawn on it and it is never used behind
// icons, listings or menus (owner direction 2026-10-13, docs/SCENES.md). A game may carry `scene: { hero, card, portrait, alt }`
// (files the app ships, built at prepare time from the owner's local folder by tools/scenes; never committed). Everything here
// answers "nothing" when there is no scene or the player turned low data mode on: pictures are never required.
const ok = v => typeof v === 'string' && /^\.?\/?[\w./-]+\.(jpe?g|webp|png)$/i.test(v);

/** A clean scene object from app data, or null. @param {any} s */
export function cleanScene(s) {
  if (!s || typeof s !== 'object' || !ok(s.hero)) return null;
  return { hero: s.hero, card: ok(s.card) ? s.card : s.hero, portrait: ok(s.portrait) ? s.portrait : s.hero, alt: typeof s.alt === 'string' ? s.alt.slice(0, 300) : '' };
}
/**
 * The picture address for a play, or '' for none: the game's card picture (matched to the game by tag at build time).
 * @param {any} ctx @param {any} game @param {string} packId
 */
export function plateSrc(ctx, game, packId) {
  const sc = game && cleanScene(game.scene);
  if (!sc) return '';
  let low = false;
  try { low = Boolean(ctx.settings.get().lowData); } catch { /* defaults */ }
  if (low) return '';
  try { if (globalThis.navigator?.connection?.saveData) return ''; } catch { /* no connection API */ }   // the device asks for less data
  return sc.card;   // the small card picture only (640 px): a plate never pulls the hero or the portrait file
}
