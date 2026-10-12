# Working on the Earth site (for any agent)

Live: https://bpupadhyaya.github.io/earth-site/ (always reference this host). Deploys automatically from `main` via `.github/workflows/pages.yml` (GitHub Pages, Actions source; free on this public repo).

## Ownership (2026-10-11)
- **Style and format agent**: owns the look and feel: `src/site.css`, `src/site.js` (UI parts), the HTML produced by `build.mjs`, `content/site.json` copy, images and brand assets. Free to redesign.
- **Sync agent (Earth factory)**: owns `data/catalog/**` (exported from the private Earth repo), the search-index and sitemap generation in `build.mjs`, and keeping the site in step with the mobile apps (project pages, store links, play-in-browser links). Do not hand-edit `data/`.
- Keep both roles working in the same repo without stepping on each other: style changes should not alter the data contracts below.

## Contracts that must stay stable
1. **Base path** `/earth-site/` (`content/site.json` → `basePath`) and the `data-base` attribute on `<html>`, which `site.js` uses to load search shards.
2. **Content shapes**: `content/domains.json` (domain → topics, each with `slug`, `title`, `blurb`) and `data/catalog/projects.json` (schema in `data/catalog/README.md`). Add fields freely; never rename or remove.
3. **URL scheme**: `domains/<slug>/`, `topics/<slug>/`, `projects/<id>/`, `search/`, `about/`; pagination at `.../page/<n>/`. The apps deep-link to `projects/<id>/`.
4. **Search index layout** under `search/` (`manifest.json`, `t/<ab>.json`, `d/<n>.json`) and the `search-form` / `search-results` / `search-status` element ids.
5. **Scale**: everything stays static and sharded; no page may load the whole catalog; no build-time dependency on the project count beyond linear time. Target: 100,000 project pages build in minutes on the free runner.
6. **Build**: `node build.mjs` with no npm dependencies (keeps Actions fast and the repo auditable). If a dependency becomes necessary, keep the build under one minute and document why.

## Design constraints (owner)
- **Easy on the eyes**: warm, low-glare light palette (no pure white or pure black), a warm dark mode, large legible type (≥ 18px base, ~1.6 line height, ≤ 70ch measure), visible focus states, reduced-motion respected, a text-size control, WCAG AA contrast or better. Any redesign must keep these properties even if every colour and font changes.
- **Public-safe**: this repo is public. No business reasoning, no strategy, no internal plans, no store-policy discussion, no unreleased app names beyond what the catalog publishes, no secrets. Facts shown about Earth must be sourced in the catalog data; images must be credited and freely licensed.
- **Honest states**: empty topics say so; nothing is presented as live that is not.
- Mobile first (works at 360px wide), fast on slow connections (no heavy frameworks, no web fonts required for legibility, images lazy-loaded).

## Local preview
`node build.mjs`, then serve a folder that maps `/earth-site/` to `_site/` (for example a scratch dir with a symlink named `earth-site` → `_site`, `python3 -m http.server 8787`), open http://localhost:8787/earth-site/.

## Handoff notes
- 2026-10-11: first version by the architecture session (home, 10 domains, 72 topics, search, about). Catalog empty until the factory exports data. Known gaps for the style agent: real brand mark and hero artwork, project-page layout once real projects exist, print styles, a favicon set beyond the SVG, optional self-hosted legible font.
