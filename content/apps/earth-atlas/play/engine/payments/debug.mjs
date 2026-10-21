// @ts-check
// Developer builds only: the debug-unlock hook (shells/web/debug-unlock.mjs) handed to start({ debug }). While debug.unlockAll() is true every
// entitlement check answers allowed with via 'debug'; otherwise the real entitlements answer. Inert without a hook (returns the entitlements as they are).
// Store builds never get a hook (shells/generate.mjs), so this path never runs for players.

/** @param {any} entitlements @param {{ unlockAll?: () => boolean } | null | undefined} debug */
export function withDebugUnlock(entitlements, debug) {
  if (!debug || typeof debug.unlockAll !== 'function') return entitlements;
  const on = () => Boolean(debug.unlockAll && debug.unlockAll());
  return { ...entitlements, check: entry => (on() ? { allowed: true, via: 'debug' } : entitlements.check(entry)), has: entry => (on() ? true : entitlements.has(entry)) };
}
