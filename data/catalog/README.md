# Catalog data

`projects.json` is exported by the Earth factory. Do not hand-edit.

Each entry:

```json
{
  "id": "fly-bird-pokhara-dawn",
  "title": "Dawn glide over Pokhara",
  "blurb": "Soar from Sarangkot and land on the lakeshore.",
  "domain": "fly",
  "topics": ["bird-flight", "gliding"],
  "regions": ["asia", "nepal"],
  "tags": ["bird", "landing", "himalaya"],
  "app": { "slug": "earth-fly", "name": "Earth: Fly" },
  "play": "https://.../play/fly-bird-pokhara-dawn/",
  "stores": { "appStore": "", "googlePlay": "" },
  "images": [{ "src": "images/fly-bird-pokhara-dawn-1.webp", "alt": "...", "credit": "..." }],
  "status": "live",
  "updated": "2026-10-11"
}
```

`status`: `live` (in an app), `web` (playable on the web only), `coming`.
The build splits this into catalog shards and a search index; nothing in the site reads the whole file at once.
