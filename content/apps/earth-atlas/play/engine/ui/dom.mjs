// @ts-check
// Tiny element builder shared by the app chrome. No framework: h('button.ea-btn', { type: 'button', onclick }, 'Label').

const PROPS = new Set(['value', 'type', 'hidden', 'href', 'checked', 'tabIndex', 'id', 'disabled', 'min', 'max', 'step', 'target', 'rel']);

/**
 * @param {string} spec tag plus optional classes: "div.a.b"
 * @param {Record<string, any> | null} [props] on* = listener, data = dataset entries, known DOM properties are assigned, the rest are attributes
 * @param {...any} kids nodes, strings, arrays; null/false are skipped
 * @returns {any}
 */
export function h(spec, props, ...kids) {
  const [tag, ...cls] = spec.split('.');
  const e = document.createElement(tag || 'div');
  if (cls.length) e.className = cls.join(' ');
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'data') Object.assign(e.dataset, v);
    else if (PROPS.has(k)) /** @type {any} */ (e)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids.flat(2).filter(k => k != null && k !== false));
  return e;
}

/** Replace {name} markers. @param {string} s @param {Record<string, any>} [vars] */
export const fmt = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : String(s));

/** Human size from bytes. @param {number} n */
export function size(n) {
  if (!(n > 0)) return '0 KB';
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} KB`;
  return n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`;
}

/** Labelled progress bar. @param {string} label @returns {{ el: any, set: (fraction: number) => void }} */
export function meter(label) {
  const bar = h('div');
  const el = h('div.ea-meter', { role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar);
  return { el, set(v) { const pct = Math.round(100 * Math.min(1, Math.max(0, Number(v) || 0))); bar.style.width = pct + '%'; el.setAttribute('aria-valuenow', pct); } };
}

/** A titled group of nodes. @param {string} title @param {...any} kids */
export const section = (title, ...kids) => h('section.ea-sec', { 'aria-label': title }, h('h2.ea-h', null, title), ...kids);

/** @param {string} label @param {(ev: any) => void} onclick @param {string} [cls] e.g. ".ea-go" */
export const btn = (label, onclick, cls = '') => h('button.ea-btn' + cls, { type: 'button', onclick }, label);
