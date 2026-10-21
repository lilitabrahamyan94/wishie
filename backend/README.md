# Product lookup backend

A small Cloudflare Worker. The culttt page sends it a product link and gets back the
product's name, photos, price and stock, read from the data shops publish for search engines.

    GET /product?url=https://shop.example.com/some-product
    -> { "ok": true, "product": { "name", "shop", "price", "currency", "availability", "images": [...] } }
    -> { "ok": false, "error": "blocked" | "no_product" | "not_found" | "timeout" | "fetch_failed" | "bad_url" }

It also keeps price drop alerts. Each alert has a random id that the page makes and keeps in
the browser; anyone with the id can read or change that alert, and nobody else can.

    PUT    /alerts/<id>   { "url", "target", "currency" }   -> { "ok": true, "alert": {...} }
    DELETE /alerts/<id>                                      -> { "ok": true }
    GET    /alerts?ids=<id>,<id>                             -> { "ok": true, "alerts": { "<id>": {...} } }

    alert = { "target", "currency", "lastPrice", "lastCheckedAt", "hitAt" }

Every 6 hours a cron trigger re-checks up to 40 alerts, starting with the ones checked
longest ago, and sets `hitAt` the first time the price is at or below the target.
Changing an alert's target clears `hitAt`.

## Alert storage

Alerts are stored in the Workers KV namespace `ALERTS`, bound in `wrangler.toml`. If the
binding is missing, the alert routes answer `"alerts_unavailable"` and the page says the
alert wasn't saved.

To test the schedule locally: `npx wrangler dev --test-scheduled`, then open
`http://localhost:8787/__scheduled`.

## Deploy

The Worker is connected to this repository in Cloudflare (Workers & Pages), so every push to
`main` publishes it automatically. Its settings are in `wrangler.toml` at the repository root.

To publish by hand instead (needs Node.js and a Cloudflare account), run `npx wrangler deploy`
from the repository root.

Put the Worker's `workers.dev` address in `index.html`:

    var API_URL = "https://wishlist.lil-abr94.workers.dev";

While `API_URL` is empty the page works as before and adds links without details.

## Limits

- Some shops refuse requests from servers. Calvin Klein and COS both did in testing; Gap worked.
  For those the page still adds the link, without photos or price.
- Only the websites listed in `ALLOWED_ORIGINS` in `worker.js` may call the backend from a browser.
- It looks up details once, when a link is added, and does not store the list. Only products
  with a price alert are re-checked.
- Alerts are only shown in the page's Notifications, the next time it's opened. Email or push
  needs accounts, which aren't connected yet.
- Shops that block lookups never trigger an alert, since their price can't be read.
- With more than 40 alerts × 4 runs a day, each alert is checked less often than every 6 hours.
