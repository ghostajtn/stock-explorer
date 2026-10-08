# Putting Stock Explorer on GitHub Pages

The site is static: a GitHub Action (`.github/workflows/pages.yml`) runs `build-data.mjs`, which
snapshots Yahoo Finance data for the top 50 + watchlist into `public/data/`, then publishes `public/`.
It rebuilds every 30 min during US market hours (Mon-Fri) and on every push.

## Steps
1. Install Git (https://git-scm.com/download/win) or GitHub Desktop (https://desktop.github.com).
2. Create a repository on github.com (e.g. `stock-explorer`).
3. Push this folder to it (branch must be `main`):
   ```
   git init -b main
   git add .
   git commit -m "Stock Explorer"
   git remote add origin https://github.com/<you>/stock-explorer.git
   git push -u origin main
   ```
4. Repo → Settings → Pages → Source: **GitHub Actions**.
5. Repo → Actions → "Build data and deploy to GitHub Pages" → Run workflow (or just push).
6. Your site: `https://<you>.github.io/stock-explorer/`

## Notes
- **Private repos:** GitHub Pages from a private repo needs a paid plan (Pro/Team). On a free account the
  repo must be public. The repo contains no secrets (only public market data code), so public is safe.
- **Snapshot limits:** only the top 50 + `WATCHLIST` (see `server.js`) exist on the site; searching other
  tickers works only on the local server (`start.bat`).
- **Add a ticker to the site:** add it to `WATCHLIST` in `server.js`, push, and the next build includes it.
- Data comes from unofficial Yahoo endpoints; if a scheduled build fails, the last good site stays up.
