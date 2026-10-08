// The shared fixes file (data/site-fixes.json, refreshed from GitHub every few
// hours): small repairs and rules for sites that change often. Everything in it
// is plain data. Nothing here is ever run as code, written into the page as
// HTML, or used as a CSS block: hiding rules are selectors only. Each entry is
// checked; a bad one is skipped and the rest are kept.
globalThis.VOIDY_FIXES = (() => {
  const LIMITS = { sites: 300, allow: 50, block: 50, hide: 200, feeds: 10, markers: 10, adPlaying: 20,
    selector: 300, urlFilter: 200, path: 120, equals: 60, keySegments: 8 };
  const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
  const TYPES = new Set(["script", "xmlhttprequest", "image", "media", "sub_frame", "ping", "other", "websocket"]);
  const URL_FILTER = /^[!#-&(-~]+$/;                 // printable ASCII without spaces or quotes
  const PATH = /^\/[A-Za-z0-9_\-./*]*$/;
  const KEY = /^[A-Za-z0-9_]{1,40}$/;

  const host = (h) => (typeof h === "string" && HOST.test(h.toLowerCase()) ? h.toLowerCase() : null);
  const selector = (s) => typeof s === "string" && s.trim() && s.length <= LIMITS.selector && !/[{}@<;]/.test(s) ? s.trim() : null;
  function key(k) {
    if (typeof k !== "string") return null;
    const parts = k.split(".");
    return parts.length <= LIMITS.keySegments && parts.every((p) => KEY.test(p)) ? k : null;
  }
  function block(b) {
    if (!b || typeof b.urlFilter !== "string" || b.urlFilter.length > LIMITS.urlFilter || !URL_FILTER.test(b.urlFilter)) return null;
    if (b.types === undefined) return { urlFilter: b.urlFilter };
    if (!Array.isArray(b.types) || !b.types.length || !b.types.every((t) => TYPES.has(t))) return null;
    return { urlFilter: b.urlFilter, types: [...new Set(b.types)] };
  }
  function marker(m) {
    if (!m || !key(m.key)) return null;
    if (m.equals === undefined) return { key: m.key };
    return typeof m.equals === "string" && m.equals.length <= LIMITS.equals ? { key: m.key, equals: m.equals } : null;
  }
  function feed(f) {
    if (!f || typeof f.path !== "string" || f.path.length > LIMITS.path || !PATH.test(f.path) || !Array.isArray(f.markers)) return null;
    const markers = f.markers.map(marker).filter(Boolean).slice(0, LIMITS.markers);
    return markers.length ? { path: f.path, jsonLines: f.jsonLines === true, markers } : null;
  }
  const list = (v, check, cap, into = []) => {
    if (!Array.isArray(v)) return into;
    for (const x of v) {
      if (into.length >= cap) break;
      const ok = check(x);
      if (ok !== null && !into.some((y) => JSON.stringify(y) === JSON.stringify(ok))) into.push(ok);
    }
    return into;
  };

  function validFixes(raw) {
    if (!raw || typeof raw !== "object" || !Number.isInteger(raw.version)) return null;
    const sites = {};
    const entries = raw.sites && typeof raw.sites === "object" && !Array.isArray(raw.sites) ? Object.entries(raw.sites) : [];
    for (const [name, e] of entries) {
      const h = host(name);
      if (!h || !e || typeof e !== "object") continue;
      if (!sites[h] && Object.keys(sites).length >= LIMITS.sites) continue;
      const s = sites[h] || { off: false, allow: [], block: [], hide: [], feeds: [], adPlaying: [] };
      s.off = s.off || e.off === true;
      list(e.allow, host, LIMITS.allow, s.allow);
      list(e.block, block, LIMITS.block, s.block);
      list(e.hide, selector, LIMITS.hide, s.hide);
      list(e.feeds, feed, LIMITS.feeds, s.feeds);
      list(e.adPlaying, selector, LIMITS.adPlaying, s.adPlaying);
      sites[h] = s;
    }
    for (const [h, s] of Object.entries(sites)) {
      for (const k of ["allow", "block", "hide", "feeds", "adPlaying"]) if (!s[k].length) delete s[k];
      if (!s.off && Object.keys(s).length === 1) delete sites[h];
    }
    return { version: raw.version, sites };
  }
  return { validFixes, LIMITS };
})();
