// Automatic block-list updates, without a new Voidy release.
//
// New ad, tracker and scam domains appear every day. This downloads the same
// lists the bundled rules were built from (data/list-sources.json), and:
//   - adds domains that are new since the bundled copy as extra block rules;
//   - switches off bundled rule groups that contain a domain the list authors
//     have since removed (often a fix for a site that broke), re-adding the
//     group's other domains from the fresh copy.
// Only list data (domain names) is downloaded, never code. If a download fails
// or looks too small, the previous rules stay in place.
//
//   LIST_UPDATES.freshRules(state, ids)  rules for background.js to install
//   LIST_UPDATES.run({ force })          check now (the alarm calls this)
//   LIST_UPDATES.status()                what the settings page shows
globalThis.LIST_UPDATES = (() => {
  // ---- Settings ------------------------------------------------------------
  const CHECK_ALARM = "voidy-list-updates";
  const CHECK_EVERY_MINUTES = 60;     // how often to look for a list that is due
  const FIRST_CHECK_MINUTES = 3;      // after install/update, wait a little before the first download
  const MIN_SIZE = 0.6;               // refuse a download under 60% of the bundled list's size
  const TIMEOUT_MS = 60000;
  const ORDER = ["security", "ads", "privacy"];
  // --------------------------------------------------------------------------

  const DOMAIN = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$/;
  const ABP_DOMAIN = /^\|\|([a-z0-9._-]+)\^(\$third-party)?$/;
  let onChange = async () => {};
  let builtAt = null;                                   // when the bundled lists were built (data/build-info.json)
  async function bundledAge() {
    if (builtAt === null) { try { builtAt = +(await (await fetch(chrome.runtime.getURL("data/build-info.json"))).json()).builtAt || 0; } catch (_) { builtAt = 0; } }
    return builtAt;
  }
  let running = null, cache = null;

  const parents = (d) => { const p = d.split("."), out = []; for (let i = 1; i < p.length - 1; i++) out.push(p.slice(i).join(".")); return out; };
  const covered = (d, set) => set.has(d) || parents(d).some((p) => set.has(p));

  async function fetchText(urls) {
    let last;
    for (const url of urls) {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: ctl.signal, cache: "no-cache", credentials: "omit" });
        if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
        return await res.text();
      } catch (e) { last = e; } finally { clearTimeout(t); }
    }
    throw last || new Error("no download address");
  }

  // Same reading rules as tools/build_static_rules.py.
  function parseSource(src, text) {
    const any = new Set(), tp = new Map();
    let section = "";
    const wanted = () => src.sections.some((s) => (s.endsWith("/") ? section.startsWith(s) : section === s)) &&
      !(src.skipSections || []).some((k) => section.includes(k));
    for (let line of text.split("\n")) {
      line = line.trim();
      if (src.format === "abp") {
        const m = /^! \*\*\* easylist:(\S+) \*\*\*$/.exec(line);
        if (m) { section = m[1]; continue; }
        if (!line || line[0] === "!" || line[0] === "[" || !wanted()) continue;
        const d = ABP_DOMAIN.exec(line);
        if (d && d[1].includes(".")) tp.set(d[1], (tp.has(d[1]) ? tp.get(d[1]) : true) && !!d[2]);
      } else {
        if (!line || line[0] === "#" || line[0] === "!" || line[0] === "[") continue;
        line = line.toLowerCase();
        if (DOMAIN.test(line)) any.add(line);
      }
    }
    for (const [d, thirdOnly] of tp) if (!thirdOnly) { any.add(d); tp.delete(d); }
    return { any, tp: new Set(tp.keys()) };
  }

  async function download(cat, cfg) {
    const c = cfg.categories[cat], any = new Set(c.curated || []), tp = new Set();
    for (const src of c.sources) {
      const got = parseSource(src, await fetchText(src.urls));
      for (const d of got.any) any.add(d);
      for (const d of got.tp) tp.add(d);
    }
    // A list that blocks google.com or wikipedia.org outright is broken or tampered with: throw it all away.
    const bad = (cfg.tripwire || []).filter((d) => any.has(d) || tp.has(d));
    if (bad.length) throw new Error("download blocks sites that must never be blocked (" + bad.slice(0, 3).join(", ") + "): ignored");
    for (const d of any) tp.delete(d);
    for (const d of cfg.neverBlock) { any.delete(d); tp.delete(d); }
    return { any, tp };
  }

  const bundled = async (cat) => (await (await fetch(chrome.runtime.getURL(`rules/${cat}.json`))).json())
    .map((r) => ({ id: r.id, domains: r.condition.requestDomains || [] }));

  // `taken`: domains an earlier category already blocks (security, then ads,
  // then privacy, like the build script), so each domain is added only once.
  async function updateCategory(cat, cfg, taken) {
    const up = await download(cat, cfg);
    const chunks = await bundled(cat);
    const bundledCount = chunks.reduce((n, c) => n + c.domains.length, 0);
    if (up.any.size + up.tp.size < MIN_SIZE * bundledCount)
      throw new Error(`download looked incomplete (${up.any.size + up.tp.size} of about ${bundledCount} entries)`);
    // A bundled group goes stale when the list no longer has one of its domains.
    const still = (d) => covered(d, up.any) || up.tp.has(d);
    // Threat feeds drop dead hosts every day, and a dead host that stays blocked does no harm,
    // so for security lists (replaceStale: false) only NEW addresses are added. Ads and trackers
    // are replaced when upstream removed something (often a fix for a broken site).
    const stale = cfg.categories[cat].replaceStale === false ? [] : chunks.filter((c) => c.domains.some((d) => !still(d))).map((c) => c.id);
    const staleSet = new Set(stale), kept = new Set();
    for (const c of chunks) if (!staleSet.has(c.id)) for (const d of c.domains) kept.add(d);
    const fresh = (set) => [...set].filter((d) => !covered(d, kept) && !covered(d, taken) && !parents(d).some((p) => set.has(p))).sort();
    const any = fresh(up.any), tp = fresh(up.tp).filter((d) => !covered(d, up.any));
    const old = await chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: cat });
    await chrome.declarativeNetRequest.updateStaticRules({ rulesetId: cat, disableRuleIds: stale,
      enableRuleIds: old.filter((id) => !staleSet.has(id)) });
    return { any, tp, stale: stale.length };
  }

  // YouTube details (data/youtube.json): plain values, strictly checked.
  function validYoutube(c) {
    if (!c || typeof c !== "object") return null;
    const out = {};
    if (typeof c.playerParams === "string" && /^[A-Za-z0-9_-]{1,40}={0,2}$/.test(c.playerParams)) out.playerParams = c.playerParams;
    for (const k of ["freshActivityTime", "quickReload"]) if (typeof c[k] === "boolean") out[k] = c[k];
    if (Array.isArray(c.adKeys) && c.adKeys.length && c.adKeys.length <= 12 && c.adKeys.every((k) => typeof k === "string" && /^[A-Za-z]{2,40}$/.test(k))) out.adKeys = c.adKeys;
    if (Number.isInteger(c.version)) out.version = c.version;
    return Object.keys(out).length ? out : null;
  }
  async function updateYoutube(cfg, force) {
    const src = cfg.youtube;
    if (!src || !src.urls || !src.urls.length) return false;
    const { ytConfig = {} } = await chrome.storage.local.get("ytConfig");
    if (!force && Date.now() - (ytConfig.updated || 0) < src.everyHours * 3600e3) return false;
    const fresh = validYoutube(JSON.parse(await fetchText(src.urls)));
    if (!fresh) throw new Error("YouTube settings file looked wrong");
    await chrome.storage.local.set({ ytConfig: { ...fresh, updated: Date.now() } });
    return true;
  }

  async function load() {
    if (!cache) cache = (await chrome.storage.local.get({ freshLists: {} })).freshLists;
    return cache;
  }

  async function status() {
    const { listUpdates = {} } = await chrome.storage.local.get("listUpdates");
    const fresh = await load(), out = { auto: listUpdates.auto !== false, running: !!running, cats: {} };
    for (const cat of ORDER) {
      const s = (listUpdates.cats || {})[cat] || {}, f = fresh[cat] || {};
      out.cats[cat] = { updated: s.updated || 0, checked: s.checked || 0, error: s.error || "",
        added: (f.any || []).length + (f.tp || []).length, replacedGroups: f.stale || 0 };
    }
    return out;
  }

  async function run({ force = false } = {}) {
    if (running) return running;
    running = (async () => {
      const { listUpdates = {} } = await chrome.storage.local.get("listUpdates");
      if (!force && listUpdates.auto === false) return status();
      const cfg = await (await fetch(chrome.runtime.getURL("data/list-sources.json"))).json();
      const fresh = { ...(await load()) }, cats = { ...(listUpdates.cats || {}) };
      let changed = false;
      const taken = new Set();
      for (const cat of ORDER) {
        // a fresh install counts the bundled lists as "updated" when they were built, so it doesn't re-download them at once
        const s = cats[cat] || {}, due = Date.now() - (s.updated || await bundledAge()) > cfg.categories[cat].everyHours * 3600e3;
        if (force || due || (s.error && Date.now() - (s.checked || 0) > 6 * 3600e3)) {
          try {
            fresh[cat] = await updateCategory(cat, cfg, taken);
            cats[cat] = { updated: Date.now(), checked: Date.now(), error: "" };
            changed = true;
          } catch (e) {
            cats[cat] = { ...s, checked: Date.now(), error: String(e && e.message || e).slice(0, 160) };
          }
        }
        if (cat !== ORDER[ORDER.length - 1]) for (const list of await activeDomains(cat, fresh)) for (const d of list) taken.add(d);
      }
      try { await updateYoutube(cfg, force); } catch (_) {}      // keeps the previous settings on failure
      if (changed) { cache = fresh; await chrome.storage.local.set({ freshLists: fresh }); }
      await chrome.storage.local.set({ listUpdates: { ...listUpdates, cats } });
      if (changed) await onChange();
      return status();
    })();
    try { return await running; } finally { running = null; }
  }

  // Block rules (and malware warning pages) for the fresh domains of every
  // category that is switched on. ids: { block: {security, ads, privacy}, warn }.
  async function freshRules(state, ids, warnRule) {
    const fresh = await load(), rules = [], size = 1000;
    for (const cat of ORDER) {
      const f = fresh[cat];
      if (!f || !state.filters[cat]) continue;
      let id = ids.block[cat];
      for (const [list, tp] of [[f.any || [], false], [f.tp || [], true]])
        for (let i = 0; i < list.length; i += size)
          rules.push({ id: id++, priority: 1, action: { type: "block" },
            condition: { requestDomains: list.slice(i, i + size), ...(tp ? { domainType: "thirdParty" } : {}) } });
      if (cat === "security" && warnRule) {
        let w = ids.warn;
        for (let i = 0; i < (f.any || []).length; i += size) rules.push(warnRule(w++, f.any.slice(i, i + size)));
      }
    }
    return rules;
  }

  // The domains Voidy blocks right now for a category (bundled groups still on + fresh).
  async function activeDomains(cat, lists) {
    const off = new Set(await chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: cat }));
    const f = (lists || await load())[cat] || {};
    return [...(await bundled(cat)).filter((c) => !off.has(c.id)).map((c) => c.domains), f.any || [], f.tp || []];
  }

  async function onInstalled(details) {
    // A new release ships newer bundled lists: start fresh from those.
    if (details.reason === "update" || details.reason === "install") {
      cache = {};
      await chrome.storage.local.remove("freshLists");
      for (const cat of ORDER) {
        try { const off = await chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: cat });
          if (off.length) await chrome.declarativeNetRequest.updateStaticRules({ rulesetId: cat, enableRuleIds: off }); } catch (e) {}
      }
      const { listUpdates = {} } = await chrome.storage.local.get("listUpdates");
      await chrome.storage.local.set({ listUpdates: { auto: listUpdates.auto, cats: {} } });
    }
    await schedule(FIRST_CHECK_MINUTES);
  }
  async function schedule(delay = 1) {
    if (!(await chrome.alarms.get(CHECK_ALARM))) chrome.alarms.create(CHECK_ALARM, { delayInMinutes: delay, periodInMinutes: CHECK_EVERY_MINUTES });
  }
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === CHECK_ALARM) run().catch(() => {}); });

  return { run, status, freshRules, activeDomains, onInstalled, schedule, parseSource, validYoutube,
    setAuto: async (on) => { const { listUpdates = {} } = await chrome.storage.local.get("listUpdates");
      await chrome.storage.local.set({ listUpdates: { ...listUpdates, auto: !!on } }); if (on) await schedule(); },
    init: (fn) => { onChange = fn; } };
})();
