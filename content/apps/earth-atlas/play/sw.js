// Earth Atlas browser demo: offline-first cache, scope = this folder. Version 1c8a8d383531 changes with every build (old caches are removed on activation).
const V = '1c8a8d383531', PRE = 'earth-demo-pre-' + V, RT = 'earth-demo-rt-' + V, MAX_RT = 700;
const PRECACHE = ["./","./_app/c/assetpacks-IVOEHEEF.js","./_app/c/basemap-NNIOLCDI.js","./_app/c/chunk-DACHLBSP.js","./_app/c/chunk-FM7UBU33.js","./_app/c/chunk-JST6XIPE.js","./_app/c/chunk-QSP6WSOZ.js","./_app/c/chunk-TEOQS2PV.js","./_app/c/chunk-ZWWIFLPI.js","./_app/c/env-B4MCOYTQ.js","./_app/c/render-CPYI52L5.js","./_app/c/render-dom-JD2Z3MQN.js","./_app/c/start-7RYMATH5.js","./_app/c/template-2I5MI73Q.js","./_app/c/template-2JZSJR2I.js","./_app/c/template-3QJU7MYF.js","./_app/c/template-4KRNLJZA.js","./_app/c/template-7VF243AU.js","./_app/c/template-E7U7KYFD.js","./_app/c/template-EAMBXVKG.js","./_app/c/template-ONYFDUKT.js","./_app/c/template-WPMFJTCD.js","./_app/demo-boot-4Z44M25U.js","./_chunk/catalog/index.json","./_chunk/catalog/shards/climate/starter.json","./_chunk/catalog/shards/countries/starter.json","./app.json","./brand/logo-dark.svg","./brand/logo-light.svg","./engine/world/data/basemap.ebm","./icons/capitals.webp","./icons/climate.webp","./icons/events.webp","./icons/food.webp","./icons/languages.webp","./icons/map.webp","./icons/mountains.webp","./icons/neighbours.webp","./icons/sizes.webp","./icons/waters.webp","./icons/wild-range.webp"];
self.addEventListener('install', e => e.waitUntil(caches.open(PRE).then(c => Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })))))));
// no skipWaiting: a page that is open keeps the files (and lazy chunks) it started with; the new version takes over when the tab is closed
self.addEventListener('activate', e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith('earth-demo-') && k !== PRE && k !== RT) await caches.delete(k); await self.clients.claim(); })()));
const scope = new URL('./', self.location).pathname;
async function put(r, res) { if (!res || res.status !== 200) return; const c = await caches.open(RT); await c.put(r, res.clone()); const ks = await c.keys(); if (ks.length > MAX_RT) for (const k of ks.slice(0, ks.length - MAX_RT)) await c.delete(k); }
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || !u.pathname.startsWith(scope) || u.pathname.endsWith('/sw.js')) return;
  if (r.mode === 'navigate') {   // the page: network first (a deploy shows up at once), the cache when offline or slow
    e.respondWith((async () => {
      try { const res = await Promise.race([fetch(r), new Promise((_, no) => setTimeout(() => no(new Error('slow')), 4000))]); e.waitUntil(put(r, res)); return res; }
      catch { return (await caches.match(r, { ignoreSearch: true })) || (await caches.match('./')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    // hashed bundle files never change: the cache first. Everything else (data, icons) is served from the cache AND refreshed in the background,
    // the refreshed copy (runtime cache) wins over the precached one, so a deploy shows up on the next visit and nothing stays stale for ever
    const hashed = u.pathname.includes('/_app/');
    const rt = await (await caches.open(RT)).match(r), hit = rt || await (await caches.open(PRE)).match(r);
    if (hit && hashed) return hit;
    const refresh = fetch(r).then(async res => { await put(r, res); return res; });
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  })());
});
