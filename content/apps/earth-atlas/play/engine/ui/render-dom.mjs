// @ts-check
// DOM renderer for the screen model (engine/core/screen.mjs). Used by the web player and by the WebView shells.
// Text zoom 100-300% is a CSS variable on the root (--zoom); every size is relative, every text screen scrolls.
import { resolveTheme } from './themes.mjs';
import { screenText } from '../core/screen.mjs';
import { ATLAS_CSS, atlasBlock, cardInner, cardName, setDots } from './atlas-draw.mjs';

export const BASE_CSS = `
:root { --zoom: 1; }
.earth-root { min-height: 100%; background: var(--bg); color: var(--fg); font-family: var(--font); font-size: calc(17px * var(--zoom) * var(--fs, 1)); line-height: 1.5; }
.earth-screen { max-width: min(100%, 44em); margin: 0 auto; padding: 1.25rem 1rem 3rem; display: flex; flex-direction: column; gap: 1rem; overflow-wrap: anywhere; }
.earth-title { font-size: 1.45em; font-weight: 650; margin: 0; line-height: 1.25; }
.earth-progress { height: 0.4rem; background: color-mix(in srgb, var(--fg) 12%, transparent); border-radius: 999px; overflow: hidden; }
.earth-progress > div { height: 100%; background: var(--accent); }
.earth-body { display: flex; flex-direction: column; gap: 1rem; }
.earth-body:empty, .earth-progress[hidden] { display: none; }
.earth-block { background: var(--card); border-radius: 0.75rem; padding: 0.85rem 1rem; box-shadow: 0 1px 0 color-mix(in srgb, var(--fg) 8%, transparent); }
.earth-fact { font-weight: 600; }
.earth-kv { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0.1rem 0; }
.earth-kv dt, .earth-kv dd { overflow-wrap: break-word; min-width: 0; }
.earth-kv dt { color: var(--muted); } .earth-kv dd { margin: 0 0 0.4rem; font-weight: 600; }
.earth-list { margin: 0; padding-left: 1.25rem; }
.earth-choices, .earth-actions { display: flex; flex-direction: column; gap: 0.6rem; }
.earth-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15em), 1fr)); }
@media (min-width: 840px) { .earth-screen { max-width: min(100%, 58em); } }
.earth-btn { font: inherit; font-size: 1.05em; text-align: left; padding: 0.9rem 1rem; border-radius: 0.75rem; border: 2px solid color-mix(in srgb, var(--fg) 15%, transparent); background: var(--card); color: var(--fg); cursor: pointer; min-height: 3rem; }
.earth-btn:hover, .earth-btn:focus-visible { border-color: var(--accent); outline: none; }
.earth-btn.primary { background: var(--accent); color: var(--bg); border-color: var(--accent); font-weight: 650; text-align: center; }
.earth-cite { font-size: 0.85em; color: var(--muted); }
.earth-cite a { color: inherit; }
.earth-media { color: var(--muted); font-style: italic; }
${ATLAS_CSS}`;

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };

/** Body blocks of a screen as elements. */
function blocks(screen, S) {
  const out = [];
  for (const b of screen.body || []) {
    if (b.atlas) { out.push(atlasBlock(b.atlas)); continue; }
    if (b.text && atlasOf(screen)?.name === b.text) continue;   // the map caption already names the place
    const box = el('div', 'earth-block');
    if (b.text) box.append(el('p', '', b.text));
    if (b.fact) box.append(el('p', 'earth-fact', b.fact));
    if (b.list) { const ul = el('ul', 'earth-list'); for (const li of b.list) ul.append(el('li', '', li)); box.append(ul); }
    if (b.kv) { const dl = el('dl', 'earth-kv'); for (const [k, v] of b.kv) { dl.append(el('dt', '', String(k))); dl.append(el('dd', '', String(v))); } box.append(dl); }
    if (b.media) box.append(el('p', 'earth-media', b.media.alt || S('mediaOptional', 'Image available online')));
    out.push(box);
  }
  return out;
}

/** The atlas block of a screen (play/atlas), if any. */
const atlasOf = screen => (screen.body || []).find(b => b.atlas)?.atlas || null;

const BRIEF_KINDS = new Set(['intro', 'brief', 'briefing']);
const ANSWER_KINDS = new Set(['question', 'feedback', 'result', 'reveal']);
const BRIEFING_BLOCKS = 2, BRIEFING_CHARS = 500;

/**
 * Briefing layout (docs/PRESENTATION-FLOW.md "Briefing screens: buttons near the top"). A long intro screen with actions shows
 * title, first block, buttons, then the remaining blocks, so a returning player never scrolls to start. screen.layout 'actions-first'
 * forces it, 'default' forbids it; otherwise the heuristic: not an answer screen (question, feedback, result, reveal), no choices,
 * no real-time world (an 'intro' with a still map is a briefing), at least one action, and more than 2 body blocks or more than 500 characters of body text.
 * @returns {boolean}
 */
export function actionsFirst(screen) {
  if (screen.layout === 'default') return false;
  const body = screen.body || [];
  if (!screen.actions?.length || body.length < 2) return false;
  if (screen.layout === 'actions-first') return true;
  if (ANSWER_KINDS.has(screen.kind) || screen.choices?.length || (screen.world && screen.kind !== 'intro')) return false;   // an intro may sit under a still map: its Start button belongs near the top as well
  const chars = screenText({ title: '', body }).join('').length;
  return body.length > BRIEFING_BLOCKS || chars > BRIEFING_CHARS;
}

function setProgress(p, progress) {
  p.hidden = !progress; if (!progress) return;
  if (p.classList.contains('dots')) { setDots(p, progress); p.setAttribute('aria-valuenow', String(progress.i)); p.setAttribute('aria-valuemax', String(progress.n)); return; }
  p.setAttribute('aria-valuenow', String(progress.i)); p.setAttribute('aria-valuemax', String(progress.n));
  p.firstChild.style.width = `${progress.n ? (100 * progress.i) / progress.n : 0}%`;
}

/**
 * Render a whole screen. Moves focus to the heading unless opts.focus is false.
 * @param {HTMLElement} root
 * @param {any} screen
 * @param {{ theme?: any, onAct: (id: string) => void, strings?: (k: string, fb: string) => string, focus?: boolean }} opts
 */
export function renderScreen(root, screen, opts) {
  const t = resolveTheme(opts.theme);
  const S = opts.strings || ((k, fb) => fb);
  root.classList.add('earth-root');
  for (const [k, v] of Object.entries(t)) root.style.setProperty(`--${k}`, v);
  root.replaceChildren();
  const atlas = atlasOf(screen);
  const wrap = el('section', 'earth-screen'); wrap.dataset.kind = screen.kind; if (atlas) wrap.classList.add('atlas');
  const p = el('div', 'earth-progress' + (atlas ? ' dots' : '')); p.setAttribute('role', 'progressbar'); p.setAttribute('aria-label', S('progress', 'Progress')); p.setAttribute('aria-valuemin', '0'); p.append(el('div')); setProgress(p, screen.progress); wrap.append(p);
  const h = el('h1', 'earth-title', screen.title); wrap.append(h);
  const first = actionsFirst(screen), all = blocks(screen, S);
  const body = el('div', 'earth-body'); body.append(...(first ? all.slice(0, 1) : all)); if (!(atlas && screen.choices?.length)) wrap.append(body);
  const button = (x, cls) => { const btn = el('button', cls, x.label); btn.type = 'button'; btn.dataset.id = x.id; if (x.state) btn.dataset.state = x.state; btn.addEventListener('click', () => opts.onAct(x.id)); return btn; };
  if (screen.choices?.length && !atlas) { const c = el('div', 'earth-choices'); for (const ch of screen.choices) c.append(button(ch, 'earth-btn')); wrap.append(c); }
  if (atlas && screen.choices?.length) {
    // Picture screen: map and notes on one side, the city cards on the other (stacked on a phone held upright).
    const stage = el('div', 'atlas-stage'), side = el('div', 'atlas-side'), cards = el('div', 'atlas-cards');
    side.append(body);
    for (const ch of screen.choices) {
      const b = button(ch, 'earth-btn atlas-card');
      b.setAttribute('aria-label', cardName(ch.label, ch.card)); b.replaceChildren(cardInner(ch.label, ch.card && { ...ch.card, outline: atlas.outline }));
      if (ch.state === 'wrong' || ch.state === 'correct' || ch.state === 'other') b.setAttribute('aria-disabled', 'true');
      cards.append(b);
    }
    if (screen.actions?.length) { const a = el('div', 'earth-actions atlas-next'); for (const ac of screen.actions) a.append(button(ac, 'earth-btn primary')); side.append(a); }
    stage.append(side, cards); wrap.append(stage);
    // screen readers: say what just happened (a found city, a wrong card) without moving focus
    const say = screen.kind === 'reveal' ? screen.title : (screen.meta?.tries > 0 ? (screen.body || []).map(b => b.text).filter(Boolean).pop() : '');
    if (say) { const live = el('p', 'atlas-sr', say); live.setAttribute('role', 'status'); wrap.append(live); }
  } else if (screen.actions?.length) { const a = el('div', 'earth-actions'); for (const ac of screen.actions) a.append(button(ac, 'earth-btn primary')); wrap.append(a); }
  if (first) { const d = el('div', 'earth-body earth-details'); d.append(...all.slice(1)); wrap.append(d); }
  if (screen.citations?.length) { const c = el('p', 'earth-cite', S('sources', 'Sources') + ': '); screen.citations.forEach((ci, i) => { if (i) c.append('; '); if (ci.url) { const a = el('a', '', ci.title); a.href = ci.url; a.target = '_blank'; a.rel = 'noopener'; c.append(a); } else c.append(ci.title); }); wrap.append(c); }
  // a flight briefing over a world view: the buttons come straight after the title, the text under them (nothing to scroll to before flying)
  if (screen.world && BRIEF_KINDS.has(screen.kind) && screen.actions?.length) {
    const act = wrap.querySelector('.earth-actions'), first = wrap.querySelector('.earth-body');
    if (act && first) { const rest = [...wrap.children].filter(c => c !== act); rest.splice(rest.indexOf(first), 0, act); wrap.replaceChildren(...rest); }
  }
  root.append(wrap);
  if (opts.focus !== false) { h.tabIndex = -1; h.focus({ preventScroll: true }); root.scrollTop = 0; }
}

/**
 * Refresh only the body blocks and the progress bar of the screen last drawn by renderScreen into root. Heading and buttons
 * stay the same elements, so focus and a press in flight survive (used for clocks, instruments and other ticking text).
 * @param {HTMLElement} root @param {any} screen @param {{ strings?: (k: string, fb: string) => string }} [opts]
 * @returns {boolean} false when root holds no rendered screen
 */
export function updateScreen(root, screen, opts = {}) {
  const body = root.querySelector('.earth-body'), p = root.querySelector('.earth-progress');
  if (!body || !p) return false;
  const all = blocks(screen, opts.strings || ((k, fb) => fb)), details = root.querySelector('.earth-details');
  if (details) { body.replaceChildren(...all.slice(0, 1)); details.replaceChildren(...all.slice(1)); } else body.replaceChildren(...all);
  setProgress(p, screen.progress);
  return true;
}

/** @param {number} zoom 1..3 */
export function setTextZoom(zoom) { document.documentElement.style.setProperty('--zoom', String(Math.min(3, Math.max(1, zoom)))); }
