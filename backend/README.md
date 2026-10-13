# Product lookup backend

A small Cloudflare Worker. The wishie page sends it a product link and gets back the
product's name, photos, price and stock, read from the data shops publish for search engines.

    GET /product?url=https://shop.example.com/some-product
    -> { "ok": true, "product": { "name", "shop", "price", "currency", "availability", "images": [...] } }
    -> { "ok": false, "error": "blocked" | "no_product" | "not_found" | "timeout" | "fetch_failed" | "bad_url" }

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
- It looks up details once, when a link is added. It does not store the list or re-check prices.
