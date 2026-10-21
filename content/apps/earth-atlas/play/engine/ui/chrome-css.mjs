// @ts-check
// Styles of the app chrome. Every size is in em and derives from one font size on the app root
// (17px x --zoom, zoom 1..3), so the whole chrome scales with the text size setting. Rows wrap instead of clipping,
// the page scrolls as a whole, and every control is at least 44 px tall.
export const APP_CSS = `
.ea-app { min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; background: var(--bg); background: var(--stage, var(--bg)); background-attachment: fixed; color: var(--fg); font-family: var(--font); font-size: calc(17px * var(--zoom, 1) * var(--fs, 1)); line-height: 1.5; overflow-wrap: break-word; hyphens: auto; -webkit-text-size-adjust: 100%; }
.ea-app *, .ea-app *::before { box-sizing: border-box; }
.ea-app [hidden] { display: none !important; }
.ea-app [tabindex="-1"]:focus { outline: none; }
.ea-app :focus-visible { outline: 0.18em solid var(--accent); outline-offset: 0.12em; }
.ea-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em 0.75em; width: 100%; max-width: 72em; margin: 0 auto; padding: 0.6em 1em; }
.ea-title { flex: 1 1 8em; margin: 0; font-size: 1.15em; font-weight: 650; line-height: 1.25; }
.ea-main { order: 1; flex: 1; width: 100%; max-width: 72em; margin: 0 auto; padding: 1em 1em 2em; display: flex; flex-direction: column; gap: 1.4em; }
.ea-main.ea-flush { padding: 0; gap: 0; }
.ea-btn { display: inline-flex; align-items: center; justify-content: center; min-height: max(44px, 2.75em); padding: 0.45em 0.95em; font: inherit; text-align: center; color: var(--fg); background: var(--card); border: 2px solid color-mix(in srgb, var(--fg) 16%, transparent); border-radius: 0.65em; cursor: pointer; }
.ea-btn.ea-go { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 650; }
.ea-btn.ea-chip { border-radius: 999px; }
.ea-btn:hover, .ea-item:hover { border-color: var(--accent); }
.ea-sec, .ea-slot, .ea-state, .ea-after { display: flex; flex-direction: column; gap: 0.7em; }
.ea-slot:empty, .ea-after:empty { display: none; }
/* scene plate: a picture panel above the game screen; text is never drawn on it (engine/ui/scene-plate.mjs) */
.ea-plate { margin: 0.6em auto 0; width: calc(100% - 2em); max-width: 36em; aspect-ratio: 16 / 6; max-height: 28vh; overflow: hidden; border-radius: 1.1em; background: linear-gradient(120deg, #123a56, #0b1720); box-shadow: 0 0.3em 0.9em rgba(3, 10, 16, 0.3); }
.ea-plate img { width: 100%; height: 100%; object-fit: cover; object-position: center; display: block; }
.ea-big .ea-plate, .ea-fly .ea-plate { display: none; }
@media (orientation: landscape) and (max-height: 520px) { .ea-plate { display: none; } }
.ea-after, .ea-state { width: 100%; max-width: 48em; margin: 0 auto; padding: 1em 1em 2em; gap: 1.2em; }
.ea-h { margin: 0; font-size: 1.05em; font-weight: 650; line-height: 1.3; }
.ea-state .ea-h { font-size: 1.35em; }
.ea-note, .ea-state p { margin: 0; color: var(--muted); }
.ea-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6em; }
.ea-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 13em), 1fr)); }
.ea-item { display: flex; flex-direction: column; gap: 0.15em; width: 100%; min-height: max(44px, 2.75em); padding: 0.8em 1em; font: inherit; text-align: left; color: var(--fg); background: var(--card); border: 2px solid transparent; border-radius: 0.8em; box-shadow: 0 1px 0 color-mix(in srgb, var(--fg) 10%, transparent); cursor: pointer; }
.ea-name { font-weight: 600; }
.ea-sub { font-size: 0.85em; color: var(--muted); }
.ea-chips, .ea-search { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0.5em; }
.ea-field { flex: 1 1 10em; display: flex; flex-direction: column; gap: 0.25em; font-size: 0.9em; color: var(--muted); }
.ea-in { width: 100%; min-height: max(44px, 2.75em); padding: 0.45em 0.8em; font: inherit; font-size: 1.1em; color: var(--fg); background: var(--card); border: 2px solid color-mix(in srgb, var(--fg) 16%, transparent); border-radius: 0.65em; }
.ea-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5em 1em; min-height: max(44px, 2.75em); padding: 0.8em 1em; background: var(--card); border-radius: 0.8em; }
.ea-row > span { flex: 1 1 9em; }
.ea-check { flex: none; font: inherit; width: 1.5em; height: 1.5em; min-width: 24px; min-height: 24px; accent-color: var(--accent); }
.ea-range { flex: 1 1 100%; width: 100%; min-height: 44px; margin: 0; accent-color: var(--accent); }
.ea-meter { height: 0.55em; border-radius: 999px; background: color-mix(in srgb, var(--fg) 12%, transparent); overflow: hidden; }
.ea-meter > div { width: 0; height: 100%; background: var(--accent); transition: width 0.2s; }
.ea-world { display: block; width: 100%; aspect-ratio: 16 / 10; max-height: 70vh; background: color-mix(in srgb, var(--fg) 85%, var(--bg)); }
.ea-app a { color: var(--accent); }
.ea-pre { white-space: pre-wrap; -webkit-user-select: text; user-select: text; }
.ea-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.ea-rm *, .ea-rm *::before { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
/* flight controls: under the canvas in portrait; in landscape on a short screen the canvas keeps the left, the controls and the text take a column on the right, so nothing covers the picture */
.ea-fc { width: 100%; box-sizing: border-box; }
@media (orientation: landscape) and (min-width: 700px) {
  .ea-main.ea-flush:has(> canvas.ea-world:not([hidden])) { display: grid; max-width: none; grid-template-columns: minmax(0, 1fr) minmax(min(16em, 48%), min(30em, 46%)); align-items: start; align-content: start; }
  .ea-main.ea-flush:has(> canvas.ea-world:not([hidden])) > canvas.ea-world { grid-column: 1; grid-row: 1 / span 12; position: sticky; top: 0; aspect-ratio: auto; max-height: none; width: 100%; height: calc(100vh - 3.6em); height: calc(100dvh - 3.6em); min-height: 10em; }
  .ea-main.ea-flush:has(> canvas.ea-world:not([hidden])) > :not(canvas) { grid-column: 2; min-width: 0; }
  .ea-fc .ea-fc-track.v { height: 6em; min-height: 88px; }
  .ea-fc .ea-fc-stick { width: min(7em, 30vw); min-width: 96px; }
  .ea-fc .ea-fc-group:has(> .ea-fc-track.v) { display: grid; grid-template-columns: auto auto; align-items: center; column-gap: 0.5em; }
  .ea-fc .ea-fc-group:has(> .ea-fc-track.v) > .ea-fc-label { grid-column: 1 / -1; }
  .ea-fc .ea-fc-group:has(> .ea-fc-track.v) > .ea-fc-steps { flex-direction: column; }
  .ea-fc .ea-fc-main { justify-content: space-around; }
}
@media (orientation: portrait) { .ea-world { max-height: 52vh; max-height: 52dvh; } }
/* a briefing shows its picture small: the buttons must be on the first screen */
.ea-main:has([data-kind="intro"], [data-kind="brief"], [data-kind="briefing"]) > canvas.ea-world { aspect-ratio: 16 / 6; max-height: 24vh; max-height: 24dvh; }
/* presentation flow (docs/PRESENTATION-FLOW.md): the brand header, three views of the games, the game pages, Watch and Learn */
.ea-vh { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: normal; }
.ea-ui { display: block; width: 1.3em; height: 1.3em; flex: none; }
.ea-main:has(> .ea-games), .ea-main:has(> .ea-slot > .ea-learnbar) { max-width: 72em; }
.ea-main > .ea-slot > .ea-sec, .ea-main > .ea-slot > .ea-hero, .ea-main > .ea-slot > .ea-menu, .ea-main > .ea-slot > .ea-next, .ea-main > .ea-sec { max-width: 48em; width: 100%; margin-left: auto; margin-right: auto; }
.ea-brandbar { padding-top: 0.9em; }
.ea-brand { flex: 1 1 7em; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.15em 0.7em; }
.ea-logo { display: block; height: 2em; width: auto; max-width: 100%; }
.ea-mark { display: block; height: 2.2em; width: 2.2em; }
.ea-appname { flex-basis: 100%; font-size: 0.72em; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted); }
.ea-tools { flex: 0 1 auto; max-width: 100%; margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; gap: 0.5em; }
.ea-views { display: flex; flex-wrap: wrap; gap: 0.2em; padding: 0.22em; border-radius: 1.4em; background: color-mix(in srgb, var(--fg) 10%, transparent); }
.ea-ib { display: inline-flex; align-items: center; justify-content: center; min-width: max(44px, 2.4em); min-height: max(44px, 2.4em); padding: 0.3em 0.6em; font: inherit; color: var(--fg); background: transparent; border: 0; border-radius: 999px; cursor: pointer; }
.ea-ib[aria-pressed="true"] { background: color-mix(in srgb, var(--fg) 22%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--fg) 25%, transparent); }
.ea-gear { background: color-mix(in srgb, var(--fg) 10%, transparent); }
.ea-pill { align-items: center; gap: 0.6em; padding: 0 1em; border-radius: 999px; background: color-mix(in srgb, var(--card) 55%, transparent); border: 1px solid color-mix(in srgb, var(--fg) 16%, transparent); box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 8%, transparent); }
.ea-pill .ea-q { flex: 1 1 0; min-width: 0; border: 0; background: transparent; padding-left: 0; font-size: 1em; }
.ea-pill .ea-q:focus-visible { outline: none; }
.ea-big .ea-pill > .ea-ui { display: none; }
.ea-big .ea-pill { padding: 0 0.6em; }
/* text size 200-300%: the header collapses to two rows (logo and name; then the view switch with settings, all on one line), controls keep a touch size of 56 px instead of scaling with the text */
.ea-big .ea-brandbar { padding-top: 0.5em; }
.ea-big .ea-brand { flex: 1 1 100%; }
.ea-big .ea-logo { height: 1.3em; }
.ea-big .ea-mark { height: 1.5em; width: 1.5em; }
.ea-big .ea-appname { font-size: 0.55em; }
.ea-big .ea-tools { flex: 1 1 100%; justify-content: flex-end; gap: 0.2em; margin-left: 0; }
.ea-big .ea-views { gap: 0.1em; padding: 0.1em; }
.ea-big .ea-ib { min-width: 56px; min-height: 56px; padding: 0.1em; }
.ea-big .ea-ib .ea-ui { width: 0.8em; height: 0.8em; }
.ea-big .ea-bar { gap: 0.3em; padding-top: 0.3em; padding-bottom: 0.3em; }
.ea-big .ea-bar > .ea-btn { min-height: 56px; min-width: 56px; padding: 0 0.7em; font-size: 0.6em; flex: 0 0 auto; }
.ea-big .ea-title { flex: 1 1 4em; min-width: 0; font-size: 0.7em; }
.ea-big .ea-pill .ea-q { min-height: 56px; font-size: 0.7em; padding-right: 0; }
.ea-pill:focus-within { outline: 0.18em solid var(--accent); outline-offset: 0.12em; }
.ea-gallery, .ea-cards, .ea-wides { list-style: none; margin: 0; padding: 0; display: grid; }
.ea-gallery { gap: 1.2em 0.9em; grid-template-columns: repeat(auto-fill, minmax(min(100%, 5.6em), 1fr)); }
.ea-gallery.ea-small { grid-template-columns: repeat(auto-fill, minmax(min(100%, 5em), 1fr)); }
.ea-tile .ea-lockbadge, .ea-tile .ea-tag { max-width: 100%; }
.ea-tile { display: flex; flex-direction: column; align-items: flex-start; gap: 0.35em; width: 100%; min-height: max(44px, 2.75em); padding: 0; font: inherit; font-size: 0.82em; line-height: 1.25; text-align: left; color: var(--fg); background: none; border: 0; cursor: pointer; }
.ea-tile .ea-name { font-weight: 600; }
.ea-gicon { display: block; width: 100%; height: auto; aspect-ratio: 1; border-radius: 22.5%; background: #0b1720; box-shadow: 0 0.35em 0.9em rgba(3, 10, 16, 0.45), 0 0 0 1px color-mix(in srgb, #ffffff 10%, transparent); transition: transform 0.15s; }
.ea-tile:hover .ea-gicon, .ea-tile:focus-visible .ea-gicon { transform: translateY(-0.12em) scale(1.02); }
.ea-debugbar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; justify-content: center; gap: 0.8em; padding: 0.35em 0.8em; background: #6d4c00; color: #fff; font-weight: 800; letter-spacing: 0.06em; text-align: center; font-size: 0.85em; }
.ea-debugbtn { font: inherit; font-size: 0.85em; padding: 0.2em 0.7em; border-radius: 0.6em; border: 1px solid #fff; background: transparent; color: #fff; }
.ea-debugbar { flex-wrap: wrap; }
.ea-debugbar-on { background: #c62828; }
.ea-debugbar[hidden] { display: none; }
.ea-debugbelt { position: fixed; left: 0; right: 0; bottom: 0; z-index: 2147483647; padding: 0.3em 0.6em; background: #b00020; color: #fff; font-weight: 700; font-size: 0.7em; text-align: center; pointer-events: none; }
.ea-debugbelt[hidden] { display: none; }
.ea-lockbadge { display: inline-flex; align-items: center; gap: 0.3em; align-self: flex-start; padding: 0.1em 0.6em 0.1em 0.45em; font-size: 0.82em; font-weight: 650; border-radius: 999px; color: inherit; background: color-mix(in srgb, currentColor 16%, transparent); }
.ea-freebadge { display: inline-flex; align-items: center; gap: 0.3em; align-self: flex-start; padding: 0.12em 0.7em 0.12em 0.5em; font-size: 0.9em; font-weight: 800; letter-spacing: 0.06em; border-radius: 999px; color: #3a2600; background: linear-gradient(135deg, #ffe27a, #ffb52e); box-shadow: 0 1px 6px rgba(255, 181, 46, 0.55); }
.ea-freebadge .ea-ui { width: 1em; height: 1em; }
.ea-tile .ea-freebadge { max-width: 100%; }
.ea-lockbadge .ea-ui { width: 1.05em; height: 1.05em; }
.ea-tag { display: inline-block; padding: 0.1em 0.6em; font-size: 0.82em; font-weight: 650; border-radius: 999px; color: var(--fg); background: color-mix(in srgb, var(--fg) 14%, transparent); }
.ea-cards { gap: 1em; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19em), 1fr)); align-items: start; }
.ea-card { display: flex; align-items: center; gap: 0.8em; width: 100%; min-height: 5.2em; padding: 0.9em 1em 0.9em 1.2em; font: inherit; text-align: left; color: #ffffff; background: linear-gradient(115deg, var(--t1), var(--t2)); border: 0; border-radius: 1.1em; box-shadow: 0 0.4em 1em rgba(3, 10, 16, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.18); cursor: pointer; }
.ea-card .ea-txt { flex: 1; }
.ea-card .ea-name { font-size: 1.12em; font-weight: 650; line-height: 1.25; }
.ea-card .ea-line, .ea-wide .ea-line, .ea-wide .ea-facts, .ea-ghero .ea-sub, .ea-ghero .ea-lead { color: rgba(255, 255, 255, 0.86); }
.ea-card .ea-ui, .ea-wide .ea-ui { width: 1.4em; height: 1.4em; }
.ea-wides { gap: 1em; grid-template-columns: repeat(auto-fill, minmax(min(100%, 21em), 1fr)); }
.ea-wide { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6em; padding: 0.7em 0.9em; color: #ffffff; background: linear-gradient(115deg, var(--t1), var(--t2)); border-radius: 1.1em; box-shadow: 0 0.4em 1em rgba(3, 10, 16, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.16); }
.ea-wmain { flex: 1 1 min(100%, 12em); min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 0.8em; min-height: max(44px, 2.75em); padding: 0; font: inherit; text-align: left; color: inherit; background: none; border: 0; cursor: pointer; }
.ea-wmain .ea-txt { flex: 1 1 8em; }
.ea-wmain .ea-gicon { width: min(4.2em, 30vw); flex: none; border-radius: 22.5%; }
.ea-wide .ea-name { font-weight: 650; }
.ea-wide .ea-facts, .ea-wide .ea-line { font-size: 0.8em; }
.ea-round { flex: none; display: inline-flex; align-items: center; justify-content: center; width: max(44px, 2.6em); height: max(44px, 2.6em); padding: 0; border: 0; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #ffe3b8, #ffb36e 55%, #f28a3c); box-shadow: 0 0.2em 0.5em rgba(3, 10, 16, 0.4); cursor: pointer; }
.ea-round .ea-ui { width: 1.25em; height: 1.25em; margin-left: 0.12em; }
.ea-together { margin-top: 0.6em; padding-top: 1em; border-top: 1px solid color-mix(in srgb, var(--fg) 14%, transparent); max-width: 48em; }
.ea-chips.ea-subjects .ea-btn[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--bg); font-weight: 650; }
.ea-learnbar { display: flex; flex-wrap: wrap; gap: 0.6em; align-items: center; }
.ea-learnbar > .ea-pill { flex: 1 1 14em; }
.ea-icon { display: block; width: min(4.2em, 28vw); height: auto; aspect-ratio: 1; max-width: 100%; border-radius: 22%; filter: drop-shadow(0 0.15em 0.2em color-mix(in srgb, var(--fg) 25%, transparent)); }
.ea-icon.ea-big-icon { width: min(6.5em, 36vw); }
.ea-icon.ea-mini { width: min(2.6em, 18vw); flex: none; }
.ea-item:has(> .ea-mini) { flex-direction: row; align-items: center; gap: 0.8em; }
.ea-txt { display: flex; flex-direction: column; gap: 0.15em; min-width: 0; }
.ea-line:empty { display: none; }
.ea-hero { display: flex; flex-wrap: wrap; align-items: center; gap: 1em; }
.ea-hero > div { flex: 1 1 10em; display: flex; flex-direction: column; gap: 0.6em; }
.ea-ghero { padding: 1.1em; color: #ffffff; background: linear-gradient(120deg, var(--t1), var(--t2)); border-radius: 1.3em; box-shadow: 0 0.5em 1.2em rgba(3, 10, 16, 0.35); }
.ea-ghero .ea-gicon.ea-big-icon { width: min(7.5em, 34vw); flex: none; }
.ea-ghero .ea-msg { color: #ffffff; }
.ea-lead { margin: 0; font-size: 1.1em; font-weight: 600; }
.ea-ghero .ea-btn.ea-go { background: #ffffff; border-color: #ffffff; color: #0b1720; }
.ea-steps { margin: 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: 0.45em; }
.ea-sec { padding: 0; }
.ea-unlock { padding: 1em; background: color-mix(in srgb, var(--card) 80%, transparent); border: 2px solid color-mix(in srgb, var(--accent) 35%, transparent); border-radius: 0.9em; }
.ea-msg { margin: 0; font-weight: 600; }
.ea-sec > p { margin: 0; }
.ea-menu { display: flex; flex-direction: column; gap: 0.6em; }
.ea-menu > .ea-btn { width: 100%; justify-content: flex-start; text-align: left; min-height: max(52px, 3.1em); font-weight: 600; background: color-mix(in srgb, var(--card) 82%, transparent); }
.ea-menu > .ea-btn.ea-go { background: var(--accent); color: var(--bg); }
.ea-levels .ea-level { flex-direction: row; align-items: center; gap: 0.8em; background: color-mix(in srgb, var(--card) 82%, transparent); }
.ea-num { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 2.2em; height: 2.2em; padding: 0 0.3em; font-weight: 700; border-radius: 999px; background: color-mix(in srgb, var(--fg) 12%, transparent); }
.ea-level[data-state="done"] .ea-num { background: color-mix(in srgb, #8fd89a 40%, transparent); }
.ea-level[data-state="next"] { border-color: var(--accent); }
.ea-level[data-state="next"] .ea-num { background: var(--accent); color: var(--bg); }
.ea-nextup { color: #ffffff; background: linear-gradient(115deg, var(--t1), var(--t2)); }
.ea-nextup .ea-sub { color: rgba(255, 255, 255, 0.86); }
.ea-nextup .ea-name { font-size: 1.15em; }
.ea-item { background: color-mix(in srgb, var(--card) 82%, transparent); }
.ea-watch { width: 100%; max-width: 48em; margin: 0 auto; padding: 0.8em 1em; display: flex; flex-direction: column; gap: 0.6em; background: var(--card); border-bottom: 2px solid var(--accent); }
.ea-narr { margin: 0; font-size: 1.05em; font-weight: 600; }
.ea-pv { width: 100%; max-width: 48em; margin: 0 auto; padding: 0.45em 1em; display: flex; align-items: center; justify-content: space-between; gap: 0.8em; background: var(--card); border-bottom: 2px solid var(--accent); font-size: 0.95em; }
.ea-pv[hidden] { display: none; }
.ea-pv-t { font-weight: 600; }
.ea-immersive .ea-bar { max-width: none; }
.ea-bar > .ea-btn:first-child { border-radius: 999px; border-color: transparent; background: color-mix(in srgb, var(--fg) 12%, transparent); }
/* fluid layout (docs/PRESENTATION-FLOW.md "Fluid layout and full screen"): everything is em, so one type scale (--fs) grows the whole chrome on tablets; breakpoints are viewport width and height, never the device; text size 200% and up keeps scale 1 */
@media (min-width: 600px) and (min-height: 540px) { .ea-app { --fs: 1.12; } .ea-gallery { grid-template-columns: repeat(auto-fill, minmax(min(100%, 6.8em), 1fr)); } }
@media (min-width: 800px) and (min-height: 760px) { .ea-app { --fs: 1.3; } .ea-gallery { grid-template-columns: repeat(auto-fill, minmax(min(100%, 8em), 1fr)); } }
.ea-app.ea-big { --fs: 1; }
.ea-app.ea-big .ea-gallery { grid-template-columns: repeat(auto-fill, minmax(min(100%, 5.6em), 1fr)); }
@media (min-width: 840px) {
  .ea-main > .ea-slot > .ea-sec:has(> .ea-levels), .ea-main > .ea-slot > .ea-sec:has(> .ea-list), .ea-main > .ea-sec { max-width: 72em; }
  .ea-main > .ea-slot > .ea-next { max-width: 72em; }
  .ea-app:not(.ea-big) .ea-levels, .ea-app:not(.ea-big) .ea-sec > .ea-list, .ea-app:not(.ea-big) .ea-slot > .ea-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 19em), 1fr)); }
  .ea-app:not(.ea-big) .ea-main > .ea-slot:has(> .ea-hero) { display: grid; grid-template-columns: minmax(14em, 5fr) minmax(0, 7fr); gap: 1.2em 1.6em; align-items: start; max-width: 72em; width: 100%; margin: 0 auto; }
  .ea-app:not(.ea-big) .ea-main > .ea-slot:has(> .ea-hero) > .ea-hero { grid-column: 1; grid-row: 1 / span 12; position: sticky; top: 1em; max-width: none; }
  .ea-app:not(.ea-big) .ea-main > .ea-slot:has(> .ea-hero) > :not(.ea-hero) { grid-column: 2; max-width: none; }
}
/* real-device audit (docs/DEVICE-AUDIT.md): classes the first fluid pass missed. 7-inch tablets in portrait are 540 to 599 px wide; 13-inch tablets are at least 1000 x 900 */
@media (min-width: 520px) and (max-width: 599px) and (min-height: 700px) { .ea-app { --fs: 1.08; } .ea-gallery { grid-template-columns: repeat(auto-fill, minmax(min(100%, 6.4em), 1fr)); } }
@media (min-width: 1000px) and (min-height: 900px) { .ea-app { --fs: 1.5; } .ea-gallery { grid-template-columns: repeat(auto-fill, minmax(min(100%, 8.4em), 1fr)); } }
/* a map or globe in portrait is square (capped at 52 % of the height), not a thin 16:10 strip; flight screens fill the display instead */
@media (orientation: portrait) { .ea-world { aspect-ratio: 1 / 1; } }
/* phones in landscape (viewport height 520 px or less): the header, scene band and hero must not take half the screen, so the main button of every page is on the first screen */
@media (orientation: landscape) and (max-height: 520px) {
  .ea-main { padding-top: 0.5em; padding-bottom: 1em; gap: 0.9em; }
  .ea-bar { padding-top: 0.3em; padding-bottom: 0.3em; }
  .ea-app:not(.ea-big) .ea-brandbar { padding-top: 0.4em; }
  .ea-app:not(.ea-big) .ea-logo { height: 1.5em; }
  .ea-app:not(.ea-big) .ea-mark { height: 1.7em; width: 1.7em; }
  .ea-wides, .ea-cards { grid-template-columns: repeat(auto-fill, minmax(min(100%, 16em), 1fr)); }
  .ea-app:not(.ea-big) .ea-ghero { padding: 0.7em; gap: 0.7em; }
  .ea-app:not(.ea-big) .ea-ghero .ea-gicon.ea-big-icon, .ea-app:not(.ea-big) .ea-icon.ea-big-icon { width: min(4.4em, 22vh); }
  .ea-app:not(.ea-big) .ea-hero > div { flex-basis: 8em; gap: 0.35em; }
  .ea-app:not(.ea-big) .ea-menu { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 11em), 1fr)); gap: 0.5em; }
  .ea-app:not(.ea-big) .ea-menu > .ea-btn.ea-go { grid-column: 1 / -1; }
  .ea-app:not(.ea-big) .ea-menu > .ea-btn { min-height: max(44px, 2.5em); }
  .ea-app .earth-screen { max-width: none; padding: 0.5rem 1rem 1.2rem; gap: 0.6rem; }
  .ea-app .earth-title { font-size: 1.2em; }
  .ea-app .earth-block { padding: 0.6rem 0.9rem; }
  .ea-app .earth-actions { flex-direction: row; flex-wrap: wrap; }
  .ea-app .earth-actions > .earth-btn { flex: 1 1 11em; }
}
@media (prefers-reduced-motion: reduce) { .ea-app * { transition: none !important; animation: none !important; } }
`;
