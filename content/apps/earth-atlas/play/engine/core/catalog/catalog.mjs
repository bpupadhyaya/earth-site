// @ts-check
// Local catalog reader + search over sharded catalog files (U-0041). Platform-free: no DOM, no network, no file system.
// The shell hands in a shard loader; this module never knows where shards come from (bundle, cache, on-demand pack).
//
// Catalog on disk (written by factory/catalog/build.mjs): index.json { version, shards:[{domain, shard, n, hash}] } and one file
// per shard: an array of entries { id, t:title, tp:template, d:domain, g:tags[], r:region[], df:difficulty, e:entitlement,
// h:contentHash, kb:size, tv?:requiredTemplateVersion (integer, default 1), gm?:game that plays it, gl?:[games it teaches] } (games: app.json
// `games`, factory/publish/build.mjs gameMatcher).
//
// CONTRACT
//   const cat = createCatalog({ index, loadShard, maxCachedEntries = 25000 });
//   await cat.list({ domain?, tag?, region?, template?, game?, learn?, compat?, limit = 50, cursor? }) -> { items, next }   // next: string | null
//     game: entries played in that game (gm); learn: entries that game teaches (gl). search takes the same filters.
//   await cat.search(query, { domain?, tag?, region?, template?, compat?, limit = 20 })   -> { items }        // items carry .score
//   cat.stats() -> { cachedShards, cachedEntries, shardLoads }
//   compat: { [templateId]: highestSupportedVersion } hides entries whose template is unknown to this app or too new.
// Rules: queries load ONE shard at a time (sequential awaits); shard indexes are built lazily and kept in a cache bounded by
// maxCachedEntries (least recently used shards are evicted), so memory is O(cache bound), not O(catalog).
// Search: all query words must match; a word matches exactly (3), by prefix (2, last word only: type-ahead) or within one typo
// (1, words of 4+ letters); a title hit counts double a tag/region hit. Order: score desc, title, id (deterministic).
// Budget: warm search over 10,000 entries well under 50 ms (measured in catalog.test.mjs).

/** @typedef {{id:string,t:string,tp:string,d:string,g?:string[],r?:string[],df?:number,e?:string,h?:string,kb?:number,tv?:number,gm?:string,gl?:string[]}} Entry */

/** Lower-case, strip diacritics, split on non letters/digits. @param {string} s @returns {string[]} */
export function tokenize(s) {
  return String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** True when a and b differ by at most one substitution, insertion, deletion or adjacent transposition. */
export function withinOneEdit(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i);
}

/** @param {any} entry @param {any} f @returns {boolean} */
function matches(entry, f) {
  if (f.template && entry.tp !== f.template) return false;
  if (f.game && entry.gm !== f.game) return false;
  if (f.learn && !(entry.gl || []).includes(f.learn)) return false;
  if (f.tag && !(entry.g || []).includes(f.tag)) return false;
  if (f.region && !(entry.r || []).includes(f.region)) return false;
  if (f.compat) { const max = f.compat[entry.tp]; if (max === undefined || (entry.tv ?? 1) > max) return false; }
  return true;
}

/** @param {{index:{shards:{domain:string,shard:string,n:number}[]}, loadShard:(domain:string, shard:string)=>Promise<Entry[]>, maxCachedEntries?:number}} opts */
export function createCatalog(opts) {
  const shards = [...opts.index.shards].sort((a, b) => (a.domain + '/' + a.shard < b.domain + '/' + b.shard ? -1 : 1));
  const cap = opts.maxCachedEntries ?? 25000;
  /** @type {Map<string, {entries:Entry[], vocab:string[], post:Map<string,number[]>}>} */ const cache = new Map();
  let cachedEntries = 0, loads = 0;

  const key = s => s.domain + '/' + s.shard;
  async function entriesOf(s) {
    const c = cache.get(key(s)); if (c) return c.entries;
    loads++; return opts.loadShard(s.domain, s.shard);
  }

  /** Build (or reuse) the inverted index of one shard; evict least recently used shards beyond the entry cap. */
  async function indexOf(s) {
    const k = key(s), hit = cache.get(k);
    if (hit) { cache.delete(k); cache.set(k, hit); return hit; }
    loads++;
    const entries = await opts.loadShard(s.domain, s.shard);
    const post = new Map();
    entries.forEach((e, i) => {
      const add = (tok, w) => { let l = post.get(tok); if (!l) post.set(tok, l = []); l.push(i * 2 + w); };
      for (const t of new Set(tokenize(e.t))) add(t, 1);
      for (const t of new Set([...(e.g || []), ...(e.r || [])].flatMap(tokenize))) add(t, 0);
    });
    const ix = { entries, vocab: [...post.keys()].sort(), post };
    cache.set(k, ix); cachedEntries += entries.length;
    while (cachedEntries > cap && cache.size > 1) { const [ok, ov] = cache.entries().next().value; if (ok === k) break; cache.delete(ok); cachedEntries -= ov.entries.length; }
    return ix;
  }

  const inDomain = (s, f) => !f.domain || s.domain === f.domain;

  /** first vocab index with vocab[i] >= p */
  function lowerBound(vocab, p) { let lo = 0, hi = vocab.length; while (lo < hi) { const m = (lo + hi) >> 1; if (vocab[m] < p) lo = m + 1; else hi = m; } return lo; }

  return {
    /** @param {{domain?:string,tag?:string,region?:string,template?:string,game?:string,learn?:string,compat?:Record<string,number>,limit?:number,cursor?:string|null}} [f] */
    async list(f = {}) {
      const limit = Math.max(1, Math.min(f.limit ?? 50, 500));
      let [si, skip] = f.cursor ? f.cursor.split(':').map(Number) : [0, 0];
      const items = [];
      for (; si < shards.length; si++, skip = 0) {
        const s = shards[si]; if (!inDomain(s, f)) continue;
        const entries = await entriesOf(s);
        let seen = 0;
        for (let i = 0; i < entries.length; i++) {
          if (!matches(entries[i], f)) continue;
          if (seen++ < skip) continue;
          if (items.length === limit) return { items, next: si + ':' + (seen - 1) };
          items.push(entries[i]);
        }
      }
      return { items, next: null };
    },

    /** @param {string} query @param {{domain?:string,tag?:string,region?:string,template?:string,game?:string,learn?:string,compat?:Record<string,number>,limit?:number}} [f] */
    async search(query, f = {}) {
      const words = tokenize(query); const limit = Math.max(1, Math.min(f.limit ?? 20, 200));
      if (!words.length) return { items: [] };
      /** @type {{e:Entry,score:number}[]} */ let best = [];
      for (const s of shards) {
        if (!inDomain(s, f)) continue;
        const ix = await indexOf(s);
        /** @type {Map<number,number>|null} */ let acc = null;
        for (let w = 0; w < words.length; w++) {
          const q = words[w], last = w === words.length - 1, hits = new Map();
          const take = (tok, base) => { for (const p of ix.post.get(tok)) { const i = p >> 1, v = base * (p & 1 ? 2 : 1); if ((hits.get(i) ?? 0) < v) hits.set(i, v); } };
          if (ix.post.has(q)) take(q, 3);
          if (last) for (let j = lowerBound(ix.vocab, q); j < ix.vocab.length && ix.vocab[j].startsWith(q); j++) if (ix.vocab[j] !== q) take(ix.vocab[j], 2);
          if (q.length >= 4) for (const tok of ix.vocab) if (tok !== q && Math.abs(tok.length - q.length) <= 1 && withinOneEdit(q, tok)) take(tok, 1);
          if (acc === null) acc = hits;
          else { const next = new Map(); for (const [i, v] of acc) { const h = hits.get(i); if (h !== undefined) next.set(i, v + h); } acc = next; }
          if (!acc.size) break;
        }
        for (const [i, score] of acc || []) {
          const e = ix.entries[i]; if (!matches(e, f)) continue;
          best.push({ e, score });
        }
        if (best.length > limit * 4) best = trim(best, limit);
      }
      return { items: trim(best, limit).map(b => ({ ...b.e, score: b.score })) };
    },

    stats: () => ({ cachedShards: cache.size, cachedEntries, shardLoads: loads }),
  };
}

function trim(arr, n) {
  return arr.sort((a, b) => b.score - a.score || (a.e.t < b.e.t ? -1 : a.e.t > b.e.t ? 1 : 0) || (a.e.id < b.e.id ? -1 : 1)).slice(0, n);
}
