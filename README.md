# Earth site

Public catalog and marketing site for Earth: games and apps about our planet. Live at https://bpupadhyaya.github.io/earth-site/

- `content/` — site text, domains and topics (edited by the publisher job).
- `data/catalog/` — project catalog exported by the Earth factory; never hand-edited.
- `src/` — stylesheet and the client-side search.
- `build.mjs` — dependency-free static builder; writes `_site/` (pages, paginated lists, sharded search index, sitemap).
- `.github/workflows/pages.yml` — builds and deploys to GitHub Pages on every push to `main`.

Local preview: `npm run serve` then open http://localhost:8787/earth-site/ (the site is built for the `/earth-site/` base path).
