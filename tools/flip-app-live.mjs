#!/usr/bin/env node
// Flip an app's module card from "In review" to "Available on Google Play" once the store listing is public.
//   node tools/flip-app-live.mjs <app-id> <google-play-url>
// Edits content/apps.json only (status "live" + stores.googlePlay); then run `node build.mjs` and push.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const [id, link] = process.argv.slice(2);
if (!id || !/^https:\/\/play\.google\.com\/store\/apps\/details\?id=[\w.]+/.test(link || '')) { console.error('usage: node tools/flip-app-live.mjs <app-id> https://play.google.com/store/apps/details?id=<package>'); process.exit(1); }
const f = join(dirname(fileURLToPath(import.meta.url)), '../content/apps.json');
const doc = JSON.parse(readFileSync(f, 'utf8'));
const app = doc.apps.find(a => a.id === id);
if (!app) { console.error(`no app "${id}" in content/apps.json`); process.exit(1); }
app.status = 'live'; app.stores = { ...(app.stores || {}), googlePlay: link };
writeFileSync(f, JSON.stringify(doc, null, 2) + '\n');
console.log(`${id}: status live, Google Play ${link}`);
