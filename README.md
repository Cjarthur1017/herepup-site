# herepup.health

Static website for HerePup, served by GitHub Pages from the main branch; `CNAME` points it at herepup.health.

- Site pages: home, `how-it-works/`, `about/` (with the FAQ), `insurers/`, `privacy/`, `terms/`, `404.html`.
- The browser app lives in `app/` and is edited directly.
- `_tools/build_site.py` writes the site pages with one shared header, footer and search-engine head (titles, descriptions, Open Graph, structured data), plus `sitemap.xml` and `robots.txt`. Edit page text there, then run `python3 _tools/build_site.py .` from the repo root. Privacy, terms and insurers keep their own content: edit inside their `<main>`, then rebuild. Jekyll skips `_tools/`, so it isn't published.
- Keep existing addresses (`/privacy/`, `/terms/`, `/insurers/`): they are linked from insurer developer registrations.
