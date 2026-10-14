#!/usr/bin/env node
// Earth site builder. No dependencies. Reads content/ + data/, writes _site/.
// Scales to tens of thousands of projects: static pages, paginated lists, sharded catalog and search index, sitemap index.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, '_site');
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const domains = JSON.parse(readFileSync(join(ROOT, 'content/domains.json'), 'utf8'));
const projects = loadProjects();
const BASE = site.basePath || '/';
const PAGE_SIZE = 100;
const DOCS_PER_CHUNK = 500;
const now = new Date().toISOString().slice(0, 10);

function loadProjects() {
  const dir = join(ROOT, 'data/catalog');
  const files = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.json')) : [];
  const all = [];
  for (const f of files) { const arr = JSON.parse(readFileSync(join(dir, f), 'utf8')); if (Array.isArray(arr)) all.push(...arr); }
  const seen = new Set();
  return all.filter(p => { if (!p.id || seen.has(p.id)) return false; seen.add(p.id); return true; })
            .sort((a, b) => a.title.localeCompare(b.title));
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const url = p => BASE + p.replace(/^\//, '');
function write(rel, html) { const f = join(OUT, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, html); }

const topicIndex = new Map(); // slug -> {topic, domain}
for (const d of domains) for (const t of d.topics) topicIndex.set(t.slug, { topic: t, domain: d });
const byDomain = new Map(domains.map(d => [d.slug, []]));
const byTopic = new Map([...topicIndex.keys()].map(k => [k, []]));
for (const p of projects) {
  if (byDomain.has(p.domain)) byDomain.get(p.domain).push(p);
  for (const t of p.topics || []) if (byTopic.has(t)) byTopic.get(t).push(p);
}

const globeSvg = `<svg viewBox="0 0 200 200" role="img" aria-label="A stylised globe" class="globe" xmlns="http://www.w3.org/2000/svg">
<defs><radialGradient id="g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#9fd8c7"/><stop offset=".55" stop-color="#2f8c77"/><stop offset="1" stop-color="#174f44"/></radialGradient></defs>
<circle cx="100" cy="100" r="92" fill="url(#g)"/>
<g fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2">
<ellipse cx="100" cy="100" rx="92" ry="34"/><ellipse cx="100" cy="100" rx="92" ry="68"/><line x1="8" y1="100" x2="192" y2="100"/>
<ellipse cx="100" cy="100" rx="34" ry="92"/><ellipse cx="100" cy="100" rx="68" ry="92"/><line x1="100" y1="8" x2="100" y2="192"/></g>
<g fill="rgba(214,176,112,.85)"><path d="M62 58c10-8 24-6 30 2 4 6-2 12-8 16-8 5-16 4-22-2-5-5-6-11 0-16z"/><path d="M118 72c8-4 18 0 20 8 2 9-4 16-12 18-9 2-16-3-17-11-1-7 3-12 9-15z"/><path d="M80 118c12-4 24 2 26 12 1 9-7 14-16 15-11 1-19-4-20-12-1-7 3-12 10-15z"/></g>
</svg>`;
// Brand mark: a small orthographic globe (Natural Earth land, generated once by tools/gen-mark.mjs into content/mark-paths.json).
const markPaths = JSON.parse(readFileSync(join(ROOT, 'content/mark-paths.json'), 'utf8'));
const markFile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="64" height="64">
<defs>
<radialGradient id="o" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#7fd0e8"/><stop offset=".5" stop-color="#1f86a8"/><stop offset="1" stop-color="#0a3d5c"/></radialGradient>
<linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9be3a4"/><stop offset="1" stop-color="#2f9a5a"/></linearGradient>
<radialGradient id="s" cx="50%" cy="50%" r="50%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#021626" stop-opacity=".5"/></radialGradient>
<radialGradient id="h" cx="30%" cy="24%" r="46%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
<clipPath id="c"><circle cx="100" cy="100" r="92"/></clipPath>
</defs>
<circle cx="100" cy="100" r="97" fill="none" stroke="#6fd3a8" stroke-opacity=".35" stroke-width="5"/>
<circle cx="100" cy="100" r="92" fill="url(#o)"/>
<g clip-path="url(#c)"><path d="${markPaths.grat}" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1.2"/>
<path d="${markPaths.land}" fill="url(#l)" stroke="#0e5a35" stroke-opacity=".55" stroke-width="1.1" stroke-linejoin="round"/>
<circle cx="100" cy="100" r="92" fill="url(#s)"/><circle cx="100" cy="100" r="92" fill="url(#h)"/></g>
<circle cx="100" cy="100" r="92" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>
</svg>`;
const markSvg = `<img class="mark" src="${url('assets/mark.svg')}" width="32" height="32" alt="" decoding="async">`;

// Theme menu: [value, name, description, swatch colour A, swatch colour B]. Swatches are half/half discs.
const THEMES = [
  ['nutrisize', 'Nutrisize', 'Fresh green, the default', '#ffffff', '#2f9e68'],
  ['arcforge', 'Arcforge', 'Violet and teal on ink', '#0d0b1f', '#7c5cff'],
  ['forest', 'Forest', 'Soft green on dark', '#14201a', '#8fd49a'],
  ['auto', 'Auto', 'Follows your device, light or dark', '#f6f2ea', '#171b1e'],
  ['light', 'Light', 'Warm paper, easy on the eyes', '#f6f2ea', '#1f6f5f'],
  ['dark', 'Dark', 'Warm dark, low glare', '#171b1e', '#78c7b2'],
  ['sepia', 'Sepia', 'Book-paper warmth', '#f4ecd8', '#8a4b12'],
  ['teal', 'Deep teal', 'Calm teal-slate, easy on the eyes', '#1b343a', '#394f54'],
  ['ocean', 'Ocean', 'Deep blue with sky accents', '#0f1f2e', '#6cc4ee'],
  ['contrast', 'High contrast', 'Maximum legibility', '#fffdf5', '#0b3fa8'],
];
const swatch = (a, b) => `<span class="sw" style="background:linear-gradient(135deg,${a} 50%,${b} 50%)" aria-hidden="true"></span>`;
const themeMenu = `<div class="theme-menu"><button class="ctl ctl--theme" id="theme-ctl" type="button" aria-haspopup="listbox" aria-expanded="false" aria-controls="theme-list" aria-label="Colour theme" title="Theme">${swatch('#ffffff', '#2f9e68')}<svg class="chev" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
<ul class="theme-list" id="theme-list" role="listbox" aria-label="Colour theme" hidden>${THEMES.map(([v, n, d, a, b]) => `<li role="option" tabindex="-1" data-theme-value="${v}" aria-selected="false">${swatch(a, b)}<span class="t-text"><span class="t-name">${n}</span><span class="t-desc">${d}</span></span><svg class="tick" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></li>`).join('')}</ul></div>`;

function layout({ title, description, body, path = '', current = '' }) {
  const fullTitle = path ? `${title} · ${site.name}` : `${site.name}: ${site.tagline}`;
  const canonical = site.url.replace(/\/$/, '') + '/' + path;
  return `<!doctype html>
<html lang="${site.language}" data-base="${BASE}" data-theme="nutrisize">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description || site.description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#171b1e" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${esc(fullTitle)}"><meta property="og:description" content="${esc(description || site.description)}"><meta property="og:type" content="website"><meta property="og:url" content="${esc(canonical)}">
<link rel="icon" href="${url('assets/icon.svg')}" type="image/svg+xml">
<link rel="stylesheet" href="${url('assets/site.css')}">
<script>(function(){try{var t=localStorage.getItem('earth.theme')||'nutrisize';if(t==='auto')document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',t);var z=parseInt(localStorage.getItem('earth.zoom'),10);if(z>=50&&z<=300)document.documentElement.style.setProperty('--zoom',z/100);}catch(e){}})();</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header"><div class="wrap">
<a class="brand" href="${url('')}">${markSvg}<span>${esc(site.name)}</span></a>
<nav class="nav" aria-label="Main">${site.nav.map(n => `<a href="${url(n.href)}"${current === n.href ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`).join('')}</nav>
<div class="controls"><div class="zoom" role="group" aria-label="Text size"><button class="ctl ctl--zoom" id="zoom-out" type="button" aria-label="Make text smaller" title="Smaller text"><span class="z-a z-a--sm">A</span><span class="z-sign">&minus;</span></button><button class="ctl ctl--zoomval" id="zoom-val" type="button" aria-label="Text size 100%. Press to reset to 100%" title="Reset text size to 100%">100%</button><button class="ctl ctl--zoom" id="zoom-in" type="button" aria-label="Make text larger" title="Larger text"><span class="z-a z-a--lg">A</span><span class="z-sign">+</span></button></div>${themeMenu}</div>
</div></header>
<main id="main">${body}</main>
<footer class="site-footer"><div class="wrap">
<div>${esc(site.name)}: ${esc(site.tagline)}. Facts are sourced and images are credited on every project page.</div>
<div><a href="${url('about/')}">About</a> · <a href="${url('sitemap.xml')}">Sitemap</a> · Updated ${now}</div>
</div></footer>
<script src="${url('assets/site.js')}" defer></script>
</body></html>`;
}

const searchForm = (autofocus = false) => `<form class="search" id="search-form" role="search" action="${url('search/')}" method="get">
<label class="skip" for="q">Search projects and topics</label>
<input id="q" name="q" type="search" placeholder="Search a place, animal, topic or game…" autocomplete="off"${autofocus ? ' autofocus' : ''}>
<button class="btn" type="submit">Search</button></form>
<div class="results-status" id="search-status" aria-live="polite"></div>
<ul class="results" id="search-results"></ul>`;

const projectLi = p => `<li><a href="${url(`projects/${p.id}/`)}">${esc(p.title)}</a> <span class="badge${p.status === 'live' ? '' : ' badge--coming'}">${esc(p.status || 'coming')}</span><p class="blurb">${esc(p.blurb)}</p></li>`;

function paginate(items, basePath, renderPage) {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  for (let i = 0; i < pages; i++) {
    const slice = items.slice(i * PAGE_SIZE, (i + 1) * PAGE_SIZE);
    const pager = pages > 1 ? `<nav class="pager" aria-label="Pages">${Array.from({ length: pages }, (_, n) => n === i ? `<span aria-current="page">${n + 1}</span>` : `<a href="${url(n === 0 ? basePath : `${basePath}page/${n + 1}/`)}">${n + 1}</a>`).join('')}</nav>` : '';
    write(join(i === 0 ? basePath : `${basePath}page/${i + 1}/`, 'index.html'), renderPage(slice, pager, i + 1, pages));
  }
}

// Interactive globe: places are curated in content/places.json (sources listed there); the canvas globe is built client-side by src/globe.js.
const placesDoc = JSON.parse(readFileSync(join(ROOT, 'content/places.json'), 'utf8'));
const topicTitles = new Map(domains.flatMap(d => d.topics.map(t => [t.slug, t.title])));
const placesOut = { ...placesDoc, places: placesDoc.places.map(p => ({ ...p, topicTitle: topicTitles.get(p.topic) || p.topic })) };
const kindCounts = placesDoc.places.reduce((m, p) => (m[p.kind] = (m[p.kind] || 0) + 1, m), {});
const globeStage = `<div class="globe-stage" id="globe-stage" aria-labelledby="globe-h">
<h2 class="skip" id="globe-h">Interactive globe of places to explore</h2>
<div class="globe-chips" role="group" aria-label="Show on the globe"><button type="button" class="chip" data-kind="all" aria-pressed="true">All <span>${placesDoc.places.length}</span></button>${placesDoc.kinds.map(k => `<button type="button" class="chip chip--${k.id}" data-kind="${k.id}" aria-pressed="false" title="${esc(k.blurb)}"><i class="dot dot--${k.id}" aria-hidden="true"></i>${esc(k.label)} <span>${kindCounts[k.id] || 0}</span></button>`).join('')}</div>
<div class="globe-canvas" id="globe" data-places="${url('assets/places.json')}" data-world="${url('assets/data/countries-110m.json')}" data-world-hi="${url('assets/data/countries-50m.json')}">${globeSvg}</div>
<p class="globe-hint muted">Switch between Globe and Flat map. Drag to move. Ctrl or ⌘ + scroll, or pinch, to zoom. Tap a marker or any country.</p>
<details class="globe-list"><summary>All ${placesDoc.places.length} places on the globe</summary><ul>${placesDoc.places.map(p => `<li><a href="${url('search/')}?q=${encodeURIComponent(p.name)}" data-place="${esc(p.id)}"><i class="dot dot--${p.kind}" aria-hidden="true"></i>${esc(p.name)} <span class="muted">${esc(p.where)}</span></a></li>`).join('')}</ul></details>
</div>
<script src="${url('assets/vendor/d3-array.min.js')}" defer></script><script src="${url('assets/vendor/d3-geo.min.js')}" defer></script><script src="${url('assets/vendor/topojson-client.min.js')}" defer></script><script src="${url('assets/globe.js')}" defer></script>`;

// ---------- Pages ----------
// Home
write('index.html', layout({
  title: site.name, description: site.description, body: `
<div class="wrap">
<div class="hero">
<div>
<h1>${esc(site.tagline)}</h1>
<p class="lede">${esc(site.description)}</p>
${searchForm()}
<p class="muted">${projects.length ? `${projects.length.toLocaleString()} projects across ${domains.length} domains.` : `${domains.length} domains, ${topicIndex.size} topics. First projects arrive soon.`}</p>
</div>
${globeStage}
</div>
<section aria-labelledby="explore-h">
<div class="section-head"><h2 id="explore-h">Explore by domain</h2><a href="${url('domains/')}">All domains</a></div>
<ul class="grid">${domains.map(d => `<li class="card card--domain"><a class="cover" href="${url(`domains/${d.slug}/`)}"><h3>${esc(d.title)}</h3></a><p class="blurb">${esc(d.blurb)}</p><div class="count">${d.topics.length} topics · ${byDomain.get(d.slug).length.toLocaleString()} projects</div></li>`).join('')}</ul>
</section>
<section aria-labelledby="how-h">
<h2 id="how-h">How Earth works</h2>
<ul class="principles">${site.principles.map(p => `<li><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></li>`).join('')}</ul>
</section>
</div>` }));

// Domains index
write('domains/index.html', layout({ title: 'Domains', path: 'domains/', current: 'domains/', body: `<div class="wrap"><p class="breadcrumb"><a href="${url('')}">Home</a> › Domains</p><h1>Domains</h1>
<ul class="grid">${domains.map(d => `<li class="card card--domain"><a class="cover" href="${url(`domains/${d.slug}/`)}"><h3>${esc(d.title)}</h3></a><p class="blurb">${esc(d.blurb)}</p><div class="count">${d.topics.length} topics · ${byDomain.get(d.slug).length.toLocaleString()} projects</div></li>`).join('')}</ul></div>` }));

// Domain pages (topics + paginated projects)
for (const d of domains) {
  const items = byDomain.get(d.slug);
  paginate(items, `domains/${d.slug}/`, (slice, pager, page, pages) => layout({
    title: d.title + (page > 1 ? ` (page ${page})` : ''), description: d.blurb, path: `domains/${d.slug}/`, current: 'domains/', body: `<div class="wrap">
<p class="breadcrumb"><a href="${url('')}">Home</a> › <a href="${url('domains/')}">Domains</a> › ${esc(d.title)}</p>
<h1>${esc(d.title)}</h1><p class="lede muted">${esc(d.blurb)}</p>
<section aria-labelledby="topics-h"><h2 id="topics-h">Topics</h2>
<ul class="grid">${d.topics.map(t => `<li class="card"><a class="cover" href="${url(`topics/${t.slug}/`)}"><h3>${esc(t.title)}</h3></a><p class="blurb">${esc(t.blurb)}</p><div class="count">${byTopic.get(t.slug).length.toLocaleString()} projects</div></li>`).join('')}</ul></section>
<section aria-labelledby="projects-h"><h2 id="projects-h">Projects${pages > 1 ? ` <span class="muted">(${items.length.toLocaleString()})</span>` : ''}</h2>
${slice.length ? `<ul class="list">${slice.map(projectLi).join('')}</ul>${pager}` : `<div class="empty">No projects published in ${esc(d.title)} yet. They will appear here as they are released.</div>`}
</section></div>` }));
}

// Topic pages
for (const [slug, { topic, domain }] of topicIndex) {
  const items = byTopic.get(slug);
  paginate(items, `topics/${slug}/`, (slice, pager, page) => layout({
    title: topic.title + (page > 1 ? ` (page ${page})` : ''), description: topic.blurb, path: `topics/${slug}/`, current: 'domains/', body: `<div class="wrap">
<p class="breadcrumb"><a href="${url('')}">Home</a> › <a href="${url('domains/')}">Domains</a> › <a href="${url(`domains/${domain.slug}/`)}">${esc(domain.title)}</a> › ${esc(topic.title)}</p>
<h1>${esc(topic.title)}</h1><p class="lede muted">${esc(topic.blurb)}</p>
${slice.length ? `<ul class="list">${slice.map(projectLi).join('')}</ul>${pager}` : `<div class="empty">No projects published for ${esc(topic.title)} yet.</div>`}
</div>` }));
}

// Project pages
for (const p of projects) {
  const d = domains.find(x => x.slug === p.domain);
  const stores = p.stores || {};
  write(`projects/${p.id}/index.html`, layout({ title: p.title, description: p.blurb, path: `projects/${p.id}/`, body: `<div class="wrap wrap--narrow">
<p class="breadcrumb"><a href="${url('')}">Home</a> › ${d ? `<a href="${url(`domains/${d.slug}/`)}">${esc(d.title)}</a>` : ''}${(p.topics || []).map(t => topicIndex.has(t) ? ` › <a href="${url(`topics/${t}/`)}">${esc(topicIndex.get(t).topic.title)}</a>` : '').join('')}</p>
<h1>${esc(p.title)}</h1><p class="lede">${esc(p.blurb)}</p>
<p><span class="badge${p.status === 'live' ? '' : ' badge--coming'}">${esc(p.status || 'coming')}</span>${p.app ? ` <span class="muted">in ${esc(p.app.name)}</span>` : ''}</p>
${(p.images || []).length ? `<div class="project-media">${p.images.map(im => `<figure><img src="${esc(im.src.startsWith('http') ? im.src : url(im.src))}" alt="${esc(im.alt || '')}" loading="lazy">${im.credit ? `<figcaption>${esc(im.credit)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}
<div class="actions">${p.play ? `<a class="btn" href="${esc(p.play)}">Play in the browser</a>` : ''}${stores.appStore ? `<a class="btn btn--ghost" href="${esc(stores.appStore)}">App Store</a>` : ''}${stores.googlePlay ? `<a class="btn btn--ghost" href="${esc(stores.googlePlay)}">Google Play</a>` : ''}</div>
${p.body ? `<div>${p.body}</div>` : ''}
<p class="muted">Updated ${esc(p.updated || now)}</p>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: p.title, description: p.blurb, applicationCategory: 'GameApplication', operatingSystem: 'iOS, Android, Web', url: site.url.replace(/\/$/, '') + '/' + `projects/${p.id}/` })}</script>
</div>` }));
}

// Search page
write('search/index.html', layout({ title: 'Search', path: 'search/', current: 'search/', body: `<div class="wrap wrap--narrow"><h1>Search</h1><p class="muted">Projects, topics and domains. Results load as you type.</p>${searchForm(true)}</div>` }));

// About
write('about/index.html', layout({ title: 'About', path: 'about/', current: 'about/', body: `<div class="wrap wrap--narrow">
<h1>About ${esc(site.name)}</h1>
<p>${esc(site.name)} is a growing family of games and apps about our planet: its land, water, sky, life, people and history, and how to fly over it.</p>
<p>Every project is built to work offline after you install it, to use very little data, and to be gentle on the eyes with warm colours, large type, a dark mode and adjustable text size. Facts are sourced and every image is credited.</p>
<p>This site lists every project. Each page links to the app that carries it and, where available, lets you play in the browser.</p>
</div>` }));

// 404
write('404.html', layout({ title: 'Not found', path: '404.html', body: `<div class="wrap wrap--narrow"><h1>Page not found</h1><p>Try a search instead.</p>${searchForm()}</div>` }));

// ---------- Search index ----------
const docs = [];
const addDoc = (t, b, u, k, s, extra = '') => docs.push({ id: docs.length, t, b, u, k, s, text: [t, b, k, extra].join(' ') });
for (const d of domains) addDoc(d.title, d.blurb, `domains/${d.slug}/`, 'Domain', '');
for (const [slug, { topic, domain }] of topicIndex) addDoc(topic.title, topic.blurb, `topics/${slug}/`, `Topic · ${domain.title}`, '');
for (const p of projects) addDoc(p.title, p.blurb, `projects/${p.id}/`, `Project · ${(domains.find(x => x.slug === p.domain) || {}).title || ''}`, p.status || 'coming', [...(p.tags || []), ...(p.regions || []), ...(p.topics || [])].join(' '));
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s-]/g, ' ');
const shards = new Map();
for (const d of docs) {
  const toks = new Set(norm(d.text).split(/[\s-]+/).filter(t => t.length >= 2));
  for (const t of toks) { const s = t.slice(0, 2); if (!shards.has(s)) shards.set(s, new Map()); const m = shards.get(s); if (!m.has(t)) m.set(t, []); m.get(t).push(d.id); }
}
for (const [s, m] of shards) write(`search/t/${s}.json`, JSON.stringify(Object.fromEntries(m)));
for (let i = 0; i * DOCS_PER_CHUNK < docs.length; i++) write(`search/d/${i}.json`, JSON.stringify(docs.slice(i * DOCS_PER_CHUNK, (i + 1) * DOCS_PER_CHUNK).map(({ text, ...d }) => d)));
write('search/manifest.json', JSON.stringify({ docsPerChunk: DOCS_PER_CHUNK, chunks: Math.ceil(docs.length / DOCS_PER_CHUNK), docs: docs.length, shards: [...shards.keys()].sort(), built: now }));

// ---------- Sitemaps, robots, assets ----------
const urls = ['', 'domains/', 'search/', 'about/', ...domains.map(d => `domains/${d.slug}/`), ...[...topicIndex.keys()].map(s => `topics/${s}/`), ...projects.map(p => `projects/${p.id}/`)];
const SM = 45000; const smFiles = [];
for (let i = 0; i * SM < urls.length; i++) {
  const name = urls.length > SM ? `sitemap-${i + 1}.xml` : 'sitemap.xml'; smFiles.push(name);
  write(name, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.slice(i * SM, (i + 1) * SM).map(u => `<url><loc>${esc(site.url.replace(/\/$/, '') + '/' + u)}</loc><lastmod>${now}</lastmod></url>`).join('\n')}\n</urlset>\n`);
}
if (urls.length > SM) write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${smFiles.map(f => `<sitemap><loc>${site.url.replace(/\/$/, '')}/${f}</loc></sitemap>`).join('\n')}\n</sitemapindex>\n`);
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${site.url.replace(/\/$/, '')}/sitemap.xml\n`);
write('.nojekyll', '');
mkdirSync(join(OUT, 'assets'), { recursive: true });
cpSync(join(ROOT, 'src/site.css'), join(OUT, 'assets/site.css'));
cpSync(join(ROOT, 'src/site.js'), join(OUT, 'assets/site.js'));
cpSync(join(ROOT, 'src/fonts'), join(OUT, 'assets/fonts'), { recursive: true });
cpSync(join(ROOT, 'src/globe.js'), join(OUT, 'assets/globe.js'));
cpSync(join(ROOT, 'content/mark-land.json'), join(OUT, 'assets/mark-land.json'));
mkdirSync(join(OUT, 'assets/vendor'), { recursive: true }); mkdirSync(join(OUT, 'assets/data'), { recursive: true });
for (const f of ['d3-array.min.js', 'd3-geo.min.js', 'topojson-client.min.js', 'LICENSE']) cpSync(join(ROOT, 'src/vendor', f), join(OUT, 'assets/vendor', f));
for (const f of ['countries-110m.json', 'countries-50m.json']) cpSync(join(ROOT, 'src/vendor', f), join(OUT, 'assets/data', f));
writeFileSync(join(OUT, 'assets/places.json'), JSON.stringify(placesOut));
writeFileSync(join(OUT, 'assets/icon.svg'), markFile);
writeFileSync(join(OUT, 'assets/mark.svg'), markFile);
if (existsSync(join(ROOT, 'data/images'))) cpSync(join(ROOT, 'data/images'), join(OUT, 'images'), { recursive: true });

console.log(`Built ${urls.length} pages, ${docs.length} search docs in ${shards.size} shards -> _site/`);
