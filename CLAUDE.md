# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

wishie (the brand went wishie → cultt → culttt and back to wishie) is a single-page wishlist: users paste product links from any shop and see photo, price and stock in one list, plus coupons, notifications and price drop alerts.

There is no build step, package.json, linter or test suite. Two deployables:

- **`index.html`**: the whole frontend (HTML, CSS and vanilla JS in one file, no framework, no dependencies besides Google Fonts). Served by GitHub Pages at https://lilitabrahamyan94.github.io/wishie/ on every push to `main`.
- **`backend/worker.js`**: a Cloudflare Worker (`wishlist.lil-abr94.workers.dev`), config in `wrangler.toml` at the repo root. Cloudflare deploys it automatically on every push to `main`. A broken `wrangler.toml` therefore breaks production on push.

## Commands

```bash
node --check backend/worker.js                 # syntax check the worker
npx wrangler dev --test-scheduled              # run the worker locally (http://localhost:8787)
curl http://localhost:8787/__scheduled         # trigger the cron handler locally
npx wrangler deploy                            # manual deploy (normally done by pushing to main)
python3 -m http.server 8000                    # preview the page at http://localhost:8000
```

Serve the page on port 8000: `ALLOWED_ORIGINS` in `worker.js` only accepts `https://lilitabrahamyan94.github.io` and `localhost`/`127.0.0.1:8000`, so other origins can't call the worker. The page calls the worker at `API_URL` in `index.html` (the live `workers.dev` address); to test against `wrangler dev`, point it at `http://localhost:8787` temporarily and don't commit that. With `API_URL` empty the page saves links without details and skips alerts.

## Frontend architecture (`index.html`)

- **Views** are sections with ids `view-<name>`, switched by `location.hash` in `show()`; the list is the `VIEWS` array. Header links have ids `nav-<name>`.
- **Colors**: CSS custom properties on `:root`, light only (dark mode was removed). `--brand` (#CDFD02) is the logo symbol and hero button color.
- **Header** (`nav.top`): a sticky, transparent bar 16px from the top and 24px from each side (`pointer-events:none`) holding two separate 48px frosted-glass pills (`backdrop-filter`) that hug their contents: `.tl` on the left (logo and menu) and `.profile` on the right ("Get the app" button, profile icon and notifications). The "Get the app" popover (`#app-pop`, desktop only, hidden at 760px and below) holds an inline SVG QR code of the site URL and placeholder store buttons, since there are no apps yet; regenerate the QR path if the URL changes. At 760px and below the four main links (`#main-menu`) become a dropdown opened by the burger button `#menu-btn` at the end of the right pill. `placeMenu()` moves `#main-menu` into `.profile` on mobile and back into `.tl` on desktop, because each pill's `backdrop-filter` makes it the dropdown's containing block. The home view has `margin-top:-64px` so the 400px hero photo starts under the header. The hero's `#hero-add` form passes its link to the wishlist's `#add` form and switches to `#wishlist`.
- **Home "Newly added"**: `renderRecent()` (called from `render()`) shows the 8 newest items by `addedAt` in `#recent-grid`, laid out as a single row of eight that scrolls sideways when the screen is too narrow. Cards are built with `productCard(i, preview, opt)`: previews have no remove button, `opt.bare` (all home page cards) drops the stock badge, checked date and price alert, and `opt.slim` (Newly added) also drops the shop link, note and price and sets the name to 12px. Photo galleries show dots for the current photo.
- **Inspo feed** (`#inspo`): `renderInspo()` (called from `render()`) shows the sample `INSPO` catalog, ranked by `inspoList()` against `items` (category +3, shop +2, shared color word +1, price near the list's range +1) with a "Because you saved …" reason shown in a dark tooltip (`.tip`) on hover or focus of the info icon (`.info`) on the photo's top-left corner. `saveInspo()` copies a product into the wishlist (local or `store`) with `savedFrom` set to its `INSPO` id, which is how saved ones are hidden from the feed (several samples share a shop home page as `url`). Inspo cards have no price alert button (`i.inspo`). `INSPO_HOSTS` lists where the feed renders: the whole feed on `#inspo` and the top 8 in `#home-inspo-grid` at the bottom of the home page (4 per row, 2 at 760px and below). The outline Save button shows on card hover on devices that hover and always on touch.
- **Sizing**: every spacing, size, radius and line height is on the 4/8px grid (multiples of 4, 8 between components; touch targets 48px), using the `--space-*` tokens on `:root` (`--space-1` = 8px, `--space-3` = 24px). The project skill `.claude/skills/sizing-4-8-grid` has the full rules.
- **Breakpoint** is 760px (`max-width:760px` / `min-width:761px`). Controls that are hover-revealed on desktop use `@media (hover:hover){ opacity:0 }` plus `.card:hover`/`:focus-visible`, so they stay visible on touch (see `.rm` and `.alertbtn`).
- **Data source**: `items` comes from one of two places. If `window.claude.use("db")` exists (when hosted as a Claude artifact), it reads the shared `items` collection via `onSnapshot`, and writes use `store.doc(...)`/`store.collection(...)`. Otherwise `goLocal()` merges the hard-coded `SEED` array with links saved in localStorage. Code that changes items must handle both (`local` flag vs `store`).
- **localStorage keys**: `wishlist.added` (user-added items), `wishlist.removed` (ids hidden from SEED), `wishlist.alerts` (`{itemId: {id, target, seenHit}}`), `wishie-user` (there are no real accounts: a stored user just marks the visitor as signed in for the profile menu). Every access is wrapped in try/catch.
- **Rendering**: `render()` rebuilds filters, the product grid and (via `renderNotifs()`) the notification drawer from `items`. DOM is built with the `el(tag, cls, text)` helper and `$()` = `getElementById`; untrusted strings go through `textContent`, never `innerHTML`, and URLs through `safeUrl()`.
- **Dialogs** (notification drawer, price alert dialog) follow one pattern: a scrim + panel with `hidden`, a `body.<name>-open` class to animate, Escape to close, a Tab focus trap, and focus returned to the opener.
- **Sample content** (coupons, ads, `NOTIFS`, `SEED`) is placeholder data for testing, labelled as such in the UI.
- Code style: ES5-style `var`/`function` inside one IIFE, compact one-line CSS rules, short names. Match it.

## Backend architecture (`backend/worker.js`)

- `GET /product?url=` fetches the shop page and extracts product data from JSON-LD, falling back to Open Graph meta tags (`loadPage()` → `extract()`). Many shops (Calvin Klein and COS in testing) block server requests, so lookups often return `blocked` and the page saves the link without details.
- **Price alerts**: `PUT`/`DELETE /alerts/<uuid>` and `GET /alerts?ids=` store alerts in the `ALERTS` KV namespace under `alert:<uuid>`. The UUID is generated in the browser and acts as the only credential (there are no user accounts yet). The `scheduled()` cron (every 6 hours, in `wrangler.toml`) re-checks up to 40 alerts per run, oldest first, reusing `loadPage()`/`extract()`, and sets `hitAt` the first time price ≤ target. The page polls `GET /alerts` on load and shows hits in the notification drawer; there is no email or push delivery. Without the `ALERTS` binding the alert routes answer `alerts_unavailable`. `backend/README.md` documents the request/response shapes and error codes; keep it in sync when the API changes.
- `safeUrl()` restricts outgoing fetches to public https hosts (no IPs, ports or local names). Keep using it for any URL that comes from a client.

## Content pages

Terms, Privacy and FAQ are written inline in `index.html`. When a feature changes what data is sent to the backend or stored (as alerts did), update the Privacy section and the relevant FAQ answer too.
