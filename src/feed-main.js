// Feed ads on X, Instagram and Facebook (MAIN world, document_start; registered
// only on those sites while the Ads filter is on). These sites send their feeds
// as data, and the data marks each ad: X with a "promotedMetadata" field,
// Instagram with ad ids, Facebook with "sponsored" fields. This removes the
// feed items that carry such a marker before the page draws them, and changes
// nothing else. Which replies are feeds and which fields are markers come from
// the shared fixes file (data/site-fixes.json), handed over by config-bridge.js,
// so a renamed field can be fixed without a new release. Unknown shapes, broken
// JSON and very large replies pass through untouched.
(() => {
  "use strict";
  const MAX_TEXT = 4 * 1024 * 1024, MAX_DEPTH = 32, MAX_VISITS = 50000;

  function valueAt(o, key) {
    for (const part of key.split(".")) { if (!o || typeof o !== "object") return undefined; o = o[part]; }
    return o;
  }
  function isAd(item, markers, counts) {
    for (const m of markers) {
      const v = valueAt(item, m.key);
      if (m.equals !== undefined ? v === m.equals : v !== undefined && v !== null) {
        counts.matched[m.key] = (counts.matched[m.key] || 0) + 1;
        return true;
      }
    }
    return false;
  }
  // Remove marked items from every array in the reply (bounded walk).
  function prune(root, markers, counts) {
    let changed = false, visits = 0;
    const stack = [[root, 0]], seen = new Set();
    while (stack.length && visits++ < MAX_VISITS) {
      const [o, depth] = stack.pop();
      if (!o || typeof o !== "object" || depth > MAX_DEPTH || seen.has(o)) continue;
      seen.add(o);
      if (Array.isArray(o)) {
        let w = 0;
        for (let i = 0; i < o.length; i++) {
          const it = o[i];
          if (it && typeof it === "object" && !Array.isArray(it)) {
            counts.items++;
            if (isAd(it, markers, counts)) { counts.removed++; changed = true; continue; }
          }
          o[w++] = it;
        }
        o.length = w;
        for (const it of o) stack.push([it, depth + 1]);
      } else for (const k in o) stack.push([o[k], depth + 1]);
    }
    return changed;
  }
  // text in, text out. A JSON-lines reply (Facebook) is filtered line by line:
  // a line whose own data is marked goes, other lines keep their exact bytes.
  function filterFeedText(text, feed) {
    const counts = { items: 0, removed: 0, matched: {} };
    const same = { text, ...counts };
    if (typeof text !== "string" || !text || text.length > MAX_TEXT || !feed || !Array.isArray(feed.markers) || !feed.markers.length) return same;
    try {
      if (!feed.jsonLines) {
        const data = JSON.parse(text);
        return prune(data, feed.markers, counts) ? { text: JSON.stringify(data), ...counts } : { text, ...counts };
      }
      let changed = false;
      const out = [];
      for (const line of text.split("\n")) {
        const cr = line.endsWith("\r"), core = cr ? line.slice(0, -1) : line;
        let data;
        try { data = JSON.parse(core); } catch (_) { out.push(line); continue; }
        if (data && typeof data === "object" && !Array.isArray(data) && isAd(data, feed.markers, counts)) { counts.removed++; changed = true; continue; }
        if (prune(data, feed.markers, counts)) { changed = true; out.push(JSON.stringify(data) + (cr ? "\r" : "")); }
        else out.push(line);
      }
      return { text: changed ? out.join("\n") : text, ...counts };
    } catch (_) { return same; }
  }

  if (typeof module === "object" && module.exports) { module.exports = { filterFeedText }; return; }
  if (typeof window !== "object" || typeof document !== "object") return;

  // ---- in the page ------------------------------------------------------------
  const apply = Reflect.apply, define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
  const originals = new WeakMap();
  try {
    const original = Function.prototype.toString;
    const replacement = { toString() { return apply(original, originals.get(this) || this, []); } }.toString;
    originals.set(replacement, original);
    define(Function.prototype, "toString", { ...descriptor(Function.prototype, "toString"), value: replacement });
  } catch (_) {}
  function method(object, key, factory) {
    const d = descriptor(object, key);
    if (!d || typeof d.value !== "function") return;
    const replacement = factory(d.value);
    try { define(replacement, "name", { value: d.value.name }); originals.set(replacement, d.value); define(object, key, { ...d, value: replacement }); } catch (_) {}
  }
  function getter(object, key, factory) {
    const d = descriptor(object, key);
    if (!d || typeof d.get !== "function" || !d.configurable) return;
    const replacement = factory(d.get);
    originals.set(replacement, d.get);
    define(object, key, { ...d, get: replacement });
  }

  // Settings from the fixes file, set on <html> by config-bridge.js (read once, then removed).
  let feeds = null;
  function settings() {
    if (feeds) return feeds;
    const raw = document.documentElement && document.documentElement.getAttribute("data-voidy-feed");
    if (raw === null || raw === undefined) return null;
    try {
      document.documentElement.removeAttribute("data-voidy-feed");
      const list = JSON.parse(raw);
      feeds = (Array.isArray(list) ? list : []).filter((f) => f && typeof f.path === "string" && Array.isArray(f.markers))
        .map((f) => ({ ...f, re: new RegExp("^" + f.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^?#]+") + "$") }));
    } catch (_) { feeds = []; }
    return feeds;
  }
  const site = location.hostname.split(".").slice(-2).join(".");
  const requestUrl = (() => { try { const g = descriptor(Request.prototype, "url").get; return (r) => apply(g, r, []); } catch (_) { return (r) => r.url; } })();
  function feedFor(input) {
    const list = settings();
    if (!list || !list.length) return null;
    try {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? requestUrl(input) : String(input), location.href);
      if (!/^https?:$/.test(u.protocol) || !(u.hostname === site || u.hostname.endsWith("." + site))) return null;
      return list.find((f) => f.re.test(u.pathname)) || null;
    } catch (_) { return null; }
  }
  // What the popup's "Feed check" line shows (counts only, never content).
  const totals = { replies: 0, items: 0, removed: 0, matched: {} };
  function count(r) {
    totals.replies++; totals.items += r.items; totals.removed += r.removed;
    for (const [k, n] of Object.entries(r.matched)) totals.matched[k] = (totals.matched[k] || 0) + n;
    try { document.documentElement.setAttribute("data-voidy-feed-count", JSON.stringify(totals)); } catch (_) {}
  }

  const NativeResponse = Response, NativeHeaders = Headers;
  function rebuilt(original, text) {
    const headers = new NativeHeaders(original.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    const res = new NativeResponse(text, { status: original.status, statusText: original.statusText, headers });
    for (const key of ["url", "type", "redirected"]) define(res, key, { configurable: true, value: original[key] });
    return res;
  }
  method(window, "fetch", (orig) => ({ fetch(input) {
    const pending = apply(orig, this, arguments);
    const feed = feedFor(input);
    if (!feed) return pending;
    return pending.then(async (res) => {
      if (!res || !res.ok || res.bodyUsed) return res;
      try {
        const r = filterFeedText(await res.clone().text(), feed);
        count(r);
        return r.removed ? rebuilt(res, r.text) : res;
      } catch (_) { return res; }
    });
  } }).fetch);

  const xhrFeed = new WeakMap(), xhrCache = new WeakMap();
  method(XMLHttpRequest.prototype, "open", (orig) => ({ open(m, url) {
    xhrFeed.set(this, feedFor(typeof url === "string" ? url : String(url))); xhrCache.delete(this);
    return apply(orig, this, arguments);
  } }).open);
  const done = (x) => x.readyState === 4 && x.status >= 200 && x.status < 300 && xhrFeed.get(x);
  function xhrText(x, raw) {
    if (!done(x) || typeof raw !== "string") return raw;
    const prior = xhrCache.get(x);
    if (prior && prior.raw === raw) return prior.out;
    const r = filterFeedText(raw, xhrFeed.get(x));
    count(r);
    xhrCache.set(x, { raw, out: r.text });
    return r.text;
  }
  getter(XMLHttpRequest.prototype, "responseText", (orig) => descriptor({ get responseText() { return xhrText(this, apply(orig, this, [])); } }, "responseText").get);
  getter(XMLHttpRequest.prototype, "response", (orig) => descriptor({ get response() {
    const v = apply(orig, this, []);
    if (typeof v === "string") return xhrText(this, v);
    if (v && typeof v === "object" && this.responseType === "json" && done(this) && !xhrCache.has(this)) {
      const counts = { items: 0, removed: 0, matched: {} };
      try { prune(v, xhrFeed.get(this).markers, counts); } catch (_) {}
      xhrCache.set(this, { raw: null, out: v }); count(counts);
    }
    return v;
  } }, "response").get);
})();
