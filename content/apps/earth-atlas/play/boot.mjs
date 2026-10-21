// @ts-check
// First code the shell runs. It wires the native bridge and starts the app: the app's own start module when app.json names one,
// otherwise the standard engine app (engine/app/start.mjs) when a catalog is installed, otherwise the built-in starter list below,
// which is enough to prove a shell on a device with loose packs.
import { createNative } from './native.mjs';

const root = /** @type {HTMLElement} */ (document.getElementById('app'));
const note = text => { const p = document.createElement('pre'); p.className = 'shell-note'; p.textContent = text; root.replaceChildren(p); };

async function main() {
  const native = createNative();
  const app = await (await fetch('./app.json')).json();
  document.title = app.name;
  const loadTemplate = async id => (await import(`./templates/${id}/template.mjs`)).default;
  const now = () => Date.now();
  // Dev builds only: the generator ships store-fake.mjs and sets app.fakeStore when built with EARTH_FAKE_STORE=1 (or for the desktop preview).
  if (app.fakeStore) (await import('./store-fake.mjs')).installFakeStore(native, app);
  // Developer builds only (EARTH_DEBUG_UNLOCK=1 or the desktop preview): the generator ships debug-unlock.mjs and sets app.debugUnlock.
  const debug = app.debugUnlock ? await (await import('./debug-unlock.mjs')).createDebugUnlock({ native, app }) : undefined;
  if (app.start) return (await import(app.start)).start({ root, native, app, loadTemplate, now, debug });
  if (await native.adapter.readFile('catalog', 'index.json')) {
    const flight = app.worldBase ? await flightServices(native, now) : app.baseMap ? await mapServices(app.baseMap, now) : {};
    const running = await (await import('./engine/app/start.mjs')).start({ root, native, app, loadTemplate, now, debug, assetPacks: await mediaAware(), log: m => console.warn(m), ...flight });
    // Desktop preview only (shells/preview.mjs): open a pack named in the address, and let the preview script reach the app.
    if (native.platform === 'web') {
      /** @type {any} */ (globalThis).__earthApp = running;
      const id = new URLSearchParams(location.hash.slice(1)).get('pack');
      if (id) running.ui.go('pack', { id });
    }
    return running;
  }
  return starter(native, app);
}

/**
 * Flight apps: one world (terrain from the installed world packs), the renderer bound to it and the landing finder, built once and shared.
 * A device without the world packs still starts: the world is then an empty sea and the app says so in its screens, never an error.
 */
async function flightServices(native, now) {
  const [{ createWorld, createPackStorage }, { createRenderFactory }, { createLandingFinder }] = await Promise.all([
    import('./engine/world/index.mjs'), import('./engine/render/index.mjs'), import('./engine/landing/index.mjs'),
  ]);
  const world = createWorld({ storage: createPackStorage((pack, path) => native.adapter.readFile(pack, path)) });
  const opened = await world.open();
  if (!opened) console.warn('world packs are not installed: terrain is not available');
  const credits = world.credits().map(c => (typeof c === 'string' ? { title: c } : c));
  return { render: createRenderFactory({ world, now }), services: { world, landing: createLandingFinder({ world, now }) }, credits };
}

/**
 * Apps without the world base whose templates show maps or globes: the renderer bound to the built-in base map (land, water,
 * coasts, boundaries; shipped in www by the generator). No world service: templates still get none. Without the file the app
 * starts as before (no map is drawn, the button paths of the templates still work).
 */
async function mapServices(path, now) {
  try {
    const [{ createBaseMap }, { createRenderFactory }] = await Promise.all([import('./engine/world/basemap.mjs'), import('./engine/render/index.mjs')]);
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    const map = createBaseMap(new Uint8Array(await res.arrayBuffer()));
    return { render: createRenderFactory({ world: map, now }), credits: map.credits() };
  } catch (e) { console.warn('base map not available:', e); return {}; }
}

/** The download policy layer of engine/net, told which chunks are optional media (never fetched in low-data mode). */
async function mediaAware() {
  const { createAssetPacks } = await import('./engine/net/assetpacks.mjs');
  return (adapter, opts = {}) => createAssetPacks(adapter, { kindOf: id => (/^media[-_]/.test(id) ? 'media' : 'content'), ...opts });
}

/** Minimal built-in app: a list of installed packs, play one, come back. */
async function starter(native, app) {
  const [{ renderScreen, setTextZoom, BASE_CSS }, { createEnv }, { guardInstance }] = await Promise.all([
    import('./engine/ui/render-dom.mjs'), import('./engine/core/env.mjs'), import('./engine/core/template.mjs'),
  ]);
  const style = document.createElement('style'); style.textContent = BASE_CSS; document.head.append(style);
  const text = async (chunk, path) => { const b = await native.adapter.readFile(chunk, path); return b ? JSON.parse(new TextDecoder().decode(b)) : null; };
  const zoom = Number(await native.kv.get('settings.textZoom')) || 1;
  setTextZoom(zoom);
  const packs = [];
  for (const chunk of await native.adapter.listInstalled()) { const c = await text(chunk, 'chunk.json'); for (const p of c?.packs || []) packs.push({ ...p, chunk }); }
  let closePack = null;
  native.on('back', () => { if (!closePack) return false; closePack(); return true; });

  function home() {
    closePack = null;
    renderScreen(root, {
      kind: 'menu', title: app.name,
      body: [{ text: packs.length ? `${packs.length} games on this device. Everything works offline.` : 'No games are installed.' }],
      choices: packs.slice(0, 200).map((p, i) => ({ id: String(i), label: p.title })),
    }, { theme: app.theme, onAct: id => play(packs[Number(id)]) });
  }

  async function play(entry) {
    const dir = `packs/${entry.id}`;
    const pack = { manifest: await text(entry.chunk, `${dir}/manifest.json`), data: await text(entry.chunk, `${dir}/data.json`), theme: (await text(entry.chunk, `${dir}/theme.json`)) || app.theme, media: { items: [] } };
    const tpl = (await import(`./templates/${pack.manifest.template}/template.mjs`)).default;
    const inst = guardInstance(tpl.create(pack, createEnv({ seed: String(Date.now()), now: () => Date.now(), settings: { textZoom: zoom } })));
    closePack = home;
    const draw = () => {
      const s = inst.screen();
      renderScreen(root, s, { theme: pack.theme, onAct: id => { inst.act(id); draw(); } });
      window.scrollTo(0, 0);
    };
    draw();
  }
  home();
}

main().catch(e => note(`This app could not start.\n\n${e?.stack || e}`));
