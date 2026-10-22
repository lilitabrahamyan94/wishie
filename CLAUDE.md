# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

culttt (repo name `wishie`; the brand was renamed wishie → cultt → culttt, and the old name survives in localStorage keys like `wishie-theme`) is a single-page wishlist: users paste product links from any shop and see photo, price and stock in one list, plus coupons, notifications and price drop alerts.

There is no build step, package.json, linter or test suite. Two deployables:

- **`index.html`**: the whole frontend (HTML, CSS and vanilla JS in one file, no framework, no dependencies besides Google Fonts). Served by GitHub Pages at https://lilitabrahamyan94.github.io/wishie/ on every push to `main`.
- **`backend/worker.js`**: a Cloudflare Worker (`wishlist.lil-abr94.workers.dev`), config in `wrangler.toml` at the repo root. Cloudflare deploys it automatically on every push to `main`. A broken `wrangler.toml` therefore breaks production on push.

## Commands

```bash
node --check backend/worker.js                 # syntax check the worker
npx wrangler dev --test-scheduled              # run the worker locally (http://localhost:8787)
curl http://localhost:8787/__scheduled         # trigger the cron handler locally
npx wrangler deploy                            # manual deploy (normally done by pushing to main)
```

To preview the page, serve the repo root over HTTP on port 8000. `ALLOWED_ORIGINS` in `worker.js` only accepts `https://lilitabrahamyan94.github.io` and `localhost`/`127.0.0.1:8000`, so other origins can't call the live worker.

## Frontend architecture (`index.html`)

- **Views** are sections with ids `view-<name>`, switched by `location.hash` in `show()`; the list is the `VIEWS` array. Header links have ids `nav-<name>`.
- **Theme**: CSS custom properties on `:root`, redefined for dark mode both under `@media (prefers-color-scheme:dark)` (guarded by `:root:not([data-theme="light"])`) and under `:root[data-theme="dark"]`. New colors need all three places. The tiny `<script>` in `<head>` applies the saved theme before paint.
- **Breakpoint** is 760px (`max-width:760px` / `min-width:761px`). Controls that are hover-revealed on desktop use `@media (hover:hover){ opacity:0 }` plus `.card:hover`/`:focus-visible`, so they stay visible on touch (see `.rm` and `.alertbtn`).
- **Data source**: `items` comes from one of two places. If `window.claude.use("db")` exists (when hosted as a Claude artifact), it reads the shared `items` collection via `onSnapshot`, and writes use `store.doc(...)`/`store.collection(...)`. Otherwise `goLocal()` merges the hard-coded `SEED` array with links saved in localStorage. Code that changes items must handle both (`local` flag vs `store`).
- **localStorage keys**: `wishlist.added` (user-added items), `wishlist.removed` (ids hidden from SEED), `wishlist.alerts` (`{itemId: {id, target, seenHit}}`), `wishie-theme`, `wishie-user`. Every access is wrapped in try/catch.
- **Rendering**: `render()` rebuilds filters, the product grid and (via `renderNotifs()`) the notification drawer from `items`. DOM is built with the `el(tag, cls, text)` helper and `$()` = `getElementById`; untrusted strings go through `textContent`, never `innerHTML`, and URLs through `safeUrl()`.
- **Dialogs** (notification drawer, price alert dialog) follow one pattern: a scrim + panel with `hidden`, a `body.<name>-open` class to animate, Escape to close, a Tab focus trap, and focus returned to the opener.
- **Sample content** (coupons, ads, `NOTIFS`, `SEED`) is placeholder data for testing, labelled as such in the UI.
- Code style: ES5-style `var`/`function` inside one IIFE, compact one-line CSS rules, short names. Match it.

## Backend architecture (`backend/worker.js`)

- `GET /product?url=` fetches the shop page and extracts product data from JSON-LD, falling back to Open Graph meta tags (`loadPage()` → `extract()`). Many shops (Calvin Klein and COS in testing) block server requests, so lookups often return `blocked` and the page saves the link without details.
- **Price alerts**: `PUT`/`DELETE /alerts/<uuid>` and `GET /alerts?ids=` store alerts in the `ALERTS` KV namespace under `alert:<uuid>`. The UUID is generated in the browser and acts as the only credential (there are no user accounts yet). The `scheduled()` cron (every 6 hours, in `wrangler.toml`) re-checks up to 40 alerts per run, oldest first, reusing `loadPage()`/`extract()`, and sets `hitAt` the first time price ≤ target. The page polls `GET /alerts` on load and shows hits in the notification drawer; there is no email or push delivery.
- `safeUrl()` restricts outgoing fetches to public https hosts (no IPs, ports or local names). Keep using it for any URL that comes from a client.

## Content pages

Terms, Privacy and FAQ are written inline in `index.html`. When a feature changes what data is sent to the backend or stored (as alerts did), update the Privacy section and the relevant FAQ answer too.
