// Popup: protection controls + a local activity view (donut grouped by
// blocking category, expandable category -> known company labels). All numbers come from
// background.js's "getPopup" response; nothing here counts anything itself.
const $ = (id) => document.getElementById(id);
const DONATE_URL = "https://buymeacoffee.com/FrozenCodeZ";
const FEEDBACK_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdnOw3Pi8i2pA7U8xYF5TbeR8ogY5amwuTUmn8jpnRejN-NTA/viewform";
const FILE_BUILD_VERSION = "1.0.2";
const ORDER = ["off", "lite", "full"];
const LADDER = ["off", "lite", "full", "stealth1", "stealth2", "stealth3"];  // mirrors background.js's ladder
const HINTS = {
  auto: "Starts in Full and adds stealth only if a site fights back.",
  full: "Blocks ads, hides ad boxes, holds surprise redirects.",
  lite: "Blocks ads only. Gentlest on fragile sites.",
  off: "No protection on this site.",
  stealth1: "Auto stealth: watched ad scripts are swapped for harmless fakes.",
  stealth2: "Auto stealth: harmless fakes, plus empty \"OK\" answers to ad checks.",
  stealth3: "Max stealth: also switches off common ad-block detectors."
};
function stateText(mode, level) {
  if (mode === "off") return "Off";
  if (mode === "auto") {
    if (level === "off") return "Off (you said this site broke)";
    if (level === "lite") return "Protected (Auto, gentle)";
    return level && level.startsWith("stealth") ? "Protected (stealth on)" : "Protected (Auto)";
  }
  if (mode === "lite") return "Protected (Lite)";
  if (mode === "stealth3") return "Protected (Max stealth)";
  if (mode === "stealth1" || mode === "stealth2") return "Protected (Stealth " + mode.slice(-1) + ")";
  return "Protected";
}

const R = 52;
const CIRC = 2 * Math.PI * R;
let host = "", tabId = null, data = null, scope = "page";
let privacyControls;
let ytRefreshInFlight = null;
const openCats = new Set();
const isYouTube = () => /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/.test(host);

function renderYouTubeDetails(r) {
  const loadedVersion = chrome.runtime.getManifest().version;
  const filesChanged = loadedVersion !== FILE_BUILD_VERSION;
  $("yt-diagnostics").hidden = !isYouTube();
  $("yt-build-warning").hidden = !isYouTube() || !filesChanged;
  if (!isYouTube()) return;
  // Voidy's files on disk are newer than the copy Chrome is running (a tab
  // refresh doesn't fix that; reloading Voidy does).
  if (filesChanged) {
    const w = $("yt-build-warning");
    w.textContent = `Voidy was updated (running ${loadedVersion}, files ${FILE_BUILD_VERSION}). Reload Voidy, then refresh this YouTube tab. `;
    const b = document.createElement("button");
    b.className = "ghost"; b.type = "button"; b.textContent = "Reload Voidy now";
    b.addEventListener("click", () => chrome.runtime.reload());
    w.append(b);
  }
  $("yt-diagnostics").querySelector("summary").textContent = "YouTube startup details";
  $("yt-diagnostic-status").textContent = !r.ytStartup ? "Waiting for a YouTube video. Refresh its tab, then reopen this popup."
    : r.ytStartup.firstContentFrameMs == null ? "Still loading. Press Copy after the video starts to fetch the latest timing."
    : "Content started after " + (r.ytStartup.firstContentFrameMs / 1000).toFixed(1) + " seconds." + adPlanNote(r.ytPlayerFields)
      + (filesChanged ? " (Measured with the older copy of Voidy.)" : "");
  $("yt-copy").textContent = "Copy latest details";
  $("yt-timing").textContent = r.ytStartup ? JSON.stringify({version:loadedVersion,filesVersion:FILE_BUILD_VERSION,mode:r.mode,level:r.level,...r.ytStartup,matchedRules:r.ytMatches,playerFields:r.ytPlayerFields},null,2)
    : "Refresh the video once, then reopen this popup to see startup timings.";
}

// Whether YouTube's own page data scheduled an ad slot for this video. Shown
// with the startup timings, because slow starts can line up with "yes".
function adPlanNote(fields) {
  if (!fields || !fields.initialPresent) return "";
  let note = " YouTube planned an ad: " + ((fields.initialAdKeys || []).includes("adSlots") ? "yes." : "no.");
  // Did any ad entries survive our cleaning in a copy the player can read?
  const copies = Object.entries(fields.adData || {}).filter(([, c]) => c && typeof c === "object");
  const leaks = copies.filter(([, c]) => Object.values(c).some(n => typeof n === "number" && n > 0)).map(([name]) => name);
  if (copies.length) note += leaks.length ? " Ad data still reaches: " + leaks.join(", ") + "." : " Ad data reaching the player: none.";
  return note;
}
function refreshYouTubeDetails() {
  if (!isYouTube() || !Number.isInteger(tabId)) return Promise.resolve();
  if (ytRefreshInFlight) return ytRefreshInFlight;
  ytRefreshInFlight = chrome.runtime.sendMessage({type:"getPopup",host,tabId,includeYtFields:true})
    .then(r => { if (r) renderYouTubeDetails(r); })
    .catch(() => {})
    .finally(() => { ytRefreshInFlight = null; });
  return ytRefreshInFlight;
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab ? tab.id : null;
  try { const url=new URL(tab?.url); host=/^https?:$/.test(url.protocol) ? url.hostname : ""; } catch (e) { host = ""; }
  wireStaticControls();
  privacyControls=VOIDY_PRIVACY.mount($("extra-privacy"),{host,level:"off",reload:()=>chrome.tabs.reload(tabId)});
  if (!host) { $("host").textContent = "unsupported page"; disableAll(); renderExtraPrivacy(await chrome.runtime.sendMessage({type:"getExtraPrivacy"}),"off"); return; }
  $("host").textContent = host; $("host").title = host;

  refresh();
}
// Ask the background what's TRUE now and draw that, never the popup's own guess.
function refresh() {
  chrome.runtime.sendMessage({ type: "getPopup", host, tabId, includeYtFields:isYouTube() }, async (r) => {
    if (!r) return;
    data = r;
    data.page = await livePageCounts(r);         // page totals straight from Chrome (rate-limit safe)
    renderProtect(r.mode, r.level);
    renderAdvanced(r.mode, r.level);
    renderStuck(r.stuck, r.level);
    renderAccepted(r.accepted);
    renderWidgets(r.widgets, r.mode, r.level);
    renderGuard(r.guard, r.guardEnabled, r.mode, r.level);
    renderExtraPrivacy(r.extraPrivacy, r.level);
    renderYouTubeDetails(r);
    renderActivity();
    checkOffWall(r.mode, r.level);
  });
}

// This page's blocked counts, asked of Chrome directly from the popup (the same
// call is rate-limited when the background makes it). Falls back to the
// background's own count of blocked requests on this page.
async function livePageCounts(r) {
  const out = { ads: 0, privacy: 0, security: 0, annoyNet: 0 };
  const cat = (id) => {
    if (id >= 50000 && id < 51000 || id === 59000) return "privacy";
    for (const [a, b, c] of r.listRanges || []) if (id >= a && id <= b)
      return c && c.startsWith("retired-") ? null
        : (c === "telemetry" || c === "supplementalPrivacy" || c === "easyprivacy") ? "privacy"
        : c === "supplementalSecurity" ? "security"
        : ["ads","popups","pgl","antiadblock","supplementalAds"].includes(c) ? "ads" : "annoyNet";
    return null;
  };
  // Static rulesets map directly to their displayed category.
  const rsCat = r.rulesetCats || { ads: "ads", privacy: "privacy", security: "security" };
  try {
    const m = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    for (const x of m.rulesMatchedInfo) {
      const rs = x.rule.rulesetId;
      if (rsCat[rs]) out[rsCat[rs]]++;
      else if (rs === "_dynamic") { const c = cat(x.rule.ruleId); if (c) out[c]++; }
    }
    // Chrome only remembers the last 5 minutes of matches; a page left open for
    // long (a chat app, a dashboard) blocked more than that. The background counts
    // the whole visit (the same number as the toolbar badge): never show less.
    const sum = out.ads + out.privacy + out.security, blocked = r.blocked || 0;
    if (blocked > sum) out.ads += blocked - sum;
    return out;
  } catch (e) {
    const fb = r.page || out;
    const sum = (fb.ads || 0) + (fb.privacy || 0) + (fb.security || 0);
    const blocked = r.blocked || 0;
    return blocked > sum ? { ...fb, ads: (fb.ads || 0) + (blocked - sum) } : fb;
  }
}

function disableAll() {
  document.body.classList.add("no-site");
  VOIDY.setMood("idle"); VOIDY.say("Voidy only eats on regular websites.<br><small>Open any site to see what it's eating.</small>");
  $("power").disabled = true;
  document.querySelectorAll(".modes button").forEach((b) => (b.disabled = true));
  $("broke").disabled = true; $("report").disabled = true; $("widgets").disabled = true; $("guard").disabled = true; $("pick").disabled = true;
  $("site-controls").hidden = true;
  $("adv-toggle").disabled = true; $("wallnow").hidden = true;
  $("state").textContent = "";
  $("hint").textContent = "Open a regular website to see protection controls.";
  $("pulse").classList.add("off");
  $("dash").addEventListener("click", openOptions);
}

// ---- protection ------------------------------------------------------------
function renderProtect(mode, level) {
  const lvl = mode === "auto" ? level : mode;
  const box = $("protect");
  box.classList.toggle("is-off", mode === "off" || lvl === "off");
  box.classList.toggle("is-lite", lvl === "lite");
  box.classList.toggle("is-stealth", !!(lvl && lvl.startsWith("stealth")));
  renderDisguise(mode, lvl);
  $("power").checked = mode !== "off";
  $("state").textContent = stateText(mode, level);
  $("hint").textContent = (mode === "auto" && level && level !== "full" ? HINTS[level] : HINTS[mode]) || HINTS.auto;
  $("pulse").classList.toggle("off", mode === "off");
  VOIDY.setMood(voidyMood(mode, lvl));
  document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
}
// Stealth meter: how much Auto (or you) is disguising the blocker on this site.
function renderDisguise(mode, lvl) {
  const n = { stealth1: 1, stealth2: 2, stealth3: 3 }[lvl] || 0;
  document.querySelectorAll("#dg-meter i").forEach((el, i) => { el.className = i < n ? "f" + n : ""; });
  let text;
  if (mode === "off" || lvl === "off") text = "off";
  else if (n) text = ["", "level 1 · fake ad scripts", "level 2 · fake 'ok' to ad probes", "level 3 · detectors neutralized"][n];
  else if (lvl === "lite") text = "not used in Lite";
  else if (mode === "auto") text = data && data.autoMax === "full" ? "turned off in settings" : "not needed yet";
  else text = "off in Full";
  $("dg-text").textContent = text;
}
function renderWidgets(on, mode, level) {
  const box = $("widgets");
  box.checked = !!on;
  const inert = mode === "off" || mode === "lite" || level === "off" || level === "lite";
  box.disabled = inert;
  $("widgets-row").classList.toggle("inert", inert);
}
// Per-site Redirect Guard switch. Inert when the whole site is Off (nothing
// runs there) or when the Guard's master switch is off in settings.
function renderGuard(on, enabled, mode, level) {
  const box = $("guard");
  const siteOff = mode === "off" || level === "off";
  box.checked = !!on && !siteOff;
  box.disabled = siteOff || !enabled;
  $("guard-row").classList.toggle("inert", box.disabled);
  $("guard-label").textContent = enabled ? "Guard redirects & pop-ups on this site" : "Redirect Guard is off in settings";
}
function renderStuck(stuck, level) {
  $("stuck").hidden = !stuck;
  // "Max stealth" when Auto is already AT max stealth would change nothing.
  const max = document.querySelector('#stuck button[data-choice="stealth3"]');
  if (max) max.hidden = level === "stealth3";
}
function renderAccepted(accepted) {
  $("accepted").hidden = !accepted;
}
// Off here, yet the site still shows an ad-block wall? Then it isn't us. Ask
// the page for one look-only check (see detector.js) and say so plainly.
function checkOffWall(mode, level, retry = true) {
  if (retry) $("offwall").hidden = true;
  if (!(mode === "off" || level === "off") || tabId == null) return;
  try {
    chrome.tabs.sendMessage(tabId, { type: "voidyWallCheck" }, { frameId: 0 }, (r) => {
      void chrome.runtime.lastError;               // no content script (page loaded before install): stay quiet
      if (r && r.wall) { $("offwall").hidden = false; return; }
      // Just switched to Off: the tab is reloading, and the old page (not Off
      // when it loaded) doesn't answer. Look once more when the new one is up.
      if (retry) setTimeout(() => checkOffWall(mode, level, false), 2000);
    });
  } catch (e) {}
}
// The "go stealthier" button climbs the ladder by one step without leaving
// Auto (see manualClimb in background.js).
function renderAdvanced(mode, level) {
  const idx = LADDER.indexOf(level);
  const maxIdx = LADDER.indexOf("stealth3");
  const canClimb = mode !== "off" && idx >= 0 && idx < maxIdx;
  $("wallnow").hidden = !canClimb;
}
// Which face Voidy makes for the current protection level.
function voidyMood(mode, lvl) {
  if (mode === "off" || lvl === "off") return "off";
  if (lvl === "lite") return "lite";
  if (["stealth1", "stealth2", "stealth3"].includes(lvl)) return lvl;
  return "happy";
}
function voidyCaption() {
  const lvl = data.mode === "auto" ? data.level : data.mode;
  const mood = voidyMood(data.mode, lvl), n = pageBlockTotal();
  if (mood === "off") return "Zzz… Voidy is napping on this site.";
  const ate = n ? `Nom! Ate <b>${n.toLocaleString()}</b> thing${n === 1 ? "" : "s"} on this page.` : "All clear. Nothing to eat here yet.";
  if (mood === "stealth1") return "Shades on. " + ate;
  if (mood === "stealth2") return "Cloaked. " + ate;
  if (mood === "stealth3") return n ? `Past the event horizon. <b>${n.toLocaleString()}</b> eaten, unseen.` : "Past the event horizon. Nothing to eat yet.";
  if (mood === "lite") return n ? `Light snack: <b>${n.toLocaleString()}</b> ad${n === 1 ? "" : "s"} eaten.` : "Light snacking. Nothing here yet.";
  return ate;
}
function setMode(mode) {
  VOIDY.gulp();
  // Say at once that the click landed (applying a mode can take a second:
  // Chrome rebuilds the site's rules first) — but draw the RESULT only from
  // what the background reports afterwards (no guessing).
  $("stuck").hidden = true; $("accepted").hidden = true; $("offwall").hidden = true;
  document.querySelectorAll(".modes button").forEach((b) => b.classList.toggle("pending", b.dataset.mode === mode));
  $("hint").textContent = "Switching…";
  chrome.runtime.sendMessage({ type: "setMode", host, mode }, () => {
    document.querySelectorAll(".modes button.pending").forEach((b) => b.classList.remove("pending"));
    chrome.tabs.reload();
    refresh();
  });
}
function stepDown() {
  if (data && data.mode === "auto") { chrome.runtime.sendMessage({ type: "brokeAuto", host, tabId }, () => window.close()); return; }
  const cur = document.querySelector("#modes button.active");
  const idx = cur ? ORDER.indexOf(cur.dataset.mode) : ORDER.length - 1;
  setMode(ORDER[Math.max(0, idx - 1)]);
}
// A short, private-by-design report: the site, Voidy's mode and the NAMES of
// sites blocked on this page (no full addresses, no page content).
async function copyReport() {
  const r = data || {};
  const top = (r.pageTop || []).map((d) => `  ${d.domain} (${d.catName || d.ourCat}, ${d.count}×)`).join("\n") || "  (nothing blocked on this page)";
  const text = [`Site: ${host}`, `Voidy ${chrome.runtime.getManifest().version} · mode ${r.mode || "?"} (running as ${r.level || "?"})`,
    `Browser: ${(((ua) => ua.match(/Firefox\/[\d.]+/) || ua.match(/Edg\/[\d.]+/) || ua.match(/OPR\/[\d.]+/) || ua.match(/Chrome\/[\d.]+/))(navigator.userAgent) || ["unknown"])[0]}`, "Blocked on this page:", top, "", "What went wrong (please describe):", ""].join("\n");
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (_) {}
  const note = $("report-note");
  note.hidden = false;
  note.textContent = copied ? "Report copied. Paste it into the feedback form that just opened. It only lists site names, nothing you typed or read."
    : "Couldn't copy automatically. The feedback form is open; tell us the site and what went wrong.";
  if (FEEDBACK_URL) chrome.tabs.create({ url: FEEDBACK_URL });
}
function resolveStuck(choice) {
  chrome.runtime.sendMessage({ type: "resolveStuck", host, tabId, choice }, () => {
    if (choice === "wall") { refresh(); return; }   // stay open: show that it took
    chrome.tabs.reload(); window.close();
  });
}
function goStealthier() {
  $("wallnow").disabled = true;
  chrome.runtime.sendMessage({ type: "manualClimb", host, tabId }, (r) => {
    $("wallnow").disabled = false;
    if (r && r.ok) refresh();   // Avoid attaching duplicate click handlers on every climb.
  });
}
function toggleAdvanced() {
  const opening = $("adv").hidden;
  $("adv").hidden = !opening;
  $("adv-toggle").setAttribute("aria-expanded", String(opening));
  $("adv-toggle").classList.toggle("open", opening);
}
function renderExtraPrivacy(settings={},level) {
  privacyControls.render(settings,level);
}

// ---- activity -------------------------------------------------------------
function currentCats() {
  if (!data) return [];
  if (scope === "page") return data.pageCats || [];
  return (data.lifetime && data.lifetime.cats) || [];
}
function pageBlockTotal() {
  const p = data.page || {};
  return (p.ads || 0) + (p.privacy || 0) + (p.security || 0) + (p.annoyNet || 0);
}
function lifeBlockTotal() {
  const t = (data.lifetime && data.lifetime.totals) || {};
  return (t.ads || 0) + (t.privacy || 0) + (t.security || 0) + (t.annoy || 0);
}

function renderActivity() {
  if (!data) return;
  document.querySelectorAll(".scope button").forEach((b) => b.classList.toggle("on", b.dataset.scope === scope));

  const cats = currentCats();
  const catSum = cats.reduce((s, c) => s + c.count, 0);
  const headline = scope === "page" ? pageBlockTotal() : lifeBlockTotal();
  const total = Math.max(headline, catSum);      // headline counts everything; cats only what we could label

  $("total").textContent = total.toLocaleString();
  VOIDY.feed(pageBlockTotal());
  $("voidy-says").innerHTML = voidyCaption();
  $("total-label").textContent = "eaten";
  drawRing(cats, catSum, total);
  renderCatList(cats, total, catSum);

  const lt = (data.lifetime && data.lifetime.totals) || {};
  $("hidden").textContent = ((scope === "all" ? lt.hidden : data.hidden) || 0).toLocaleString();
  $("annoy").textContent = ((scope === "all" ? lt.annoy : (data.annoy || 0) + ((data.page && data.page.annoyNet) || 0)) || 0).toLocaleString();
  $("held").textContent = ((scope === "all" ? lt.held : data.held) || 0).toLocaleString();

  $("since").textContent = scope === "all" && data.lifetime && data.lifetime.since
    ? "Since " + new Date(data.lifetime.since).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
}

function drawRing(cats, catSum, total) {
  const g = $("segs"); g.innerHTML = "";
  if (!total) return;
  const gap = cats.length > 1 ? 3 : 0;
  let offset = 0;
  const draw = (frac, color) => {
    const len = frac * CIRC;
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("class", "seg"); c.setAttribute("cx", "60"); c.setAttribute("cy", "60"); c.setAttribute("r", String(R));
    c.setAttribute("stroke", color);
    c.setAttribute("stroke-dasharray", `${Math.max(0, len - gap)} ${CIRC - Math.max(0, len - gap)}`);
    c.setAttribute("stroke-dashoffset", String(-offset));
    g.appendChild(c); offset += len;
  };
  for (const c of cats) draw(c.count / total, c.color);
  if (catSum < total) draw((total - catSum) / total, "#3a4152");   // unlabelled remainder, muted
}

function renderCatList(cats, total, catSum) {
  const ul = $("catlist"); ul.innerHTML = "";
  const empty = !total;
  $("act-empty").hidden = !empty;
  if (empty) {
    $("act-empty").textContent = scope === "all"
      ? "Nothing blocked yet."
      : "Nothing blocked on this page yet.";
    return;
  }
  for (const c of cats) {
    const li = document.createElement("li");
    li.className = "cat" + (openCats.has(c.slug) ? " open" : "");
    const row = document.createElement("div"); row.className = "cat-row";
    const dot = document.createElement("span"); dot.className = "cat-dot"; dot.style.background = c.color; dot.style.color = c.color;
    const name = document.createElement("span"); name.className = "cat-name"; name.textContent = c.name;
    const count = document.createElement("span"); count.className = "cat-count"; count.textContent = c.count.toLocaleString();
    const caret = document.createElement("span"); caret.className = "cat-caret"; caret.textContent = c.items && c.items.length ? "▶" : "";
    row.append(dot, name, count, caret);
    li.appendChild(row);
    if (c.items && c.items.length) {
      const items = document.createElement("ul"); items.className = "cat-items";
      for (const it of c.items) {
        const item = document.createElement("li"); item.className = "cat-item";
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = it.name;
        const ct = document.createElement("span"); ct.className = "ct"; ct.textContent = it.count.toLocaleString();
        item.append(nm, ct); items.appendChild(item);
      }
      li.appendChild(items);
      row.addEventListener("click", () => {
        if (openCats.has(c.slug)) openCats.delete(c.slug); else openCats.add(c.slug);
        li.classList.toggle("open");
      });
    }
    ul.appendChild(li);
  }
  if (catSum < total) {
    const li = document.createElement("li"); li.className = "cat";
    const row = document.createElement("div"); row.className = "cat-row"; row.style.cursor = "default";
    const dot = document.createElement("span"); dot.className = "cat-dot"; dot.style.background = "#3a4152"; dot.style.color = "transparent";
    const name = document.createElement("span"); name.className = "cat-name"; name.style.color = "var(--ink-3)"; name.textContent = "Other";
    const count = document.createElement("span"); count.className = "cat-count"; count.style.color = "var(--ink-3)"; count.textContent = (total - catSum).toLocaleString();
    row.append(dot, name, count); li.appendChild(row); ul.appendChild(li);
  }
}

// ---- hide something on this page (src/picker.js) ---------------------------
async function startPicker() {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/picker.js"] });
    window.close();
  } catch (e) { VOIDY.say("Voidy can't reach into this page.<br><small>Browsers block extensions on some pages.</small>"); }
}
// ---- per-site script & connection controls --------------------------------
function showSiteControls() {
  if (!host) return;
  const boxes = document.querySelectorAll("[data-sc]");
  chrome.runtime.sendMessage({ type: "getSiteControls", host }, (c) => {
    c = c || {};
    let n = 0;
    for (const b of boxes) { b.checked = !!c[b.dataset.sc]; if (b.checked) n++; }
    $("sc-on").hidden = !n; $("sc-on").textContent = n + " on";
    if (n) $("site-controls").open = true;
  });
  for (const b of boxes) b.onchange = () => {
    const controls = {};
    for (const x of boxes) controls[x.dataset.sc] = x.checked;
    chrome.runtime.sendMessage({ type: "setSiteControls", host, controls }, () => { showSiteControls(); chrome.tabs.reload(tabId); });
  };
}
function showMyHides() {
  if (!host) return;
  chrome.runtime.sendMessage({ type: "listMyHides" }, (all) => {
    const n = ((all || {})[host] || []).length;
    $("unhide").hidden = !n;
    $("unhide-text").textContent = n === 1 ? "Show the 1 item I hid here" : `Show the ${n} items I hid here`;
  });
}
function openOptions(e) { if (e) e.preventDefault(); chrome.runtime.openOptionsPage(); }
function wireStaticControls() {
  $("power").addEventListener("change", (e) => setMode(e.target.checked ? "auto" : "off"));
  document.querySelectorAll(".modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll("#stuck .stuck-btns button").forEach((b) => b.addEventListener("click", () => resolveStuck(b.dataset.choice)));

  document.querySelectorAll(".scope button").forEach((b) => b.addEventListener("click", () => { scope = b.dataset.scope; renderActivity(); }));
  $("widgets").addEventListener("change", (e) => chrome.runtime.sendMessage({ type: "setWidgets", host, on: e.target.checked }, () => chrome.tabs.reload()));
  $("guard").addEventListener("change", (e) => chrome.runtime.sendMessage({ type: "setGuardSite", host, on: e.target.checked }, () => chrome.tabs.reload()));
  $("broke").addEventListener("click", stepDown);
  $("report").addEventListener("click", copyReport);
  $("pick").addEventListener("click", startPicker);
  $("unhide").addEventListener("click", () => chrome.runtime.sendMessage({ type: "removeMyHide", host, all: true }, () => { $("unhide").hidden = true; chrome.tabs.reload(tabId); }));
  showMyHides();
  showSiteControls();
  $("dash").addEventListener("click", openOptions);
  $("adv-toggle").addEventListener("click", toggleAdvanced);
  $("wallnow").addEventListener("click", goStealthier);
  if (DONATE_URL) { $("donate").href = DONATE_URL; $("donate").hidden = false; }
  if (FEEDBACK_URL) { $("feedback").href = FEEDBACK_URL; $("feedback").hidden = false; }
  // Mini Voidy sipping coffee in the support card; a heart burst on click.
  // It sips from its own mug every few seconds (the "coffee" act).
  const sipper = VOIDY_MASCOT.mount($("support-voidy"), { mini: true });
  setInterval(() => {
    if (document.documentElement.classList.contains("still")) return;
    sipper.classList.add("act-coffee"); setTimeout(() => sipper.classList.remove("act-coffee"), 3400);
  }, 5200);
  $("donate").addEventListener("click", () => $("support").classList.add("thanks"));
  $("yt-copy").addEventListener("click",async()=>{try{await refreshYouTubeDetails();await navigator.clipboard.writeText($("yt-timing").textContent);$("yt-copy-status").textContent=" Copied";}catch(_){$("yt-copy-status").textContent=" Select and copy the text above.";}});
}
load();
