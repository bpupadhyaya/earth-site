// @ts-check
// Flight input for real-time `world` screens, as data. The template declares what it needs in `screen.world.controls`
// (CONTROLS_SCHEMA); the player host shows the controls under the canvas and hands the template one normalised object per
// frame through its optional `input(controls)` method, before `tick(dt)`. Templates never see events, keys or the DOM.
//
//   const fc = createFlightControls({ canvas, pick: (x, y) => renderer.pick(x, y), strings, settings });
//   host.append(fc.el);  fc.configure(screen.world.controls, screen.world.pick);
//   each frame: instance.input(fc.read(dt)); instance.tick(dt); renderer.frame(screen.world, fc.overlays());
//
// Sources, merged: on-screen stick, throttle, rudder and trim (touch or mouse), step buttons for every axis (no gesture needed),
// keyboard, a gamepad, and device tilt (off until the player turns it on; asks the system for permission where required).
// Output: { pitch, roll, yaw: -1..1, throttle: 0..1, trim: -1..1, flaps: 0..1, gear: 0|1, brakes: 0..1,
//           buttons: { id: boolean }, pressed: [id], pick: { id, lat, lon, elevationM } | null, source,
//           drag: { dx, dy }, zoom }
// pitch > 0 = nose up (stick back), roll > 0 = right wing down, yaw > 0 = nose right. No clock is read: read(dt) takes the time step.
//
// Maps and globes: a screen that asks for `drag: true` also gets what the player did on the canvas since the previous frame.
// drag = movement of one finger or the mouse (of the midpoint of two fingers) as fractions of the canvas width and height,
// dx > 0 to the right, dy > 0 down; zoom = factor from a pinch, the wheel or the + and - keys, above 1 = closer, 1 = no change.
// Without the request both stay { dx: 0, dy: 0 } and 1, the canvas keeps scrolling the page and the flight controls are unchanged.
// A press that moves more than 12 px is a drag and never answers a pick. Gestures have no buttons of their own here: a template
// that asks for `drag` keeps offering the same moves as screen buttons, a stick or control buttons.

import { validate } from '../core/schema.mjs';

const B = { type: 'boolean' };
/** What a template may ask for in `screen.world.controls`. Everything is optional; `{}` gives a stick alone. */
export const CONTROLS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stick: B,                                                   // pitch and roll (default true)
    throttle: { type: ['boolean', 'number'] },                  // a number is the starting value 0..1
    rudder: B, trim: B,
    flaps: { type: 'integer', minimum: 0, maximum: 8 },         // number of flap steps (0 = none)
    gear: B, brakes: B,
    tilt: B,                                                    // offer device tilt as a steering option
    drag: B,                                                    // report drags, pinches and the wheel on the canvas (maps and globes)
    buttons: { type: 'array', maxItems: 8, items: { type: 'object', required: ['id', 'label'], additionalProperties: false, properties: { id: { type: 'string', minLength: 1, maxLength: 24 }, label: { type: 'string', minLength: 1, maxLength: 40 }, toggle: B, key: { type: 'string', maxLength: 16 }, short: { type: 'string', maxLength: 16 }, glyph: { type: 'string', maxLength: 2 } } } },
  },
};
/** @param {any} spec @returns {string[]} */
export const controlsProblems = spec => validate(CONTROLS_SCHEMA, spec).map(e => `${e.path}: ${e.message}`);

export const CONTROLS_CSS = `
.ea-fc { font-size: calc(16px * var(--zoom, 1)); display: flex; flex-direction: column; gap: 0.6em; padding: 0.6em; user-select: none; -webkit-user-select: none; touch-action: none; }
.ea-fc[hidden] { display: none; }
.ea-fc-main { display: flex; flex-wrap: wrap; gap: 0.8em; align-items: center; justify-content: space-between; }
.ea-fc[data-hand="left"] .ea-fc-main { flex-direction: row-reverse; }
.ea-fc-group { display: flex; flex-direction: column; align-items: center; gap: 0.35em; }
.ea-fc-stick { width: min(9.5em, 42vw); min-width: 132px; aspect-ratio: 1; border-radius: 50%; position: relative; border: 2px solid color-mix(in srgb, currentColor 45%, transparent); background: color-mix(in srgb, currentColor 8%, transparent); touch-action: none; }
.ea-fc-knob { position: absolute; left: 50%; top: 50%; width: 38%; aspect-ratio: 1; border-radius: 50%; margin: -19% 0 0 -19%; background: color-mix(in srgb, currentColor 55%, transparent); pointer-events: none; }
.ea-fc-track { position: relative; border-radius: 0.6em; border: 2px solid color-mix(in srgb, currentColor 45%, transparent); background: color-mix(in srgb, currentColor 8%, transparent); touch-action: none; }
.ea-fc-track.v { width: 3em; min-width: 44px; height: min(9.5em, 42vw); min-height: 132px; }
.ea-fc-track.h { height: 3em; min-height: 44px; width: min(12em, 60vw); }
.ea-fc-thumb { position: absolute; background: color-mix(in srgb, currentColor 55%, transparent); border-radius: 0.4em; pointer-events: none; }
.ea-fc-track.v .ea-fc-thumb { left: 8%; right: 8%; height: 16%; }
.ea-fc-track.h .ea-fc-thumb { top: 8%; bottom: 8%; width: 16%; }
.ea-fc-steps, .ea-fc-btns { display: flex; flex-wrap: wrap; gap: 0.35em; justify-content: center; }
.ea-fc button { font: inherit; color: inherit; min-height: 44px; min-width: 44px; padding: 0.35em 0.7em; border-radius: 0.6em; border: 2px solid color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 6%, transparent); cursor: pointer; overflow-wrap: anywhere; }
.ea-fc button[aria-pressed="true"] { background: color-mix(in srgb, currentColor 30%, transparent); border-color: currentColor; }
.ea-fc :focus-visible { outline: 3px solid currentColor; outline-offset: 2px; }
.ea-fc-label { font-size: 0.85em; opacity: 0.85; text-align: center; }
`;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const el = (tag, cls, props = {}, ...kids) => { const e = document.createElement(tag); if (cls) e.className = cls; for (const [k, v] of Object.entries(props)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'text') e.textContent = v; else if (k === 'id') e.id = v; else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : String(v)); } e.append(...kids.filter(Boolean)); return e; };
const rectOf = e => (typeof e.getBoundingClientRect === 'function' ? e.getBoundingClientRect() : { left: 0, top: 0, width: 100, height: 100 });

/**
 * @typedef {object} ControlSettings
 * @property {'right'|'left'} [handed]   which side the stick is on (default right)
 * @property {number} [sensitivity]   0.5 (gentle around the centre) .. 1 (linear) .. 1.5 (sharp)
 * @property {number} [deadZone]   0..0.4 of the stick travel that counts as centred (default 0.06)
 * @property {number} [smoothing]   seconds the output takes to follow the input (default 0.08)
 * @property {number} [tiltRangeDeg]   device tilt for full deflection (default 28)
 * @property {number} [stepSize]   how far one press of a step button moves an axis (default 0.25)
 */

/**
 * @param {{ canvas?: any, pick?: (x: number, y: number) => ({ lat: number, lon: number, elevationM: number }|null), strings?: (k: string, fb: string) => string,
 *   settings?: ControlSettings, keyTarget?: any, gamepads?: () => any[], orientation?: () => number, css?: boolean }} [o]
 *   canvas + pick: taps on the canvas answer a pending pick. keyTarget: where key events are listened for (default: the controls
 *   themselves, so arrow keys fly only while the controls have focus). gamepads, orientation: injectable for tests.
 */
export function createFlightControls(o = {}) {
  const S = o.strings || ((k, fb) => fb);
  /** @type {Required<ControlSettings>} */
  const set = { handed: 'right', sensitivity: 1, deadZone: 0.06, smoothing: 0.08, tiltRangeDeg: 28, stepSize: 0.25, ...(o.settings || {}) };
  if (o.css !== false && typeof document !== 'undefined' && document.head && !document.getElementById('ea-fc-css')) document.head.append(el('style', '', { id: 'ea-fc-css', text: CONTROLS_CSS }));

  // raw inputs per source; read() merges them
  const drag = { pitch: 0, roll: 0, yaw: 0 }, held = { pitch: 0, roll: 0, yaw: 0 }, keys = new Set(), tilt = { on: false, pitch: 0, roll: 0, b0: NaN, g0: NaN };
  const state = { throttle: 0, trim: 0, flaps: 0, gear: 1, brakes: 0 };
  /** @type {Record<string, boolean>} */ let buttons = {};
  /** @type {string[]} */ let pressed = [];
  /** @type {any} */ let zone = null, spec = null, pickReq = null, picked = null, cursor = null, specKey = '', source = 'none', padPrev = [];
  const out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, trim: 0, flaps: 0, gear: 1, brakes: 0, buttons, pressed, /** @type {any} */ pick: null, source: 'none', drag: { dx: 0, dy: 0 }, zoom: 1 };
  /** @type {(() => void)[]} */ let refresh = [];

  const root = el('div', 'ea-fc', { role: 'group', 'aria-label': S('fc.title', 'Flight controls'), hidden: true, tabindex: '-1' });
  root.hidden = true;
  const press = id => { if (!pressed.includes(id)) pressed.push(id); };
  const button = (label, onclick, extra = {}) => { const { class: cls, ...rest } = /** @type {any} */ (extra); return el('button', cls || '', { type: 'button', text: label, onclick, ...rest }); };

  /** A slider on a track: drag, arrow keys when focused, and two step buttons. spring: returns to the centre when released. */
  function slider(key, label, { vertical, min, max, spring, less, more, shorts }) {
    const get = () => (spring ? drag[key] + held[key] : state[key]), put = v => { if (spring) held[key] = clamp(v, min, max); else state[key] = clamp(v, min, max); source = 'touch'; paint(); };
    const thumb = el('div', 'ea-fc-thumb'), track = el('div', 'ea-fc-track ' + (vertical ? 'v' : 'h'), { role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': min, 'aria-valuemax': max, 'aria-orientation': vertical ? 'vertical' : 'horizontal' }, thumb);
    const paint = () => { const f = (clamp(get(), min, max) - min) / (max - min); if (vertical) thumb.style.top = `${(1 - f) * 84}%`; else thumb.style.left = `${f * 84}%`; track.setAttribute('aria-valuenow', get().toFixed(2)); track.setAttribute('aria-valuetext', `${Math.round(get() * 100)}%`); };
    let active = false;
    const move = ev => { const r = rectOf(track), f = vertical ? 1 - (ev.clientY - r.top) / (r.height || 1) : (ev.clientX - r.left) / (r.width || 1), v = min + clamp(f, 0, 1) * (max - min); if (spring) { drag[key] = v; held[key] = 0; } else state[key] = v; source = 'touch'; paint(); };
    track.addEventListener('pointerdown', ev => { active = true; if (track.setPointerCapture && ev.pointerId !== undefined) try { track.setPointerCapture(ev.pointerId); } catch { /* not capturable */ } move(ev); if (ev.preventDefault) ev.preventDefault(); });
    track.addEventListener('pointermove', ev => { if (active) move(ev); });
    const up = () => { active = false; if (spring) { drag[key] = 0; paint(); } };
    track.addEventListener('pointerup', up); track.addEventListener('pointercancel', up);
    track.addEventListener('keydown', ev => { const d = ['ArrowUp', 'ArrowRight'].includes(ev.key) ? 1 : ['ArrowDown', 'ArrowLeft'].includes(ev.key) ? -1 : 0; if (d) { put(get() + d * set.stepSize * (max - min) / (spring ? 2 : 1) * 0.4); if (ev.preventDefault) ev.preventDefault(); if (ev.stopPropagation) ev.stopPropagation(); } });
    const step = d => () => put(get() + d * set.stepSize * (max - min) / (spring ? 2 : 1));
    refresh.push(paint); paint();
    const sh = shorts || {}, g = (k, d) => ({ 'data-glyph': (sh[k] || d)[0], 'data-short': (sh[k] || d)[1] });
    return el('div', 'ea-fc-group ea-fc-g-' + key, {}, el('div', 'ea-fc-label', { text: label, 'data-short': (sh.label || [0, label])[1] }), track, el('div', 'ea-fc-steps', {}, button(less, step(-1), g('less', ['-', ''])), button(more, step(1), g('more', ['+', ''])), spring ? button(S('fc.centreRudder', 'Centre the rudder'), () => { held[key] = 0; paint(); }, { 'data-glyph': '|', 'data-short': S('fc.s.centre', 'Centre') }) : null));
  }

  function stickPad() {
    const knob = el('div', 'ea-fc-knob'), pad = el('div', 'ea-fc-stick', { role: 'application', tabindex: '0', 'aria-label': S('fc.stick', 'Control stick: drag to pitch and roll, or use the buttons below') }, knob);
    const paint = () => { const x = clamp(drag.roll + held.roll, -1, 1), y = clamp(drag.pitch + held.pitch, -1, 1); knob.style.left = `${50 + x * 31}%`; knob.style.top = `${50 + y * 31}%`; };
    let active = false;
    const move = ev => { const r = rectOf(pad), x = ((ev.clientX - r.left) / (r.width || 1) - 0.5) / 0.31 / 1.3, y = ((ev.clientY - r.top) / (r.height || 1) - 0.5) / 0.31 / 1.3, l = Math.max(1, Math.hypot(x, y)); drag.roll = x / l; drag.pitch = y / l; held.roll = held.pitch = 0; source = 'touch'; paint(); };
    pad.addEventListener('pointerdown', ev => { active = true; if (pad.setPointerCapture && ev.pointerId !== undefined) try { pad.setPointerCapture(ev.pointerId); } catch { /* not capturable */ } move(ev); if (ev.preventDefault) ev.preventDefault(); });
    pad.addEventListener('pointermove', ev => { if (active) move(ev); });
    const up = () => { active = false; drag.roll = drag.pitch = 0; paint(); };
    pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
    // a touch area for the whole right (or left) half of the screen: the stick is where the finger lands, the ring follows it
    zone = el('div', 'ea-fc-zone', { 'aria-hidden': 'true' });
    let zo = null, zid = null, ztap = null;
    const zmove = ev => {
      if (!zo) return;
      const R = Math.max(44, rectOf(pad).width * 0.55), x = (ev.clientX - zo[0]) / R, y = (ev.clientY - zo[1]) / R, l = Math.max(1, Math.hypot(x, y));
      drag.roll = x / l; drag.pitch = y / l; held.roll = held.pitch = 0; source = 'touch'; paint();
    };
    const zup = ev => {
      if (zid === null || (ev.pointerId !== undefined && ev.pointerId !== zid)) return;
      const tapped = ztap && Math.hypot(ev.clientX - ztap[0], ev.clientY - ztap[1]) <= 12;
      zo = null; zid = null; ztap = null; drag.roll = drag.pitch = 0; pad.style.cssText = ''; root.classList.remove('ea-fc-held'); paint();
      if (tapped && pickReq && canvas) { const r = rectOf(canvas); pickAt([(ev.clientX - r.left) / (r.width || 1), (ev.clientY - r.top) / (r.height || 1)]); }
    };
    zone.addEventListener('pointerdown', ev => {
      if (zid !== null) return;
      zid = ev.pointerId === undefined ? 0 : ev.pointerId; zo = [ev.clientX, ev.clientY]; ztap = [ev.clientX, ev.clientY];
      if (zone.setPointerCapture && ev.pointerId !== undefined) try { zone.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
      const w = rectOf(pad).width || 110; pad.style.cssText = `left:${ev.clientX - w / 2}px;top:${ev.clientY - w / 2}px;right:auto;bottom:auto;`; root.classList.add('ea-fc-held');
      if (ev.preventDefault) ev.preventDefault();
    });
    zone.addEventListener('pointermove', ev => { if (zid !== null && (ev.pointerId === undefined || ev.pointerId === zid)) zmove(ev); });
    zone.addEventListener('pointerup', zup); zone.addEventListener('pointercancel', zup);
    const nudge = (axis, d) => () => { held[axis] = clamp(held[axis] + d * set.stepSize, -1, 1); source = 'touch'; paint(); };
    refresh.push(paint); paint();
    const sg = (k, d) => ({ 'data-glyph': d[0], 'data-short': S('fc.s.' + k, d[1]) });
    return el('div', 'ea-fc-group ea-fc-g-stick', {}, pad, el('div', 'ea-fc-steps', {},
      button(S('fc.noseDown', 'Nose down'), nudge('pitch', -1), sg('noseDown', ['v', 'Nose dn'])), button(S('fc.noseUp', 'Nose up'), nudge('pitch', 1), sg('noseUp', ['^', 'Nose up'])), button(S('fc.rollLeft', 'Roll left'), nudge('roll', -1), sg('rollLeft', ['<', 'Roll L'])), button(S('fc.rollRight', 'Roll right'), nudge('roll', 1), sg('rollRight', ['>', 'Roll R'])),
      button(S('fc.centreStick', 'Centre the stick'), () => { held.pitch = held.roll = 0; paint(); }, sg('centre', ['+', 'Centre']))));
  }

  // ---- keyboard ----------------------------------------------------------------------------------------------------------
  const FLY = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Comma', 'Period', 'PageUp', 'PageDown', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'KeyB', 'Space', 'BracketLeft', 'BracketRight'];
  const flap = d => { if (spec && spec.flaps > 0) { state.flaps = clamp(Math.round(state.flaps * spec.flaps + d) / spec.flaps, 0, 1); press(d > 0 ? 'flaps+' : 'flaps-'); repaint(); } };
  const gear = () => { state.gear = state.gear ? 0 : 1; press('gear'); repaint(); };
  const hit = (b, down) => { if (b.toggle) { if (down) { buttons[b.id] = !buttons[b.id]; press(b.id); } } else { if (down && !buttons[b.id]) press(b.id); buttons[b.id] = down; } repaint(); };
  const onKey = ev => {
    if (!spec || root.hidden) return;
    const down = ev.type === 'keydown', code = ev.code || ev.key, tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'BUTTON' && (code === 'Space' || code === 'Enter'))) return;
    if (pickReq && down && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(code)) { if (code === 'Enter') pickAt(cursor || [0.5, 0.5]); else moveCursor(code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : 0, code === 'ArrowUp' ? -1 : code === 'ArrowDown' ? 1 : 0); if (ev.preventDefault) ev.preventDefault(); return; }
    const custom = (spec.buttons || []).find(b => b.key && b.key === code);
    if (FLY.includes(code)) { if (down) keys.add(code); else keys.delete(code); source = 'keys'; }
    else if (down && !ev.repeat && code === 'KeyF') flap(ev.shiftKey ? -1 : 1);
    else if (down && !ev.repeat && code === 'KeyV') flap(-1);
    else if (down && !ev.repeat && code === 'KeyG' && spec.gear) gear();
    else if (custom) { if (!ev.repeat) hit(custom, down); }
    else return;
    if (ev.preventDefault) ev.preventDefault();
  };
  const keyTarget = o.keyTarget || root;
  if (keyTarget && keyTarget.addEventListener) { keyTarget.addEventListener('keydown', onKey); keyTarget.addEventListener('keyup', onKey); }
  const blur = () => keys.clear();
  if (keyTarget && keyTarget.addEventListener) keyTarget.addEventListener('blur', blur);

  // ---- tilt --------------------------------------------------------------------------------------------------------------
  const angle = () => (o.orientation ? o.orientation() : (globalThis.screen && globalThis.screen.orientation && globalThis.screen.orientation.angle) || 0);
  const onTilt = ev => {
    if (!tilt.on || ev.beta == null || ev.gamma == null) return;
    const a = ((angle() % 360) + 360) % 360, rollDeg = a === 90 ? ev.beta : a === 270 ? -ev.beta : ev.gamma, pitchDeg = a === 90 ? -ev.gamma : a === 270 ? ev.gamma : ev.beta;
    if (tilt.b0 !== tilt.b0) { tilt.b0 = pitchDeg; tilt.g0 = rollDeg; }       // the pose at the moment of turning tilt on is "level"
    tilt.pitch = clamp((pitchDeg - tilt.b0) / set.tiltRangeDeg, -1, 1); tilt.roll = clamp((rollDeg - tilt.g0) / set.tiltRangeDeg, -1, 1); source = 'tilt';
  };
  /**
   * Turn device tilt on or off. Call from a press (the system may ask the player for permission). Resolves to whether tilt is on.
   * @param {boolean} on @returns {Promise<boolean>}
   */
  async function setTilt(on) {
    const g = /** @type {any} */ (globalThis);
    if (!on) { tilt.on = false; tilt.pitch = tilt.roll = 0; if (g.removeEventListener) g.removeEventListener('deviceorientation', onTilt); repaint(); return false; }
    try {
      const D = g.DeviceOrientationEvent;
      if (D && typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') { repaint(); return false; }
      if (!g.addEventListener) return false;
      tilt.on = true; tilt.b0 = tilt.g0 = NaN; g.addEventListener('deviceorientation', onTilt);
    } catch { tilt.on = false; }
    repaint();
    return tilt.on;
  }

  // ---- picking a place on the canvas -------------------------------------------------------------------------------------
  const canvas = o.canvas;
  const pickAt = c => {
    if (!pickReq || !o.pick || !canvas) return;
    cursor = [clamp(c[0], 0, 1), clamp(c[1], 0, 1)];
    const p = o.pick(cursor[0] * canvas.width, cursor[1] * canvas.height);
    if (p) { picked = { id: pickReq.id, lat: p.lat, lon: p.lon, elevationM: p.elevationM }; press('pick'); }
  };
  const moveCursor = (dx, dy) => { const c = cursor || [0.5, 0.5]; cursor = [clamp(c[0] + dx * 0.04, 0, 1), clamp(c[1] + dy * 0.04, 0, 1)]; };
  let tap = null;
  // ---- drag, pinch and wheel on the canvas (only while the screen asks for `drag`) -----------------------------------------
  const TAP_PX = 12;
  /** Pointers on the canvas by id -> [x, y] in page pixels. */
  /** @type {Map<any, number[]>} */ const pts = new Map();
  const pan = { dx: 0, dy: 0, zoom: 1, moving: false, /** @type {number[]|null} */ start: null };
  const dragOn = () => Boolean(spec && spec.drag && !root.hidden);
  const centre = () => { let x = 0, y = 0; for (const p of pts.values()) { x += p[0]; y += p[1]; } return [x / pts.size, y / pts.size]; };
  const spread = () => { const [a, b] = [...pts.values()]; return b ? Math.hypot(a[0] - b[0], a[1] - b[1]) : 0; };
  const letGo = () => { pts.clear(); pan.dx = pan.dy = 0; pan.zoom = 1; pan.moving = false; pan.start = null; };
  const onDown = ev => {
    tap = [ev.clientX, ev.clientY];
    if (!dragOn()) return;
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (pts.size > 1) { tap = null; pan.moving = true; } else { pan.start = [ev.clientX, ev.clientY]; pan.moving = false; }   // two fingers never answer a pick
    if (canvas.setPointerCapture && ev.pointerId !== undefined) try { canvas.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
  };
  const onMove = ev => {
    if (!dragOn() || !pts.has(ev.pointerId)) return;
    let c0 = centre(); const s0 = spread();
    pts.set(ev.pointerId, [ev.clientX, ev.clientY]);
    if (!pan.moving) {                                           // still a tap until it has moved far enough; then the view catches up
      if (!pan.start || Math.hypot(ev.clientX - pan.start[0], ev.clientY - pan.start[1]) <= TAP_PX) return;
      pan.moving = true; c0 = pan.start;
    }
    const c1 = centre(), s1 = spread(), r = rectOf(canvas);
    pan.dx += (c1[0] - c0[0]) / (r.width || 1); pan.dy += (c1[1] - c0[1]) / (r.height || 1);
    if (s0 > 8 && s1 > 8) pan.zoom *= s1 / s0;
    source = 'touch';
    if (ev.preventDefault) ev.preventDefault();
  };
  const drop = ev => { pts.delete(ev.pointerId); if (!pts.size) { pan.moving = false; pan.start = null; } };
  const onUp = ev => {
    const many = pts.size > 1; drop(ev);
    if (!tap || many) { tap = null; return; }
    if (!pickReq) return;
    const moved = Math.hypot(ev.clientX - tap[0], ev.clientY - tap[1]); tap = null; if (moved > TAP_PX) return; const r = rectOf(canvas); pickAt([(ev.clientX - r.left) / (r.width || 1), (ev.clientY - r.top) / (r.height || 1)]);
  };
  const onCancel = ev => { drop(ev); tap = null; };
  const onWheel = ev => {
    if (!dragOn()) return;
    const px = (ev.deltaY || 0) * (ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1);       // lines and pages to pixels
    pan.zoom *= Math.exp(-clamp(px, -400, 400) * (ev.ctrlKey ? 0.01 : 0.0015));                   // ctrl + wheel is a trackpad pinch
    source = 'touch';
    if (ev.preventDefault) ev.preventDefault();
  };
  const CANVAS_EVENTS = /** @type {[string, (ev: any) => void][]} */ ([['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel], ['wheel', onWheel]]);
  if (canvas && canvas.addEventListener) for (const [t, f] of CANVAS_EVENTS) canvas.addEventListener(t, f, t === 'wheel' ? { passive: false } : undefined);

  let tiltBtn = null;
  /** @type {Map<string, any>} */ const btnEls = new Map();
  const repaint = () => {
    for (const f of refresh) f();
    if (tiltBtn) tiltBtn.setAttribute('aria-pressed', String(tilt.on));
    for (const [id, b] of btnEls) { if (id === 'gear') { b.setAttribute('aria-pressed', String(state.gear === 1)); } else if (id === 'flaps') b.textContent = `${S('fc.flaps', 'Flaps')} ${Math.round(state.flaps * (spec.flaps || 1))}/${spec.flaps}`; else b.setAttribute('aria-pressed', String(Boolean(buttons[id]))); }
  };

  function build() {
    refresh = []; btnEls.clear(); tiltBtn = null; zone = null;
    const main = el('div', 'ea-fc-main'), row = el('div', 'ea-fc-btns');
    const sh = (g, k, d) => ({ 'data-glyph': g, 'data-short': S('fc.s.' + k, d) });
    if (spec.throttle !== undefined && spec.throttle !== false) main.append(slider('throttle', S('fc.throttle', 'Throttle'), { vertical: true, min: 0, max: 1, spring: false, less: S('fc.less', 'Less power'), more: S('fc.more', 'More power'), shorts: { label: ['', S('fc.s.throttle', 'PWR')], less: ['v', S('fc.s.less', 'Less')], more: ['^', S('fc.s.more', 'More')] } }));
    if (spec.trim) main.append(slider('trim', S('fc.trim', 'Trim'), { vertical: true, min: -1, max: 1, spring: false, less: S('fc.trimDown', 'Trim nose down'), more: S('fc.trimUp', 'Trim nose up'), shorts: { label: ['', S('fc.s.trim', 'TRIM')], less: ['v', S('fc.s.trimDown', 'Trim dn')], more: ['^', S('fc.s.trimUp', 'Trim up')] } }));
    if (spec.rudder) main.append(slider('yaw', S('fc.rudder', 'Rudder'), { vertical: false, min: -1, max: 1, spring: true, less: S('fc.rudderLeft', 'Rudder left'), more: S('fc.rudderRight', 'Rudder right'), shorts: { label: ['', S('fc.s.rudder', 'RUDDER')], less: ['<', S('fc.s.rudderL', 'Left')], more: ['>', S('fc.s.rudderR', 'Right')] } }));
    if (spec.stick !== false) main.append(stickPad());
    if (spec.flaps > 0) { const lab = el('span', 'ea-fc-label ea-fc-flaplabel'); btnEls.set('flaps', lab); row.append(button(S('fc.flapsUp', 'Flaps up one step'), () => flap(-1), sh('−', 'flapsUp', 'Flaps')), lab, button(S('fc.flapsDown', 'Flaps down one step'), () => flap(1), sh('+', 'flapsDown', 'Flaps'))); }
    if (spec.gear) { const b = button(S('fc.gear', 'Landing gear down'), gear, { 'aria-pressed': 'true', ...sh('▼', 'gear', 'Gear') }); btnEls.set('gear', b); row.append(b); }
    // a held button follows the pointer; a click that did not come from a pointer (keyboard, switch access) counts as a press of one frame
    const hold = (b, node) => {
      let byPointer = false;
      for (const [t, d] of [['pointerdown', true], ['pointerup', false], ['pointercancel', false], ['pointerleave', false]]) node.addEventListener(t, () => { if (b.toggle) return; if (d) byPointer = true; hit(b, d); });
      node.addEventListener('click', () => { if (b.toggle) hit(b, true); else if (byPointer) byPointer = false; else { hit(b, true); pendingRelease.push(b); } });
    };
    for (const b of [...(spec.brakes ? [{ id: 'brakes', label: S('fc.brakes', 'Brakes'), short: S('fc.s.brakes', 'Brakes') }] : []), ...(spec.buttons || [])]) { const node = button(b.label, () => {}, { 'aria-pressed': 'false', 'data-id': b.id, 'data-glyph': b.glyph || '■', 'data-short': b.short || (String(b.label).length <= 14 ? String(b.label) : String(b.label).split(/\s+/).slice(0, 2).join(' ').slice(0, 16)) }); hold(b, node); btnEls.set(b.id, node); row.append(node); }
    if (spec.tilt) { tiltBtn = button(S('fc.tilt', 'Steer by tilting the device'), () => { setTilt(!tilt.on); }, { 'aria-pressed': 'false', ...sh('↻', 'tilt', 'Tilt') }); row.append(tiltBtn); }
    // every control stays reachable without a gesture: "Controls" opens the step buttons of every axis over the picture
    const toggle = button(S('fc.controls', 'Controls'), () => { const on = root.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(on)); }, { class: 'ea-fc-toggle', 'aria-expanded': 'false', 'data-glyph': '...', 'data-short': S('fc.controls', 'Controls') });
    const kids = [...(zone ? [zone] : []), main, row];
    if (pickReq) kids.push(el('div', 'ea-fc-btns', { role: 'group', 'aria-label': S('fc.pick', 'Choose a place') },
      button(S('fc.left', 'Move left'), () => moveCursor(-1, 0)), button(S('fc.right', 'Move right'), () => moveCursor(1, 0)), button(S('fc.up', 'Move up'), () => moveCursor(0, -1)), button(S('fc.down', 'Move down'), () => moveCursor(0, 1)),
      button(S('fc.select', 'Select this place'), () => pickAt(cursor || [0.5, 0.5]))));
    kids.push(toggle);
    root.classList.remove('open', 'ea-fc-held');
    root.classList.toggle('ea-fc-big', spec.stick === false && !spec.throttle && !spec.rudder && !spec.trim);   // buttons are the whole control: make them large
    root.replaceChildren(...kids);
    root.dataset.hand = set.handed;
    repaint();
  }
  /** Buttons pressed by a click without a pointer (keyboard, switch access): held for one frame. */
  let pendingRelease = [], releaseNext = [];

  const shape = v => { const a = Math.abs(v), d = set.deadZone; if (a <= d) return 0; const x = (a - d) / (1 - d); return Math.sign(v) * Math.pow(clamp(x, 0, 1), clamp(2 - set.sensitivity, 0.5, 1.5)); };
  const pads = o.gamepads || (() => { const n = /** @type {any} */ (globalThis.navigator); return n && typeof n.getGamepads === 'function' ? [...n.getGamepads()] : []; });

  return {
    el: root,
    /**
     * Show the controls a screen asks for. Call whenever the screen changes; the elements are rebuilt only when the request does.
     * @param {any} controlsSpec `screen.world.controls`, or null to hide @param {any} [pick] `screen.world.pick`, the pending pick request
     */
    configure(controlsSpec, pick) {
      const ok = controlsSpec && typeof controlsSpec === 'object' && !controlsProblems(controlsSpec).length, p = pick && typeof pick === 'object' && pick.id ? pick : null;
      const key = JSON.stringify([ok ? controlsSpec : null, p ? p.id : null, set.handed]);
      if (key === specKey) return;
      specKey = key; spec = ok ? controlsSpec : p ? { stick: false } : null; pickReq = p;
      if (!p) cursor = null;
      root.hidden = !spec;
      if (canvas && canvas.style) canvas.style.touchAction = spec && spec.drag ? 'none' : '';   // the page scrolls from the canvas unless it is dragged
      if (!(spec && spec.drag)) letGo();
      if (!spec) { root.replaceChildren(); keys.clear(); return; }
      if (typeof spec.throttle === 'number') state.throttle = clamp(spec.throttle, 0, 1);
      const ids = new Set((spec.buttons || []).map(b => b.id).concat(spec.brakes ? ['brakes'] : []));
      for (const id of Object.keys(buttons)) if (!ids.has(id)) delete buttons[id];
      for (const id of ids) if (!(id in buttons)) buttons[id] = false;
      build();
    },
    /** Change settings (handedness, sensitivity, dead zone, smoothing). @param {ControlSettings} patch */
    settings(patch) { Object.assign(set, patch || {}); if (spec) { specKey = ''; this.configure(spec, pickReq); } },
    setTilt,
    /**
     * The controls now. Call once per frame with the time step in seconds; the same object is returned every time.
     * `pressed` and `pick` hold what happened since the previous call.
     * @param {number} dt
     */
    read(dt) {
      if (releaseNext.length) { for (const b of releaseNext) buttons[b.id] = false; releaseNext = []; repaint(); }
      let pitch = drag.pitch + held.pitch, roll = drag.roll + held.roll, yaw = drag.yaw + held.yaw, digital = false;
      const k = c => keys.has(c);
      if (keys.size) {
        const kp = (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0), kr = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0), ky = (k('KeyE') || k('Period') ? 1 : 0) - (k('KeyQ') || k('Comma') ? 1 : 0);
        pitch += kp; roll += kr; yaw += ky; digital = Boolean(kp || kr || ky);
        // + and - : closer and farther on a screen that is dragged, power otherwise (PageUp and PageDown are always power)
        const plus = (k('Equal') || k('NumpadAdd') ? 1 : 0) - (k('Minus') || k('NumpadSubtract') ? 1 : 0), dz = spec && spec.drag ? plus : 0;
        if (dz) pan.zoom *= Math.exp(dz * dt * 1.2);
        state.throttle = clamp(state.throttle + ((k('PageUp') ? 1 : 0) - (k('PageDown') ? 1 : 0) + plus - dz) * dt * 0.6, 0, 1);
        state.trim = clamp(state.trim + ((k('BracketRight') ? 1 : 0) - (k('BracketLeft') ? 1 : 0)) * dt * 0.4, -1, 1);
      }
      let brakes = buttons.brakes || k('KeyB') || k('Space') ? 1 : 0;
      for (const p of pads()) {
        if (!p || !p.connected || !p.axes) continue;
        const ax = i => (Math.abs(p.axes[i] || 0) > 0.12 ? p.axes[i] : 0), bt = i => (p.buttons && p.buttons[i] ? (typeof p.buttons[i] === 'object' ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : p.buttons[i]) : 0);
        if (ax(0) || ax(1) || ax(2)) source = 'gamepad';
        roll += ax(0); pitch += ax(1); yaw += ax(2);
        state.throttle = clamp(state.throttle + (bt(7) - bt(6)) * dt * 0.6, 0, 1);
        if (bt(0) > 0.5) brakes = 1;
        const edge = i => bt(i) > 0.5 && !padPrev[i];
        if (edge(1) && spec && spec.gear) gear();
        if (edge(3)) flap(1); if (edge(2)) flap(-1);
        padPrev = [0, 1, 2, 3].map(i => bt(i) > 0.5);
        break;
      }
      if (tilt.on) { pitch += tilt.pitch; roll += tilt.roll; }
      const a = dt > 0 ? 1 - Math.exp(-dt / Math.max(0.001, digital ? Math.max(set.smoothing, 0.16) : set.smoothing)) : 1;
      out.pitch += (shape(clamp(pitch, -1, 1)) - out.pitch) * a; out.roll += (shape(clamp(roll, -1, 1)) - out.roll) * a; out.yaw += (shape(clamp(yaw, -1, 1)) - out.yaw) * a;
      for (const key of ['pitch', 'roll', 'yaw']) if (Math.abs(out[key]) < 0.004) out[key] = 0;
      out.throttle = state.throttle; out.trim = state.trim; out.flaps = state.flaps; out.gear = state.gear; out.brakes = brakes;
      out.buttons = buttons; out.pressed = pressed; out.pick = picked; out.source = source;
      out.drag.dx = pan.dx; out.drag.dy = pan.dy; out.zoom = clamp(pan.zoom, 0.25, 4);
      pan.dx = pan.dy = 0; pan.zoom = 1;
      pressed = []; picked = null;
      releaseNext = pendingRelease; pendingRelease = [];
      return out;
    },
    /** Cursor of a pending pick as [x, y] in 0..1 of the canvas, once the player has moved it; otherwise undefined. */
    cursor: () => (pickReq && cursor ? cursor : undefined),
    /** Overlay items for renderer.frame(world, overlays): the pick cursor. */
    overlays() {
      if (!pickReq || !cursor) return [];
      const [x, y] = cursor, a = 0.03, b = 0.008;
      return [{ type: 'shape', color: '#ffffff', lines: [{ points: [[x - a, y], [x - b, y]], width: 2 }, { points: [[x + b, y], [x + a, y]], width: 2 }, { points: [[x, y - a * 1.6], [x, y - b * 1.6]], width: 2 }, { points: [[x, y + b * 1.6], [x, y + a * 1.6]], width: 2 }] }];
    },
    dispose() {
      if (keyTarget && keyTarget.removeEventListener) { keyTarget.removeEventListener('keydown', onKey); keyTarget.removeEventListener('keyup', onKey); keyTarget.removeEventListener('blur', blur); }
      if (canvas && canvas.removeEventListener) for (const [t, f] of CANVAS_EVENTS) canvas.removeEventListener(t, f);
      if (canvas && canvas.style) canvas.style.touchAction = '';
      letGo();
      if (tilt.on) setTilt(false);
      root.replaceChildren(); root.hidden = true; spec = null; specKey = '';
    },
  };
}
