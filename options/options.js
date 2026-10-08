// Voidy dashboard & settings.
// Every control here maps to a real setting in background.js — nothing decorative.
const $ = (id) => document.getElementById(id);
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, (r) => res(r)));
const ico = (n) => (self.VOIDY_ICONS ? self.VOIDY_ICONS.svg(n) : "");
const fmt = (n) => (n || 0).toLocaleString();
const ANNOY = ["cookies", "newsletter", "notifications", "chat", "annoyances", "social"];
const MODES = ["auto", "full", "lite", "stealth1", "stealth2", "stealth3", "off"];
const MODE_LABEL = { auto: "Auto", full: "Full", lite: "Lite", stealth1: "Stealth 1", stealth2: "Stealth 2", stealth3: "Stealth 3", off: "Off" };
const RUNGS = ["full", "stealth1", "stealth2", "stealth3"];
const RUNG_COLOR = { full: "#4d9fff", stealth1: "#8f7dff", stealth2: "#c46cff", stealth3: "#ff5c93" };

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    // CSS custom properties ("--c") are ignored by Object.assign(style); set them explicitly.
    if (k === "style" && typeof v === "object") for (const [p, pv] of Object.entries(v)) { if (p.startsWith("--")) e.style.setProperty(p, pv); else e.style[p] = pv; }
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;              // only ever used with our own icon SVG
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k);
  return e;
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 1800);
}
const saved = () => toast("Saved");

// ============================================================ navigation
function show(tab) {
  if (!document.querySelector(`[data-panel="${tab}"]`)) tab = "dash";
  document.querySelectorAll("#nav button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("on", p.dataset.panel === tab));
  if (location.hash.slice(1) !== tab) history.replaceState(null, "", "#" + tab);
  if (tab === "dash") loadStats();
  if (tab === "logs") loadLog();
  if (tab === "filters" || tab === "stealth") loadListInfo();
  window.scrollTo(0, 0);
}
document.querySelectorAll("#nav button").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
addEventListener("hashchange", () => show(location.hash.slice(1)));

// ============================================================ dashboard
function countUp(node, to) {
  const from = parseInt((node.textContent || "0").replace(/\D/g, ""), 10) || 0;
  if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { node.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 700;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    node.textContent = fmt(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

const BADGES = [
  { id: "first", name: "First block", need: "Block 1 thing", icon: "star", c: "#ffc53d", v: (s) => s.total, goal: 1 },
  { id: "hundred", name: "Century", need: "100 blocked", icon: "shield", c: "#4d9fff", v: (s) => s.total, goal: 100 },
  { id: "thousand", name: "Thousand club", need: "1,000 blocked", icon: "shield", c: "#7c5cff", v: (s) => s.total, goal: 1000 },
  { id: "tenk", name: "Wall of steel", need: "10,000 blocked", icon: "shield", c: "#ff5c93", v: (s) => s.total, goal: 10000 },
  { id: "trackers", name: "Tracker hunter", need: "250 trackers", icon: "eye", c: "#f0a92b", v: (s) => s.t.privacy, goal: 250 },
  { id: "cookies", name: "Clutter cutter", need: "25 pop-ups & widgets", icon: "cookie", c: "#3ecf8e", v: (s) => s.t.annoy, goal: 25 },
  { id: "malware", name: "Close call", need: "Stop 1 malicious site", icon: "bug", c: "#f0566f", v: (s) => s.t.security, goal: 1 },
  { id: "redirects", name: "Stay put", need: "Hold 10 redirects", icon: "route", c: "#2fc6e0", v: (s) => s.t.held, goal: 10 },
  { id: "ghost", name: "Ghost mode", need: "Dodge 1 anti-adblock wall", icon: "ghost", c: "#c46cff", v: (s) => s.t.climbs, goal: 1 },
  { id: "orgs", name: "Company collector", need: "Stop 25 companies", icon: "org", c: "#5fd1c4", v: (s) => s.orgs, goal: 25 }
];

async function loadStats() {
  const r = await send({ type: "getStats" });
  if (!r) return;
  const t = r.totals || {};
  const total = (t.ads || 0) + (t.privacy || 0) + (t.security || 0) + (t.annoy || 0);
  const orgs = new Set();
  for (const c of r.cats || []) for (const it of c.items || []) orgs.add(it.name);
  countUp($("d-total"), total);
  for (const k of ["ads", "privacy", "security", "annoy", "hidden", "held", "climbs"]) countUp($("d-" + k), t[k] || 0);
  countUp($("d-orgs"), orgs.size);
  $("since").textContent = r.since ? " since " + new Date(r.since).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" }) : "";
  drawDonut(r.cats || [], r.debugAvailable);
  drawBars(r.cats || []);
  drawBadges({ total, t, orgs: orgs.size });
}

function drawDonut(cats, debugAvailable) {
  const g = $("d-segs"); g.innerHTML = "";
  const leg = $("d-legend"); leg.innerHTML = "";
  const sum = cats.reduce((s, c) => s + c.count, 0);
  $("d-empty").hidden = sum > 0;
  if (!sum) { $("d-empty").textContent = "Nothing blocked yet. Browse a little and come back."; return; }
  const R = 50, C = 2 * Math.PI * R;
  let off = 0;
  for (const c of cats) {
    const len = (c.count / sum) * C, gap = cats.length > 1 ? 2 : 0;
    const s = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    s.setAttribute("class", "seg2"); s.setAttribute("cx", 60); s.setAttribute("cy", 60); s.setAttribute("r", R);
    s.setAttribute("stroke", c.color);
    s.setAttribute("stroke-dasharray", `${Math.max(0, len - gap)} ${C}`);
    s.setAttribute("stroke-dashoffset", -off);
    g.append(s); off += len;
    leg.append(el("li", {}, el("span", { class: "dot", style: { background: c.color } }), el("span", { class: "nm" }, c.name),
      el("span", { class: "ct" }, fmt(c.count)), el("span", { class: "pc" }, Math.round((c.count / sum) * 100) + "%")));
  }
}

function drawBars(cats) {
  const orgs = {};
  for (const c of cats) for (const it of c.items || []) {
    const o = orgs[it.name] || (orgs[it.name] = { name: it.name, count: 0, color: c.color });
    o.count += it.count;
  }
  const top = Object.values(orgs).sort((a, b) => b.count - a.count).slice(0, 8);
  const ul = $("d-bars"); ul.innerHTML = "";
  if (!top.length) { ul.append(el("li", { class: "empty" }, "No companies yet.")); return; }
  const max = top[0].count;
  for (const o of top) {
    const fill = el("b", { style: { background: `linear-gradient(90deg, ${o.color}, ${o.color}aa)` } });
    ul.append(el("li", {}, el("span", { class: "nm", title: o.name }, o.name), el("span", { class: "bar" }, fill), el("span", { class: "ct" }, fmt(o.count))));
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = Math.max(3, (o.count / max) * 100) + "%")));
  }
}

async function drawBadges(s) {
  const box = $("badges"); box.innerHTML = "";
  let got = 0;
  const { seenBadges = [] } = await chrome.storage.local.get({ seenBadges: [] });
  const fresh = [];
  for (const b of BADGES) {
    const v = b.v(s) || 0, ok = v >= b.goal;
    if (ok) { got++; if (!seenBadges.includes(b.id)) fresh.push(b.id); }
    const pct = Math.min(100, (v / b.goal) * 100);
    box.append(el("div", { class: "bdg" + (ok ? " got" : ""), style: { "--c": b.c }, title: ok ? "Unlocked" : `${fmt(v)} / ${fmt(b.goal)}` },
      el("i", { html: ico(b.icon) }), el("b", {}, b.name), el("span", {}, b.need),
      ok ? null : el("div", { class: "prog" }, el("b", { style: { width: pct + "%", display: "block" } }))));
  }
  $("m-count").textContent = `${got} / ${BADGES.length}`;
  if (fresh.length) {
    await chrome.storage.local.set({ seenBadges: [...seenBadges, ...fresh] });
    if (seenBadges.length) { confetti(); toast("New milestone unlocked!"); }   // not on the very first visit
  }
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const box = $("confetti"), colors = ["#7c5cff", "#3ecf8e", "#ffc53d", "#ff5c93", "#1fb6ff", "#f0a92b"];
  for (let i = 0; i < 90; i++) {
    const b = el("b", { style: { left: Math.random() * 100 + "vw", background: colors[i % colors.length],
      animationDuration: 1.6 + Math.random() * 1.6 + "s", animationDelay: Math.random() * 0.4 + "s", transform: `rotate(${Math.random() * 360}deg)` } });
    box.append(b); setTimeout(() => b.remove(), 3800);
  }
}

// ============================================================ settings
let S = null;
async function loadAll() {
  S = await send({ type: "getSettings" });
  if (!S) return;
  for (const k of ["ads", "privacy", "security", "telemetry"]) $("f-" + k).checked = !!S.filters[k];
  $("a-adscos").checked = S.adsCosmetic !== false;
  for (const c of ANNOY) $("a-" + c).checked = !!(S.annoy || {})[c];
  $("a-cookiereject").checked = S.cookieMode !== "hide";
  $("cookie-mode").classList.toggle("off-dim", !$("a-cookies").checked);
  $("x-rescue").checked = S.rescue !== false;
  $("x-detectlibs").checked = S.detectLibs !== false;
  $("gentle").checked = S.gentleRetry !== false;
  $("x-badge").checked = S.badge !== false;
  $("x-gpc").checked = S.gpc !== false;
  setSeg("automax", S.autoMax || "stealth2"); autoMaxHint(S.autoMax || "stealth2");
  setSeg("swatches", VOIDY_THEME.themeName(S.theme));
  $("custom-primary").value=S.customColors?.primary||"#9b74ff";
  $("custom-secondary").value=S.customColors?.secondary||"#ec6eb4";
  const g = S.guard || {};
  setRange("g-max", g.maxPrompts ?? 3, (v) => v);
  setRange("g-timeout", Math.round((g.timeoutMs ?? 20000) / 1000), (v) => v + "s");
  setSeg("popclick", g.popupAfterClick === "allow" ? "allow" : "ask");
  $("g-overlay").checked = g.overlayGuard !== false;
  $("g-tabunder").checked = (g.blockTabUnderMs ?? 2000) > 0;
  $("g-nonhttp").checked = g.promptForNonHttp !== false;
  $("g-afterfirst").checked = !!g.runOnlyAfterFirstRedirect;
  $("g-enabled").checked = g.enabled !== false;
  setSeg("g-action", g.action === "block" ? "block" : "ask");
  setSeg("g-fake", ["always", "never"].includes(g.fakePopups) ? g.fakePopups : "stealth");
  setSeg("g-pos", g.promptPos === "bottom-right" ? "bottom-right" : "top-right");
  $("g-links").checked = g.linkPopups !== false;
  $("g-quietads").checked = g.quietAds !== false;
  $("g-malware").checked = g.malwarePage !== false;
  $("g-lookalike").checked = g.lookalike !== false;
  document.querySelector('[data-panel="guard"]').classList.toggle("guard-off", g.enabled === false);
  renderChips("guardoff", Object.keys(S.guardOff || {}).filter((h) => S.guardOff[h]).sort(), (h) => send({ type: "setGuardSite", host: h, on: true }), "no-guardoff");
  renderChips("widgetoff", Object.keys(S.widgetOff || {}).filter((h) => S.widgetOff[h]).sort(), (h) => send({ type: "setWidgets", host: h, on: true }), "no-widgetoff");
  renderChips("pairs", g.trustPairs || [], (p) => send({ type: "setGuard", guard: { trustPairs: (g.trustPairs || []).filter((x) => x !== p) } }), "no-pairs", (p) => p.replace(">", "  →  "));
  renderChips("safelist", g.userSafeList || [], (h) => send({ type: "setGuard", guard: { userSafeList: (g.userSafeList || []).filter((x) => x !== h) } }));
  renderChips("senslist", S.sensitiveSites || [], (h) => send({ type: "setSensitiveSites", list: (S.sensitiveSites || []).filter((x) => x !== h) }), "no-sens");
  renderSites();
}
function setSeg(id, v) { document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle("on", b.dataset.v === v)); }
function setRange(id, v, label) { $(id).value = v; $(id + "-o").textContent = label(v); $(id)._label = label; }
function autoMaxHint(v) {
  $("automax-hint").textContent = {
    full: "Auto will never disguise itself. Sites with anti-adblock walls will show them; the popup still offers stealth manually.",
    stealth1: "Only the watched Google scripts are faked. Least intrusive disguise.",
    stealth2: "Recommended. Handles most script, fetch and image checks. Stealth 3 stays a manual choice.",
    stealth3: "Auto may also replace detector libraries. Strongest, slightly more likely to confuse a site. Never on password/card pages."
  }[v];
}
function renderChips(id, items, onRemove, emptyId, label) {
  const ul = $(id); ul.innerHTML = "";
  if (emptyId) $(emptyId).hidden = items.length > 0;
  for (const it of items) {
    ul.append(el("li", {}, label ? label(it) : it,
      el("button", { title: "Remove", html: ico("x"), onclick: async () => { await onRemove(it); saved(); loadAll(); } })));
  }
}

// ---- sites: everything with an explicit mode, an Auto history, or widgets allowed
function levelOf(host) {
  const mode = S.sites[host] || S.defaultMode || "auto";
  if (mode !== "auto") return { mode, level: mode };
  const a = S.autoState[host];
  let level = (a && a.level) || "full";
  const L = ["off", "lite", "full", "stealth1", "stealth2", "stealth3"];
  if (a && a.ceiling && L.indexOf(level) > L.indexOf(a.ceiling)) level = a.ceiling;
  if (L.indexOf(level) > L.indexOf(S.autoMax || "stealth2")) level = S.autoMax || "stealth2";
  return { mode, level, ceiling: a && a.ceiling, trialing: a && a.trialing };
}
function meter(level, ceiling) {
  const m = el("div", { class: "meter" });
  const idx = RUNGS.indexOf(level);
  RUNGS.forEach((r, i) => {
    const seg = el("i", { class: (idx >= i ? "f" : "") + (ceiling === r ? " cap" : ""), title: MODE_LABEL[r] });
    seg.style.setProperty("--mc", RUNG_COLOR[RUNGS[Math.max(0, idx)]] || "#4d9fff");
    m.append(seg);
  });
  m.append(el("em", {}, idx >= 0 ? MODE_LABEL[level] : level === "lite" ? "Lite (no hiding)" : "No protection"));
  return m;
}
function renderSites() {
  const hosts = new Set([...Object.keys(S.sites || {}), ...Object.keys(S.autoState || {}), ...Object.keys(S.widgetOff || {}).filter((h) => S.widgetOff[h]),
    ...Object.keys(S.guardOff || {}).filter((h) => S.guardOff[h])]);
  const box = $("sites"); box.innerHTML = "";
  $("no-sites").hidden = hosts.size > 0;
  for (const host of [...hosts].sort()) {
    const info = levelOf(host);
    const notes = [];
    if (info.mode === "auto") notes.push(info.level.startsWith("stealth") ? "Auto went stealthy here" : "Auto");
    else notes.push("Set by you");
    if (info.ceiling) notes.push("won't go above " + MODE_LABEL[info.ceiling]);
    if (info.trialing) notes.push("testing a lower level");
    if (S.widgetOff[host]) notes.push("pop-ups allowed");
    if ((S.guardOff || {})[host]) notes.push("guard off");
    const sel = el("select", { onchange: async () => { await send({ type: "setMode", host, mode: sel.value }); saved(); loadAll(); } });
    for (const m of MODES) sel.append(el("option", { value: m, ...(m === info.mode ? { selected: "" } : {}) }, MODE_LABEL[m] + (m === "auto" ? " (default)" : "")));
    const right = el("div", {}, el("button", { class: "link", onclick: async () => { await send({ type: "clearSite", host }); toast("Reset " + host); loadAll(); } }, "Reset"));
    box.append(el("div", { class: "site" }, el("div", { class: "h", title: host }, host, el("small", {}, notes.join(" · "))), sel, meter(info.level, info.ceiling), right));
  }
}

// ---- elements you hid (popup picker)
async function showMyHides() {
  const all = (await send({ type: "listMyHides" })) || {};
  const box = $("myhides"); box.innerHTML = "";
  const sites = Object.keys(all).sort();
  if (!sites.length) { box.append(el("p", { class: "hint" }, "Nothing yet.")); return; }
  for (const site of sites) for (const sel of all[site]) {
    const rm = el("button", { class: "ghost", type: "button" }, "Show again");
    rm.addEventListener("click", async () => { await send({ type: "removeMyHide", host: site, selector: sel }); showMyHides(); });
    box.append(el("div", { class: "myhide" }, el("b", {}, site), el("code", {}, sel), rm));
  }
}
chrome.storage.onChanged.addListener((c) => { if (c.myHides) showMyHides(); });
showMyHides();

// ---- automatic list updates
const LIST_NAMES = { security: "Malicious sites", ads: "Ads", privacy: "Trackers" };
function ago(t) {
  if (!t) return "not yet";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 2 ? "just now" : m < 90 ? m + " minutes ago" : m < 36 * 60 ? Math.round(m / 60) + " hours ago" : Math.round(m / 1440) + " days ago";
}
function showListUpdates(st) {
  if (!st) return;
  $("x-listauto").checked = st.auto;
  const kv = $("listupd"); kv.innerHTML = "";
  for (const [cat, c] of Object.entries(st.cats)) {
    const line = c.error ? "Last try failed: " + c.error : "Updated " + ago(c.updated) + (c.updated ? " · " + fmt(c.added) + " newer domains" : "");
    kv.append(el("div", {}, el("b", {}, LIST_NAMES[cat] || cat), el("span", {}, line)));
  }
}
$("x-listauto").addEventListener("change", async (e) => showListUpdates(await send({ type: "listUpdateAuto", on: e.target.checked })));
$("list-update-now").addEventListener("click", async () => {
  const b = $("list-update-now"); b.disabled = true; $("list-update-msg").textContent = "Downloading the latest lists…";
  const st = await send({ type: "listUpdateNow" });
  b.disabled = false; listInfoLoaded = false; loadListInfo();
  const failed = st && Object.values(st.cats).some((c) => c.error);
  $("list-update-msg").textContent = !st ? "Couldn't reach Voidy's background." : failed ? "Some lists couldn't be updated; the previous ones stay in use." : "All lists are up to date.";
  showListUpdates(st);
});
send({ type: "listUpdateStatus" }).then(showListUpdates);

// ---- list info (rule counts)
let listInfoLoaded = false;
async function loadListInfo() {
  if (listInfoLoaded) return;
  const r = await send({ type: "getListInfo" });
  if (!r) return;
  listInfoLoaded = true;
  const l = r.lists || {};
  const n = (x) => fmt(x) + " entries";
  const f = r.fresh || {};
  $("n-ads").textContent = n((r.static.ads || 0) + (f.ads || 0) + (l.ads || 0) + (l.popups || 0) + (l.pgl || 0) + (l.antiadblock || 0));
  $("n-privacy").textContent = n(r.static.privacy + (f.privacy || 0) + (l.easyprivacy || 0));
  $("n-security").textContent = n(r.static.security + (f.security || 0));
  $("n-telemetry").textContent = n(l.telemetry || 0);
  $("n-cos").textContent = "about " + fmt((r.cosmetic || {}).ads || 0) + " hiding rules";
  const kv = $("listinfo"); kv.innerHTML = "";
  const annoyRules = ["cookies", "newsletter", "notifications", "chat", "annoyances", "social"].reduce((s, k) => s + (l[k] || 0) + ((r.cosmetic || {})[k] || 0), 0);
  for (const [v, label] of [[r.static.ads + r.static.privacy + r.static.security, "blocked domains (built-in)"],
    [(f.ads || 0) + (f.privacy || 0) + (f.security || 0), "newer domains from list updates"],
    [Object.values(l).reduce((a, b) => a + b, 0), "extra list entries (paths, pop-ups, telemetry)"], [annoyRules, "pop-up & widget rules"],
    [r.surrogates, "stealth fakes"]]) {
    kv.append(el("div", {}, el("b", {}, fmt(v)), el("span", {}, label)));
  }
  const surr = $("surr"); surr.innerHTML = "";
  for (const [f, to] of [["adsbygoogle.js", "Google AdSense"], ["show_ads.js", "Google AdSense (old)"], ["gpt.js", "Google Ad Manager"],
    ["ad_status.js", "Google IMA video"], ["analytics.js / ga.js", "Google Analytics"], ["gtm.js / gtag", "Google Tag Manager"]]) {
    surr.append(el("li", {}, f, el("span", {}, to)));
  }
  const fo = $("fakeok"); fo.innerHTML = "";
  for (const d of r.fakeSuccess || []) fo.append(el("li", {}, d));
}

// ---- log in plain words
const LOGKIND = {
  lookalike: { g: "guard", ico: "ghost", c: "#f0566f" }, "malware-proceed": { g: "you", ico: "bug", c: "#f0a92b" },
  climb: { g: "stealth", ico: "ghost", c: "#c46cff" }, stuck: { g: "stealth", ico: "radar", c: "#f0a92b" },
  "gentle-retry": { g: "stealth", ico: "down", c: "#3ecf8e" }, "retry-failed": { g: "stealth", ico: "ghost", c: "#f0566f" },
  "retry-kept": { g: "stealth", ico: "star", c: "#3ecf8e" }, broke: { g: "you", ico: "x", c: "#f0a92b" },
  resolve: { g: "you", ico: "star", c: "#4d9fff" }, trust: { g: "guard", ico: "route", c: "#2fc6e0" }
};
function why(sig) {
  if (!sig) return "";
  if (sig === "wall-text") return "a “disable your ad blocker” message appeared";
  if (sig === "known-modal") return "a known anti-adblock pop-up appeared";
  if (String(sig).startsWith("lib:")) return "the page loaded the detector “" + String(sig).slice(4) + "”";
  return "the site detected the blocker";
}
function sentence(e) {
  const L = (x) => MODE_LABEL[x] || x;
  switch (e.kind) {
    case "climb": return [`Went stealthier on ${e.host}: now ${L(e.to)}`, "Because " + why(e.signal) + ". The page reloaded once."];
    case "stuck": return [`${e.host} still detects the blocker at ${L(e.at)}`, "Auto reached its limit and asked you what to do (orange icon)."];
    case "broke": return [`You said ${e.host} broke`, `Stepped down to ${L(e.to)} and won't go higher there.`];
    case "gentle-retry": return [`Testing ${e.host} one level lower (${L(e.to)})`, "It's been quiet for a while, so Voidy is checking whether stealth is still needed."];
    case "retry-failed": return [`${e.host} noticed the lower level`, `Back up to ${L(e.to)}. Voidy will wait longer before trying again.`];
    case "retry-kept": return [`${e.host} is fine at ${L(e.at)}`, "Keeping the lower level."];
    case "resolve": return [`You chose “${{ wall: "Accept the wall", off: "Turn off here", stealth3: "Max stealth" }[e.choice] || e.choice}” for ${e.host}`, ""];
    case "lookalike": return [`Warned you about ${e.host}`, `It looked like ${e.brand} but isn't.`];
    case "malware-proceed": return [`You continued to ${e.host}`, "It's on the dangerous-site list; allowed until the browser closes."];
    case "trust": return [`You chose Always allow for ${String(e.host).replace(">", " → ")}`, "Redirects between these sites won't ask again."];
    default: return [e.kind + " " + (e.host || ""), ""];
  }
}
// ---- dashboard side column: protection check, recent activity, tips
const TIPS = [
  "Right-click any ad and pick <b>Hide this with Voidy</b> to make it disappear on that site for good.",
  "Voidy has seven eye styles. Try them under <b>Appearance</b> or the ✦ button in the popup.",
  "A site says “turn off your ad blocker”? Pick <b>Auto</b> and Voidy goes stealthier only where it's needed.",
  "<b>Script &amp; connection controls</b> in the popup can block outside scripts, embeds and live connections on one site.",
  "Voidy warns you about look-alike sites such as “paypa1.com” before you type a password.",
  "Block lists refresh themselves: the dangerous-site list daily, ads and trackers every few days.",
  "Double-click Voidy in the popup. It likes you back.",
  "A site looks broken? “Site looks broken? Ease off here” in the popup steps Voidy down one level on that site only.",
];
let tipAt = Math.floor(Math.random() * TIPS.length);
function showTip() { $("tip").innerHTML = TIPS[tipAt % TIPS.length]; }   // our own fixed text
async function loadProtectionCheck() {
  const S2 = await send({ type: "getSettings" }), upd = await send({ type: "listUpdateStatus" });
  if (!S2) return;
  const f = S2.filters || {}, g = S2.guard || {}, x = S2.extraPrivacy || {};
  const cats = upd ? Object.values(upd.cats) : [], failed = cats.some((c) => c.error), waiting = cats.some((c) => !c.updated);
  const fresh = upd && upd.auto && !failed && cats.every((c) => !c.updated || Date.now() - c.updated < 8 * 86400e3);
  const listNote = !upd || !upd.auto ? "Automatic updates are off" : failed ? "The last update failed; it will retry" : waiting ? "First update in a few minutes" : "Refreshing automatically";
  const strict = Object.keys(S2.siteControls || {}).length;
  const rows = [
    [f.ads, "Ads blocked", "EasyList and HaGeZi lists", "filters"],
    [f.privacy, "Trackers blocked", "EasyPrivacy and HaGeZi lists", "filters"],
    [S2.gpc !== false, "Global Privacy Control", "Tells sites not to sell or share your data", "privacy"],
    [f.security && g.malwarePage !== false, "Dangerous-site warnings", "Malware, phishing and scam sites", "guard"],
    [f.security && g.lookalike !== false, "Look-alike site warnings", "Fake “paypa1.com”-style addresses", "guard"],
    [fresh, "Block lists up to date", listNote, "filters"],
    [g.enabled !== false, "Redirect Guard", "Surprise redirects and pop-ups held", "guard"],
    [!!x.webrtc, "WebRTC IP protection", "Stops video-call features revealing your IP", "privacy"],
    [!!x.cookies, "Third-party cookies blocked", "Browser-wide; can log you out of some embeds", "privacy"],
    [strict > 0, "Strict script controls", strict ? `On for ${strict} site${strict > 1 ? "s" : ""}` : "Optional, per site in the popup", null],
  ];
  const ul = $("pcheck"); if (!ul) return; ul.innerHTML = "";
  for (const [on, name, sub, panel] of rows) {
    const li = el("li", { class: on ? "on" : "off", title: panel ? "Open settings" : "" },
      el("span", { class: "dot" }, on ? "✓" : ""), el("div", {}, el("b", {}, name), el("small", {}, sub)),
      panel && !on ? el("span", { class: "go" }, "Turn on") : null);
    if (panel) li.addEventListener("click", () => show(panel));
    ul.append(li);
  }
  $("pc-score").textContent = rows.filter((r) => r[0]).length + " / " + rows.length + " on";
  const r = await send({ type: "getLog" }), log = ((r && r.log) || []).slice(-5).reverse(), ml = $("mini-log");
  if (!ml) return;
  ml.innerHTML = ""; $("mini-log-empty").hidden = log.length > 0;
  for (const e of log) {
    const k = LOGKIND[e.kind] || { ico: "list", c: "#8fa3c7" }, [main] = sentence(e);
    ml.append(el("li", {}, el("i", { html: ico(k.ico), style: { "--c": k.c } }),
      el("div", {}, main, el("small", {}, new Date(e.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })))));
  }
}
$("tip-next").addEventListener("click", () => { tipAt++; showTip(); });
showTip();
chrome.storage.onChanged.addListener((c) => { if (c.filters || c.guard || c.extraPrivacy || c.siteControls || c.log || c.listUpdates || c.gpc) loadProtectionCheck(); });

let logFilter = "all";
async function loadLog() {
  const r = await send({ type: "getLog" });
  const log = ((r && r.log) || []).slice().reverse().filter((e) => logFilter === "all" || (LOGKIND[e.kind] || {}).g === logFilter);
  const ul = $("log"); ul.innerHTML = "";
  $("no-log").hidden = log.length > 0;
  for (const e of log) {
    const k = LOGKIND[e.kind] || { ico: "list", c: "#8fa3c7" };
    const [main, sub] = sentence(e);
    ul.append(el("li", {}, el("i", { html: ico(k.ico), style: { "--c": k.c } }), el("div", { class: "m" }, main, sub ? el("small", {}, sub) : null),
      el("span", { class: "t" }, new Date(e.t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))));
  }
}

// ============================================================ wiring
function wire() {
  const pushFilters = () => send({ type: "setFilters", filters: { ads: $("f-ads").checked, privacy: $("f-privacy").checked, security: $("f-security").checked, telemetry: $("f-telemetry").checked } }).then(saved);
  ["f-ads", "f-privacy", "f-security", "f-telemetry"].forEach((id) => $(id).addEventListener("change", pushFilters));

  const pushAnnoy = () => {
    const annoy = {}; for (const c of ANNOY) annoy[c] = $("a-" + c).checked;
    $("cookie-mode").classList.toggle("off-dim", !annoy.cookies);
    send({ type: "setAnnoy", annoy, cookieMode: $("a-cookiereject").checked ? "reject" : "hide", adsCosmetic: $("a-adscos").checked }).then(saved);
  };
  [...ANNOY.map((c) => "a-" + c), "a-cookiereject", "a-adscos"].forEach((id) => $(id).addEventListener("change", pushAnnoy));

  const adv = (patch) => send({ type: "setAdvanced", advanced: patch }).then(() => { saved(); loadAll(); });
  $("x-rescue").addEventListener("change", (e) => adv({ rescue: e.target.checked }));
  $("x-detectlibs").addEventListener("change", (e) => adv({ detectLibs: e.target.checked }));
  $("x-badge").addEventListener("change", (e) => adv({ badge: e.target.checked }));
  $("x-gpc").addEventListener("change", (e) => adv({ gpc: e.target.checked }));
  document.querySelectorAll("#automax button").forEach((b) => b.addEventListener("click", () => { setSeg("automax", b.dataset.v); autoMaxHint(b.dataset.v); adv({ autoMax: b.dataset.v }); }));
  document.querySelectorAll("#swatches button").forEach((b) => b.addEventListener("click", () => {
    setSeg("swatches", b.dataset.v); document.documentElement.setAttribute("data-theme", b.dataset.v); adv({ theme: b.dataset.v });
  }));
  $("apply-colours").addEventListener("click",()=>{
    const customColors={primary:$("custom-primary").value,secondary:$("custom-secondary").value};
    document.documentElement.style.setProperty("--custom-a1",customColors.primary);
    document.documentElement.style.setProperty("--custom-a2",customColors.secondary);
    document.documentElement.setAttribute("data-theme","custom");setSeg("swatches","custom");
    adv({theme:"custom",customColors});
  });
  $("gentle").addEventListener("change", (e) => send({ type: "setGentleRetry", value: e.target.checked }).then(saved));

  const pushGuard = () => send({ type: "setGuard", guard: {
    maxPrompts: +$("g-max").value, timeoutMs: +$("g-timeout").value * 1000,
    popupAfterClick: document.querySelector("#popclick button.on").dataset.v,
    overlayGuard: $("g-overlay").checked, blockTabUnderMs: $("g-tabunder").checked ? 2000 : 0,
    promptForNonHttp: $("g-nonhttp").checked, runOnlyAfterFirstRedirect: $("g-afterfirst").checked,
    enabled: $("g-enabled").checked, action: document.querySelector("#g-action button.on").dataset.v,
    fakePopups: document.querySelector("#g-fake button.on").dataset.v, promptPos: document.querySelector("#g-pos button.on").dataset.v,
    linkPopups: $("g-links").checked, quietAds: $("g-quietads").checked, malwarePage: $("g-malware").checked, lookalike: $("g-lookalike").checked } })
    .then(() => { document.querySelector('[data-panel="guard"]').classList.toggle("guard-off", !$("g-enabled").checked); saved(); });
  for (const id of ["g-max", "g-timeout"]) {
    $(id).addEventListener("input", () => ($(id + "-o").textContent = $(id)._label(+$(id).value)));
    $(id).addEventListener("change", pushGuard);
  }
  document.querySelectorAll("#popclick button").forEach((b) => b.addEventListener("click", () => { setSeg("popclick", b.dataset.v); pushGuard(); }));
  ["g-overlay", "g-tabunder", "g-nonhttp", "g-afterfirst", "g-enabled", "g-links", "g-quietads", "g-malware", "g-lookalike"].forEach((id) => $(id).addEventListener("change", pushGuard));
  for (const seg of ["g-action", "g-fake", "g-pos"])
    document.querySelectorAll(`#${seg} button`).forEach((b) => b.addEventListener("click", () => { setSeg(seg, b.dataset.v); pushGuard(); }));

  const cleanHost = (v) => {
    v = (v || "").trim().toLowerCase();
    try { if (v.includes("/")) v = new URL(v.includes("://") ? v : "http://" + v).hostname; } catch (e) { return ""; }
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(v) ? v : "";
  };
  const addTo = (inputId, fn) => {
    const go = async () => {
      const h = cleanHost($(inputId).value);
      if (!h) { toast("That doesn't look like a site name"); return; }
      await fn(h); $(inputId).value = ""; saved(); loadAll();
    };
    $(inputId).addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    return go;
  };
  $("safe-add").addEventListener("click", addTo("safe-input", (h) => send({ type: "setGuard", guard: { userSafeList: [...new Set([...(S.guard.userSafeList || []), h])] } })));
  $("sens-add").addEventListener("click", addTo("sens-input", (h) => send({ type: "setSensitiveSites", list: [...new Set([...(S.sensitiveSites || []), h])] })));
  for (const m of MODES) $("site-mode").append(el("option", { value: m }, MODE_LABEL[m]));
  $("site-mode").value = "lite";
  $("site-add").addEventListener("click", addTo("site-input", (h) => send({ type: "setMode", host: h, mode: $("site-mode").value })));

  document.querySelectorAll("#logfilter button").forEach((b) => b.addEventListener("click", () => {
    logFilter = b.dataset.k; document.querySelectorAll("#logfilter button").forEach((x) => x.classList.toggle("on", x === b)); loadLog();
  }));
  $("log-clear").addEventListener("click", () => send({ type: "clearLog" }).then(loadLog));
  $("reset-stats").addEventListener("click", async () => {
    if (!confirm("Reset all statistics to zero? Settings are kept.")) return;
    await send({ type: "resetStats" }); toast("Statistics reset"); loadStats();
  });

  $("export").addEventListener("click", async () => {
    const r = await send({ type: "exportSettings" });
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" }));
    el("a", { href: url, download: "voidy-settings.json" }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $("import-btn").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = async () => {
      try { const r = await send({ type: "importSettings", data: JSON.parse(rd.result) }); toast(r && r.ok ? r.warning ? "Imported. Review Advanced privacy: some browser settings could not apply." : "Imported" : "Import failed"); loadAll(); privacyControls.refresh(); }
      catch (err) { toast("Not a valid settings file"); }
      $("import-file").value = "";
    };
    rd.readAsText(f);
  });
  $("reset").addEventListener("click", async () => {
    if (!confirm("Reset all Voidy settings to defaults? (Statistics are kept.)")) return;
    await send({ type: "reset" }); toast("Settings reset"); loadAll(); privacyControls.refresh();
  });
}

wire();
$("build-version").textContent="v"+chrome.runtime.getManifest().version;
const privacyControls=VOIDY_PRIVACY.mount($("privacy-panel"),{expanded:true});
privacyControls.refresh();
$("privacy-site-form").addEventListener("submit",async event=>{
  event.preventDefault();let host;
  try{const value=$("privacy-site").value.trim();const url=new URL(value.includes("://")?value:"https://"+value);host=url.hostname;if(!/^https?:$/.test(url.protocol)||!host.includes("."))throw Error();}catch(_){toast("Enter a valid website domain or URL");return;}
  const state=await send({type:"getPopup",host});privacyControls.setContext(host,state.level);privacyControls.render(state.extraPrivacy,state.level);
});
loadAll().then(() => show(location.hash.slice(1) || "dash"));
loadProtectionCheck();

// ---- Voidy on the dashboard: sidebar logo, dashboard hero, Appearance ----
VOIDY_MASCOT.mount($("side-voidy"), { mini: true });
VOIDY_LIFE.attach(VOIDY_MASCOT.mount($("dash-voidy")), { mood: () => "happy" });
VOIDY_MASCOT.mount($("look-voidy"));
document.querySelectorAll("[data-form-preview]").forEach((el) => VOIDY_MASCOT.mount(el, { form: el.dataset.formPreview }));
document.querySelectorAll("#form-seg button").forEach((b) => b.addEventListener("click", () => chrome.storage.local.set({ voidyForm: b.dataset.v })));
for (const [v, name] of VOIDY_MASCOT.EYES) {
  const b = document.createElement("button");
  b.dataset.v = v; b.innerHTML = VOIDY_MASCOT.eyePreview(v) + name;
  b.addEventListener("click", () => chrome.storage.local.set({ voidyEyes: v }));
  $("eye-seg").appendChild(b);
}
document.querySelectorAll("#acc-seg button").forEach((b) => b.addEventListener("click", () => chrome.storage.local.set({ voidyAccessory: b.dataset.v })));
$("x-motion").addEventListener("change", (e) => chrome.storage.local.set({ voidyMotion: e.target.checked }));
function showVoidyPrefs() {
  chrome.storage.local.get({ voidyForm: "blackhole", voidyAccessory: "none", voidyEyes: "shiny", voidyMotion: true }, (s) => {
    setSeg("eye-seg", s.voidyEyes); setSeg("acc-seg", s.voidyAccessory); setSeg("form-seg", s.voidyForm); $("x-motion").checked = s.voidyMotion !== false;
  });
}
chrome.storage.onChanged.addListener((c) => { if (c.voidyForm || c.voidyAccessory || c.voidyEyes || c.voidyMotion) showVoidyPrefs(); });
showVoidyPrefs();
VOIDY_ICONS.fill();
