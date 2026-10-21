#!/usr/bin/env node
// Flip one store of an app's module card from "In review" to live once that store listing is public. Each store is independent.
//   node tools/flip-app-live.mjs <app-id> play  https://play.google.com/store/apps/details?id=<package>
//   node tools/flip-app-live.mjs <app-id> apple https://apps.apple.com/app/id<digits>
// (the older form `node tools/flip-app-live.mjs <app-id> <google-play-url>` still means play)
// Edits content/apps.json only (stores.<store> = { state: "live", url }); the other store is left as it is. Then run `node build.mjs` and push.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
let [id, store, link] = process.argv.slice(2);
if (id && store && /^https:\/\//.test(store) && !link) { link = store; store = /apps\.apple\.com/.test(link) ? 'apple' : 'play'; }
const KEY = { play: 'googlePlay', apple: 'appStore' }, URLS = { play: /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/, apple: /^https:\/\/apps\.apple\.com\/(?:[a-z]{2}\/)?(?:[\w-]+\/)?app\/(?:[^/\s]+\/)?id\d+/ };
if (!id || !KEY[store] || !URLS[store].test(link || '')) {
  console.error('usage: node tools/flip-app-live.mjs <app-id> play  https://play.google.com/store/apps/details?id=<package>\n       node tools/flip-app-live.mjs <app-id> apple https://apps.apple.com/app/id<digits>');
  process.exit(1);
}
const f = join(dirname(fileURLToPath(import.meta.url)), '../content/apps.json');
const doc = JSON.parse(readFileSync(f, 'utf8'));
const app = doc.apps.find(a => a.id === id);
if (!app) { console.error(`no app "${id}" in content/apps.json`); process.exit(1); }
app.stores = { ...(app.stores || {}), [KEY[store]]: { state: 'live', url: link } };
writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
console.log(`${id}: ${KEY[store]} live ${link}; other stores unchanged: ${Object.entries(app.stores).filter(([k]) => k !== KEY[store]).map(([k, v]) => `${k}=${v.state}`).join(', ') || 'none'}`);
