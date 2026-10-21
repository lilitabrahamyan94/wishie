// culttt product lookup — Cloudflare Worker.
//
// GET /product?url=<https product page>
//   -> { ok: true, product: { url, shop, name, category, color, price, currency,
//                             availability, images: [{src, alt}], checkedAt } }
//   -> { ok: false, error: "bad_url" | "blocked" | "not_found" | "no_product"
//                          | "timeout" | "fetch_failed", status? }
//
// It opens the product page, reads the structured product data shops publish
// for search engines (JSON-LD, then Open Graph tags), and returns it as JSON.
//
// Price drop alerts (stored in the ALERTS KV namespace, keyed by a random UUID
// the browser makes, which only that browser knows):
//
// PUT    /alerts/<id>   body { url, target, currency }  -> { ok: true, alert }
// DELETE /alerts/<id>                                    -> { ok: true }
// GET    /alerts?ids=<id>,<id>,…  (up to 50)             -> { ok: true, alerts: { <id>: alert } }
//   alert = { target, currency, lastPrice, lastCheckedAt, hitAt }
//
// A cron trigger (wrangler.toml) re-checks the alerts whose price was checked
// longest ago and sets hitAt the first time the price is at or below target.

// Websites allowed to call this backend from a browser.
const ALLOWED_ORIGINS = [
  "https://lilitabrahamyan94.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

const MAX_BYTES = 4 * 1024 * 1024; // stop reading a page after 4 MB
const TIMEOUT_MS = 12000;
const MAX_IMAGES = 8;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const ALERT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_ALERT_BODY = 4096;
const MAX_IDS = 50;
const CHECKS_PER_RUN = 40;
const CHECK_CONCURRENCY = 5;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ ok: false, error: "origin_not_allowed" }, 403, cors);

    const here = new URL(request.url);
    if (here.pathname === "/alerts" || here.pathname.startsWith("/alerts/")) return handleAlerts(request, here, env, cors);
    if (here.pathname !== "/product") return json({ ok: false, error: "not_found" }, 404, cors);
    if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

    const target = safeUrl(here.searchParams.get("url"));
    if (!target) return json({ ok: false, error: "bad_url" }, 400, cors);

    const page = await loadPage(target);
    if (!page.ok) return json({ ok: false, error: page.error, status: page.status }, 200, cors);

    const product = extract(page.html, page.url);
    if (!product) return json({ ok: false, error: "no_product" }, 200, cors);

    return json({ ok: true, product }, 200, { ...cors, "Cache-Control": "public, max-age=900" });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(checkAlerts(env));
  },
};

// ---------- price alerts ----------

async function handleAlerts(request, here, env, cors) {
  if (!env || !env.ALERTS) return json({ ok: false, error: "alerts_unavailable" }, 503, cors);
  const noStore = { ...cors, "Cache-Control": "no-store" };

  if (here.pathname === "/alerts") {
    if (request.method !== "GET") return json({ ok: false, error: "method_not_allowed" }, 405, cors);
    const ids = [...new Set(String(here.searchParams.get("ids") || "").split(","))]
      .filter((id) => ALERT_ID.test(id)).slice(0, MAX_IDS);
    const found = await Promise.all(ids.map((id) => env.ALERTS.get("alert:" + id, "json")));
    const alerts = {};
    ids.forEach((id, n) => { if (found[n]) alerts[id] = publicAlert(found[n]); });
    return json({ ok: true, alerts }, 200, noStore);
  }

  const id = here.pathname.slice("/alerts/".length);
  if (!ALERT_ID.test(id)) return json({ ok: false, error: "bad_id" }, 400, cors);
  const key = "alert:" + id;

  if (request.method === "DELETE") {
    await env.ALERTS.delete(key);
    return json({ ok: true }, 200, noStore);
  }
  if (request.method !== "PUT") return json({ ok: false, error: "method_not_allowed" }, 405, cors);

  const raw = await request.text();
  if (raw.length > MAX_ALERT_BODY) return json({ ok: false, error: "too_large" }, 413, cors);
  let body;
  try { body = JSON.parse(raw); } catch (e) { return json({ ok: false, error: "bad_json" }, 400, cors); }
  const url = safeUrl(body && body.url);
  const target = Number(body && body.target);
  const currency = /^[A-Za-z]{3}$/.test(String((body && body.currency) || "")) ? body.currency.toUpperCase() : "USD";
  if (!url) return json({ ok: false, error: "bad_url" }, 400, cors);
  if (!Number.isFinite(target) || target <= 0 || target > 1e7) return json({ ok: false, error: "bad_target" }, 400, cors);

  const old = await env.ALERTS.get(key, "json");
  const same = old && old.url === url.href && old.target === target;
  const alert = {
    url: url.href,
    target,
    currency,
    createdAt: (old && old.createdAt) || new Date().toISOString(),
    lastPrice: old && old.url === url.href ? old.lastPrice : null,
    lastCheckedAt: old && old.url === url.href ? old.lastCheckedAt : null,
    hitAt: same ? old.hitAt : null,
  };
  await env.ALERTS.put(key, JSON.stringify(alert));
  return json({ ok: true, alert: publicAlert(alert) }, 200, noStore);
}

function publicAlert(a) {
  return {
    target: a.target,
    currency: a.currency,
    lastPrice: typeof a.lastPrice === "number" ? a.lastPrice : null,
    lastCheckedAt: a.lastCheckedAt || null,
    hitAt: a.hitAt || null,
  };
}

async function checkAlerts(env) {
  if (!env || !env.ALERTS) return;
  const keys = [];
  let cursor;
  do {
    const page = await env.ALERTS.list({ prefix: "alert:", cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);

  const loaded = (await Promise.all(keys.map(async (key) => ({ key, alert: await env.ALERTS.get(key, "json") }))))
    .filter((x) => x.alert && x.alert.url);
  loaded.sort((a, b) => String(a.alert.lastCheckedAt || "").localeCompare(String(b.alert.lastCheckedAt || "")));
  const queue = loaded.slice(0, CHECKS_PER_RUN);

  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try { await checkOne(env, job.key, job.alert); } catch (e) {}
    }
  };
  await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
}

async function checkOne(env, key, alert) {
  const now = new Date().toISOString();
  const target = safeUrl(alert.url);
  let product = null;
  if (target) {
    const page = await loadPage(target);
    if (page.ok) product = extract(page.html, page.url);
  }
  // The alert may have been edited or removed while the page loaded.
  const latest = await env.ALERTS.get(key, "json");
  if (!latest || latest.url !== alert.url || latest.target !== alert.target) return;
  latest.lastCheckedAt = now;
  if (product && typeof product.price === "number") {
    latest.lastPrice = product.price;
    if (product.currency) latest.currency = product.currency;
    if (!latest.hitAt && product.price <= latest.target) latest.hitAt = now;
  }
  await env.ALERTS.put(key, JSON.stringify(latest));
}

// ---------- request handling ----------

function corsHeaders(origin) {
  const h = {
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });
}

// Only public https web addresses: no IP addresses, ports, logins or local names.
function safeUrl(raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.port || u.username || u.password) return null;
  if (!host.includes(".") || host.includes(":") || /^[\d.]+$/.test(host)) return null;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|test|invalid)$/.test(host)) return null;
  u.hash = "";
  return u;
}

async function loadPage(target) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target.href, {
      redirect: "follow",
      signal: ctl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-US,en;q=0.9" },
    });
    const finalUrl = safeUrl(res.url || target.href) || target;
    if (res.status === 401 || res.status === 403 || res.status === 429) return { ok: false, error: "blocked", status: res.status };
    if (res.status === 404 || res.status === 410) return { ok: false, error: "not_found", status: res.status };
    if (!res.ok) return { ok: false, error: "fetch_failed", status: res.status };
    return { ok: true, url: finalUrl, html: await readCapped(res) };
  } catch (e) {
    return { ok: false, error: e && e.name === "AbortError" ? "timeout" : "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(res) {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let out = "", size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    out += dec.decode(value, { stream: true });
    if (size >= MAX_BYTES) { try { await reader.cancel(); } catch (e) {} break; }
  }
  return out + dec.decode();
}

// ---------- reading the product out of the page ----------

function extract(html, pageUrl) {
  const nodes = jsonLdNodes(html);
  const ld = nodes.find((n) => isType(n, "Product") || isType(n, "ProductGroup"));
  const meta = metaTags(html);

  const name = clean(str(ld && ld.name) || meta["og:title"] || titleTag(html));
  const images = collectImages(ld, meta, pageUrl, name);
  const offer = readOffers(ld);

  const price = offer.price != null ? offer.price
    : num(meta["product:price:amount"] || meta["og:price:amount"] || meta["product:sale_price:amount"]);
  const currency = offer.currency || meta["product:price:currency"] || meta["og:price:currency"] || null;
  const availability = offer.availability !== "unknown" ? offer.availability
    : mapAvailability(meta["product:availability"] || meta["og:availability"] || "");

  // A page counts as a product only if it has a name and a price or structured product data.
  if (!name || (!ld && price == null)) return null;

  const brand = ld && ld.brand;
  const shop = clean(str(brand && (brand.name || brand)) || meta["og:site_name"] || "") || shopFromHost(pageUrl.hostname);

  const out = {
    url: pageUrl.href,
    shop,
    name,
    availability,
    images,
    checkedAt: new Date().toISOString(),
  };
  const category = breadcrumbCategory(nodes) || clean(str(ld && ld.category)).split(/\s*[>\/]\s*/).pop();
  if (category) out.category = category;
  const color = clean(str(ld && ld.color));
  if (color) out.color = color;
  if (price != null) { out.price = price; out.currency = /^[A-Za-z]{3}$/.test(currency || "") ? currency.toUpperCase() : "USD"; }
  return out;
}

function jsonLdNodes(html) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch (e) { continue; }
    const walk = (v, depth) => {
      if (!v || depth > 4) return;
      if (Array.isArray(v)) { v.forEach((x) => walk(x, depth + 1)); return; }
      if (typeof v !== "object") return;
      out.push(v);
      if (v["@graph"]) walk(v["@graph"], depth + 1);
    };
    walk(data, 0);
  }
  return out;
}

function isType(node, type) {
  const t = node && node["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function metaTags(html) {
  const out = {};
  const re = /<meta\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const key = attr(m[0], "property") || attr(m[0], "name");
    const val = attr(m[0], "content");
    if (!key || val == null) continue;
    const k = key.toLowerCase();
    if (k === "og:image" || k === "og:image:secure_url") (out["og:image:all"] = out["og:image:all"] || []).push(val);
    if (!(k in out)) out[k] = val;
  }
  return out;
}

function attr(tag, name) {
  const m = new RegExp("\\b" + name + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'>]+))", "i").exec(tag);
  return m ? decode(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]) : null;
}

function titleTag(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decode(m[1]).split(/\s+[|\u2013\u2014-]\s+/)[0] : "";
}

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
}

function str(v) { return typeof v === "string" ? v : typeof v === "number" ? String(v) : ""; }
function clean(s) { return decode(String(s || "")).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, 200); }
function num(v) {
  if (typeof v === "number") return isFinite(v) ? v : null;
  const n = parseFloat(String(v == null ? "" : v).replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return isFinite(n) ? n : null;
}

function readOffers(ld) {
  const out = { price: null, currency: null, availability: "unknown" };
  if (!ld) return out;
  let offers = [];
  const add = (o) => { if (Array.isArray(o)) o.forEach(add); else if (o && typeof o === "object") { offers.push(o); if (o.offers) add(o.offers); } };
  add(ld.offers);
  if (Array.isArray(ld.hasVariant)) ld.hasVariant.forEach((v) => v && add(v.offers));
  offers = offers.slice(0, 200);
  if (!offers.length) return out;

  const prices = offers.map((o) => num(o.price != null ? o.price : o.lowPrice != null ? o.lowPrice
    : o.priceSpecification && o.priceSpecification.price)).filter((p) => p != null && p > 0);
  if (prices.length) out.price = Math.min(...prices);
  const cur = offers.map((o) => o.priceCurrency || (o.priceSpecification && o.priceSpecification.priceCurrency)).find(Boolean);
  if (cur) out.currency = String(cur);

  const states = offers.map((o) => mapAvailability(str(o.availability))).filter((s) => s !== "unknown");
  if (states.includes("in_stock")) out.availability = "in_stock";
  else if (states.includes("low_stock")) out.availability = "low_stock";
  else if (states.includes("out_of_stock")) out.availability = "out_of_stock";
  return out;
}

function mapAvailability(v) {
  const s = String(v || "").toLowerCase().replace(/^https?:\/\/schema\.org\//, "").replace(/[\s_-]/g, "");
  if (!s) return "unknown";
  if (/^(instock|instoreonly|onlineonly|available|preorder|presale|backorder)/.test(s)) return "in_stock";
  if (/^(limitedavailability|lowstock)/.test(s)) return "low_stock";
  if (/^(outofstock|soldout|discontinued|oos|unavailable)/.test(s)) return "out_of_stock";
  return "unknown";
}

function collectImages(ld, meta, pageUrl, name) {
  const raw = [];
  const add = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.forEach(add);
    else if (typeof v === "string") raw.push(v);
    else if (typeof v === "object") add(v.contentUrl || v.url);
  };
  if (ld) {
    add(ld.image);
    const offers = Array.isArray(ld.offers) ? ld.offers : ld.offers ? [ld.offers] : [];
    offers.slice(0, 50).forEach((o) => o && add(o.image));
  }
  add(meta["og:image:all"]);
  const seen = new Set();
  const out = [];
  for (const r of raw) {
    let u;
    try { u = new URL(decode(r).trim(), pageUrl); } catch (e) { continue; }
    if (u.protocol === "http:") u.protocol = "https:";
    if (!safeUrl(u.href)) continue;
    const key = u.origin + u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ src: u.href, alt: (name || "Product") + ", photo " + (out.length + 1) });
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

function breadcrumbCategory(nodes) {
  const list = nodes.find((n) => isType(n, "BreadcrumbList"));
  const items = list && Array.isArray(list.itemListElement) ? list.itemListElement : [];
  const names = items.map((i) => clean(str(i && (i.name || (i.item && i.item.name))))).filter(Boolean);
  return names.length ? names[names.length - 1] : "";
}

function shopFromHost(host) {
  const parts = host.split(".").filter((p) => !["www", "www2", "m", "shop", "store"].includes(p));
  const s = parts[0] || host;
  return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1);
}
