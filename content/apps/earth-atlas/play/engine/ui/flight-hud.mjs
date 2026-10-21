// @ts-check
// The flight screen as a simulator: while a real-time flight world is on screen the canvas fills the whole display and everything
// else is a translucent overlay at the edges (docs/PRESENTATION-FLOW.md "Flight screens"). This module owns the pieces that are not
// the canvas or the flight controls: the corner buttons (back, pause, menu), the drawer that holds the screen's text, choices and
// buttons, the safe-area probe and the measurement that tells the renderer which part of the picture is free for the instruments.
import { h } from './dom.mjs';

/** Styles of the flight screen. Everything is scoped to `.ea-fly`, which the host puts on the app root while a flight world is shown. */
export const FLY_CSS = `
html.ea-flying, html.ea-flying body { position: fixed; inset: 0; width: 100%; height: 100%; overflow: hidden; overscroll-behavior: none; }
.ea-hud, .ea-backdrop, .ea-probe { display: none; }
.ea-fly { --sl: env(safe-area-inset-left, 0px); --st: env(safe-area-inset-top, 0px); --sr: env(safe-area-inset-right, 0px); --sb: env(safe-area-inset-bottom, 0px); --fg-hud: #ffffff; --glass: rgba(10, 15, 22, 0.58);
  position: fixed; inset: 0; min-height: 0; padding: 0; overflow: hidden; background: #05080c; }
.ea-fly > .ea-bar { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); }
.ea-app.ea-fly > .ea-main { position: fixed !important; inset: 0 !important; max-width: none !important; margin: 0 !important; padding: 0 !important; gap: 0 !important; display: block !important; overflow: hidden !important; }
.ea-app.ea-fly > .ea-main > canvas.ea-world { position: fixed !important; inset: 0 !important; z-index: 0; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; aspect-ratio: auto !important; grid-column: auto !important; touch-action: none; }
.ea-app.ea-fly > .ea-main > :not(canvas) { grid-column: auto !important; }
.ea-fly .ea-after, .ea-fly .ea-state { display: none; }
.ea-fly .ea-probe { display: block; position: fixed; left: 0; top: 0; width: 0; height: 0; visibility: hidden; padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); }
.ea-fly .ea-hud { display: block; position: fixed; inset: 0; z-index: 40; pointer-events: none; }
.ea-hud-b { pointer-events: auto; position: absolute; top: calc(var(--st) + 8px); width: 44px; height: 44px; padding: 0; border-radius: 50%; border: 1px solid rgba(255,255,255,0.28); background: var(--glass); color: #fff; font: inherit; cursor: pointer; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.ea-hud-b:active { background: rgba(255,255,255,0.28); }
.ea-hud-back { left: calc(var(--sl) + 8px); }
.ea-hud-menu { right: calc(var(--sr) + 8px); }
.ea-hud-pause { right: calc(var(--sr) + 60px); }
.ea-hud-back::before { content: ""; position: absolute; left: 17px; top: 15px; width: 11px; height: 11px; border-left: 3px solid #fff; border-bottom: 3px solid #fff; transform: rotate(45deg); }
.ea-hud-menu::before { content: ""; position: absolute; left: 13px; top: 14px; width: 18px; height: 3px; background: #fff; box-shadow: 0 7px 0 #fff, 0 14px 0 #fff; }
.ea-hud-pause::before, .ea-hud-pause::after { content: ""; position: absolute; top: 13px; width: 5px; height: 18px; background: #fff; border-radius: 1px; }
.ea-hud-pause::before { left: 13px; } .ea-hud-pause::after { left: 26px; }
.ea-hud-pause.is-paused::before { left: 16px; top: 12px; width: 0; height: 0; background: none; border-radius: 0; border-left: 15px solid #fff; border-top: 10px solid transparent; border-bottom: 10px solid transparent; }
.ea-hud-pause.is-paused::after { display: none; }
.ea-hud-pause[hidden] { display: none; }
.ea-backdrop { position: fixed; inset: 0; z-index: 25; background: rgba(0,0,0,0.35); }
.ea-fly.ea-drawer .ea-backdrop { display: block; }
.ea-fly .ea-stage { position: fixed; z-index: 30; top: 0; right: 0; bottom: 0; width: min(25em, 90vw); overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain;
  padding: calc(var(--st) + 3.4em) calc(var(--sr) + 1em) calc(var(--sb) + 1.2em) 1em; background: color-mix(in srgb, var(--bg) 94%, transparent); border-left: 1px solid rgba(255,255,255,0.14);
  box-shadow: -0.5em 0 1.5em rgba(0,0,0,0.4); transform: translateX(105%); visibility: hidden; transition: transform 0.2s ease, visibility 0s linear 0.2s; font-size: calc(15px * var(--zoom, 1)); }
.ea-fly.ea-drawer .ea-stage { transform: none; visibility: visible; transition: transform 0.2s ease; }
.ea-fly .ea-stage .earth-screen { padding: 0; max-width: none; gap: 0.7em; }
.ea-fly .ea-stage .earth-title { font-size: 1.15em; }
.ea-fly .ea-watch { position: fixed; z-index: 28; left: 50%; transform: translateX(-50%); top: calc(var(--st) + 56px); width: min(32em, calc(100vw - 16px)); border: 1px solid rgba(255,255,255,0.2); border-radius: 0.8em; background: color-mix(in srgb, var(--card) 88%, transparent); padding: 0.5em 0.8em; }

/* flight controls over the picture: throttle lever at one edge, trim beside it, rudder along the bottom of that column, round buttons at the other edge, a floating stick under the finger */
.ea-fly .ea-fc { position: fixed; inset: 0; z-index: 10; display: block; padding: 0; gap: 0; width: auto; pointer-events: none; color: #fff; font-size: 12px; touch-action: none; }
.ea-fly .ea-fc[hidden] { display: none; }
.ea-fly .ea-fc > *, .ea-fly .ea-fc-g-throttle, .ea-fly .ea-fc-g-trim, .ea-fly .ea-fc-g-yaw, .ea-fly .ea-fc-g-stick, .ea-fly .ea-fc-btns > * { pointer-events: auto; }
.ea-fly .ea-fc:not(.open) .ea-fc-main, .ea-fly .ea-fc:not(.open) .ea-fc-btns { display: contents; }
.ea-fly .ea-fc:not(.open) .ea-fc-steps { display: none; }
.ea-fly .ea-fc-zone { position: fixed; top: calc(var(--st) + 56px); bottom: 0; right: 0; width: 56%; pointer-events: auto; touch-action: none; }
.ea-fly .ea-fc[data-hand="left"] .ea-fc-zone { right: auto; left: 0; }
.ea-fly .ea-fc:not(.open) .ea-fc-group { position: absolute; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.ea-fly .ea-fc:not(.open) .ea-fc-label { font-size: 10px; letter-spacing: 0.06em; opacity: 0.9; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
.ea-fly .ea-fc:not(.open) .ea-fc-track { border: 1px solid rgba(255,255,255,0.35); background: var(--glass); -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }
.ea-fly .ea-fc:not(.open) .ea-fc-thumb { background: rgba(255,255,255,0.78); border-radius: 0.5em; }
.ea-fly .ea-fc:not(.open) .ea-fc-track.v { width: 100%; min-width: 0; height: auto; min-height: 0; flex: 1 1 auto; border-radius: 26px; }
.ea-fly .ea-fc:not(.open) .ea-fc-track.v .ea-fc-thumb { left: 6%; right: 6%; height: 14%; }
.ea-fly .ea-fc:not(.open) .ea-fc-track.h { width: 100%; height: 34px; min-height: 0; border-radius: 17px; }
.ea-fly .ea-fc:not(.open) .ea-fc-track.h .ea-fc-thumb { width: 18%; top: 10%; bottom: 10%; border-radius: 14px; }
.ea-fly .ea-fc:not(.open) .ea-fc-g-throttle { left: calc(var(--sl) + 8px); top: calc(var(--st) + 60px); bottom: calc(var(--sb) + 66px); width: 52px; }
.ea-fly .ea-fc:not(.open) .ea-fc-g-trim { left: calc(var(--sl) + 68px); top: calc(var(--st) + 96px); width: 44px; }
.ea-fly .ea-fc:not(.open) .ea-fc-g-trim .ea-fc-track { display: none; }
.ea-fly .ea-fc:not(.open) .ea-fc-g-trim .ea-fc-steps { display: flex; flex-direction: column; gap: 6px; }
.ea-fly .ea-fc:not(.open) .ea-fc-g-yaw { left: calc(var(--sl) + 8px); bottom: calc(var(--sb) + 8px); width: min(40vw, 190px); }
.ea-fly .ea-fc:not(.open) .ea-fc-g-yaw .ea-fc-steps { display: none; }
.ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-g-throttle { left: auto; right: calc(var(--sr) + 8px); }
.ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-g-trim { left: auto; right: calc(var(--sr) + 68px); }
.ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-g-yaw { left: auto; right: calc(var(--sr) + 8px); }
/* the ring of the stick: where it rests, and where the finger put it */
.ea-fly .ea-fc:not(.open) .ea-fc-g-stick { position: static; }
.ea-fly .ea-fc:not(.open) .ea-fc-stick { position: fixed; z-index: 9; width: 104px; min-width: 0; right: calc(var(--sr) + 128px); bottom: calc(var(--sb) + 14px); border: 2px solid rgba(255,255,255,0.45); background: rgba(255,255,255,0.06); pointer-events: none; opacity: 0.8; }
.ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-stick { right: auto; left: calc(var(--sl) + 128px); }
.ea-fly .ea-fc-held .ea-fc-stick { opacity: 1 !important; border-color: rgba(255,255,255,0.85) !important; background: rgba(255,255,255,0.12) !important; }
.ea-fly .ea-fc:not(.open) .ea-fc-knob { background: rgba(255,255,255,0.7); }
/* round buttons */
.ea-fly .ea-fc:not(.open) .ea-fc-btns { position: fixed; right: calc(var(--sr) + 8px); top: calc(var(--st) + 64px); bottom: calc(var(--sb) + 8px); display: flex; flex-direction: column; flex-wrap: wrap-reverse; align-content: flex-start; gap: 6px; pointer-events: none; }
.ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-btns { right: auto; left: calc(var(--sl) + 8px); flex-wrap: wrap; }
.ea-fly .ea-fc:not(.open) .ea-fc-btns > button, .ea-fly .ea-fc:not(.open) .ea-fc-g-trim .ea-fc-steps > button { position: relative; width: 46px; height: 46px; min-width: 0; min-height: 0; padding: 0; border-radius: 50%; font-size: 0; line-height: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.32); background: var(--glass); color: #fff; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); overflow: hidden; }
.ea-fly .ea-fc:not(.open) .ea-fc-btns > button::before, .ea-fly .ea-fc:not(.open) .ea-fc-g-trim .ea-fc-steps > button::before { content: attr(data-glyph); font-size: 17px; font-weight: 700; }
.ea-fly .ea-fc:not(.open) .ea-fc-btns > button::after, .ea-fly .ea-fc:not(.open) .ea-fc-g-trim .ea-fc-steps > button::after { content: attr(data-short); font-size: 9px; margin-top: 1px; letter-spacing: 0; white-space: normal; text-align: center; line-height: 1; max-width: 92%; overflow-wrap: anywhere; }
.ea-fly .ea-fc:not(.open) .ea-fc-btns > button[aria-pressed="true"] { background: rgba(70, 200, 255, 0.38); border-color: rgba(120, 220, 255, 0.9); }
.ea-fly .ea-fc:not(.open) .ea-fc-flaplabel { pointer-events: none; align-self: center; font-size: 10px; padding: 0 2px; }
.ea-fly .ea-fc:not(.open) .ea-fc-toggle { position: fixed; top: calc(var(--st) + 8px); right: calc(var(--sr) + 112px); width: 44px; height: 44px; min-height: 0; min-width: 0; padding: 0; border-radius: 50%; font-size: 0; border: 1px solid rgba(255,255,255,0.28); background: var(--glass); color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
.ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-toggle { right: calc(var(--sr) + 112px); }
.ea-fly .ea-fc:not(.open) .ea-fc-toggle::before { content: attr(data-glyph); font-size: 17px; font-weight: 700; line-height: 0.7; padding-bottom: 5px; }
.ea-fly .ea-fc:not(.open) .ea-fc-toggle::after { content: attr(data-short); font-size: 8px; }
/* the Controls sheet: every step button of every axis, in the old layout, over the picture */
.ea-fly .ea-fc.open { pointer-events: auto; overflow-y: auto; background: rgba(6, 10, 16, 0.9); padding: calc(var(--st) + 56px) calc(var(--sr) + 16px) calc(var(--sb) + 16px) calc(var(--sl) + 16px); font-size: 15px; display: flex; flex-direction: column; gap: 0.8em; }
.ea-fly .ea-fc.open .ea-fc-zone { display: none; }
.ea-fly .ea-fc.open .ea-fc-toggle { position: fixed; top: calc(var(--st) + 8px); right: calc(var(--sr) + 112px); z-index: 2; }
.ea-fly .ea-fc.open .ea-fc-stick { position: relative; }
.ea-fly .ea-fc.open .ea-fc-track.v { height: 8em; }

/* a craft flown with buttons alone (a balloon): large round buttons */
.ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button { width: 68px; height: 68px; }
.ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button::before { font-size: 24px; }
.ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button::after { font-size: 11px; }
.ea-fly .ea-fc-big:not(.open) .ea-fc-btns { gap: 10px; }
/* a portrait screen: the lever and trim under the top buttons, the rudder above a row of round buttons along the bottom edge */
@media (max-aspect-ratio: 1/1) {
  .ea-fly .ea-fc:not(.open) .ea-fc-g-throttle { top: calc(var(--st) + 128px); bottom: auto; height: min(28vh, 240px); }
  .ea-fly .ea-fc:not(.open) .ea-fc-g-trim { top: calc(var(--st) + 176px); }
  .ea-fly .ea-fc:not(.open) .ea-fc-g-yaw { left: 50%; transform: translateX(-50%); bottom: calc(var(--sb) + 66px); width: min(72vw, 300px); }
  .ea-fly .ea-fc:not(.open) .ea-fc-btns { top: auto; left: calc(var(--sl) + 8px); right: calc(var(--sr) + 8px); bottom: calc(var(--sb) + 8px); flex-direction: row; flex-wrap: nowrap; justify-content: center; align-items: center; }
  .ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-btns { left: calc(var(--sl) + 8px); }
  .ea-fly .ea-fc:not(.open) .ea-fc-btns > button { width: 42px; height: 42px; }
  .ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button { width: 68px; height: 68px; }
  .ea-fly .ea-fc:not(.open) .ea-fc-stick { right: calc(var(--sr) + 16px); bottom: auto; top: 34vh; }
  .ea-fly .ea-fc[data-hand="left"]:not(.open) .ea-fc-stick { right: auto; left: calc(var(--sl) + 16px); }
  .ea-fly .ea-fc-zone { bottom: 0; }
}
/* a short landscape phone: smaller round buttons so two columns of them fit */
@media (max-height: 430px) and (min-aspect-ratio: 1/1) {
  .ea-fly .ea-fc:not(.open) .ea-fc-btns > button { width: 40px; height: 40px; }
  .ea-fly .ea-fc:not(.open) .ea-fc-btns > button::before { font-size: 15px; }
  .ea-fly .ea-fc:not(.open) .ea-fc-stick { width: 92px; }
}
@media (min-width: 900px) and (min-height: 700px) {
  .ea-fly .ea-fc { font-size: 14px; }
  .ea-fly .ea-fc:not(.open) .ea-fc-g-throttle { width: 64px; }
  .ea-fly .ea-fc:not(.open) .ea-fc-g-trim { left: calc(var(--sl) + 84px); }
  .ea-fly .ea-fc:not(.open) .ea-fc-btns > button { width: 54px; height: 54px; }
  .ea-fly .ea-fc:not(.open) .ea-fc-stick { width: 132px; right: calc(var(--sr) + 150px); }
  .ea-hud-b { width: 52px; height: 52px; }
  .ea-hud-pause { right: calc(var(--sr) + 68px); }
  .ea-fly .ea-fc:not(.open) .ea-fc-toggle { right: calc(var(--sr) + 128px); width: 52px; height: 52px; }
}
/* a craft flown with buttons alone keeps large round buttons on every screen (the rules above shrink the ordinary ones): a label never wraps */
.ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button { width: 64px; height: 64px; }
.ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button::after { font-size: 11px; font-weight: 600; white-space: nowrap; max-width: none; overflow-wrap: normal; }
@media (max-height: 430px) and (min-aspect-ratio: 1/1) {
  .ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button { width: 56px; height: 56px; }
  .ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button::before { font-size: 19px; }
  .ea-fly .ea-fc-big:not(.open) .ea-fc-btns { gap: 8px; }
}
@media (min-width: 900px) and (min-height: 700px) {
  .ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button { width: 76px; height: 76px; }
  .ea-fly .ea-fc-big:not(.open) .ea-fc-btns > button::after { font-size: 13px; }
}
`;

/**
 * The corner buttons, drawer backdrop and safe-area probe of the flight screen.
 * @param {{ S: (k: string, fb: string) => string, back: () => void, menu: (open?: boolean) => void, pause: () => void }} o
 */
export function createHud(o) {
  const { S } = o;
  const back = h('button.ea-hud-b.ea-hud-back', { type: 'button', 'aria-label': S('back', 'Back'), onclick: () => o.back() });
  const pause = h('button.ea-hud-b.ea-hud-pause', { type: 'button', hidden: true, 'aria-label': S('pause', 'Pause'), onclick: () => o.pause() });
  const menu = h('button.ea-hud-b.ea-hud-menu', { type: 'button', 'aria-label': S('fc.menu', 'Flight menu'), 'aria-expanded': 'false', onclick: () => o.menu() });
  const backdrop = h('div.ea-backdrop', { onclick: () => o.menu(false) });
  const probe = h('div.ea-probe', { 'aria-hidden': 'true' });
  const el = h('div.ea-hud', { role: 'group', 'aria-label': S('fc.hud', 'Flight screen buttons') }, back, pause, menu);
  /** Safe-area insets in CSS pixels. */
  const insets = () => {
    const z = { t: 0, r: 0, b: 0, l: 0 };
    if (typeof globalThis.getComputedStyle !== 'function') return z;
    try { const c = globalThis.getComputedStyle(probe), n = v => parseFloat(v) || 0; return { t: n(c.paddingTop), r: n(c.paddingRight), b: n(c.paddingBottom), l: n(c.paddingLeft) }; } catch { return z; }
  };
  return {
    el, backdrop, probe,
    /** Show or hide the pause button and keep its look in step with the screen's own Pause / Resume action. */
    setPause(action) { pause.hidden = !action; if (action) { pause.setAttribute('aria-label', action.label); pause.classList.toggle('is-paused', action.id === 'pause' && /resume|go on|continue/i.test(action.label)); } },
    setOpen(open) { menu.setAttribute('aria-expanded', String(open)); },
    insets,
    /**
     * What the instruments may use: the viewport minus the controls that sit over it, as fractions of the canvas for engine/render.
     * `controls`: the elements of the flight controls that take room (levers, buttons, resting ring).
     * @param {any[]} controls @param {number} w @param {number} hgt viewport size in CSS pixels
     */
    layout(controls, w, hgt) {
      const ins = insets(), portrait = hgt >= w * 1.02, gap = 8;
      let l = ins.l, r = ins.r, b = ins.b + 4, t = ins.t + 4, ts = 0, sl = 0, sr = 0;
      const rects = controls.filter(e => e && !e.hidden).map(e => (typeof e.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : null)).filter(q => q && q.width > 0 && q.height > 0);
      if (portrait) {
        t = ins.t + 56; ts = 0.04;
        for (const q of rects) {
          if (q.top > hgt * 0.55) b = Math.max(b, hgt - q.top + gap);
          else if (q.left + q.width / 2 < w * 0.4) sl = Math.max(sl, q.right + gap);
          else if (q.left + q.width / 2 > w * 0.6) sr = Math.max(sr, w - q.left + gap);
        }
      } else {
        ts = Math.min(0.4, (Math.max(ins.l, ins.r) + 176) / Math.max(1, w));
        for (const q of rects) { const cx = q.left + q.width / 2; if (cx < w * 0.4) l = Math.max(l, q.right + gap); else if (cx > w * 0.6) r = Math.max(r, w - q.left + gap); }
      }
      return { l: l / Math.max(1, w), r: r / Math.max(1, w), t: t / Math.max(1, hgt), b: b / Math.max(1, hgt), ts, sl: sl / Math.max(1, w), sr: sr / Math.max(1, w) };
    },
  };
}
