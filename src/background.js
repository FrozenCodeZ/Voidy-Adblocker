// Voidy background service worker.
//
// Owns every setting and all network blocking:
//   - Chrome's built-in blocking rules: the bundled ad, tracker and malware lists
//     (rules/*.json), list rules that can be switched off per site
//     (data/netrules.json), and per-site rules for Off, Stealth and the
//     Script & connection controls.
//   - Auto: starts each site in Full and steps up through the Stealth levels only
//     when a page keeps showing an "ad blocker detected" wall.
//   - Element hiding: data/cosmetic.json is indexed by class/id token, so a page
//     receives only the selectors that could match it.
//   - Statistics, the toolbar badge, look-alike and malware warnings, and the
//     messages from the popup, the settings page and the content scripts.
//
// Nothing here downloads or runs code. Block lists are bundled data, refreshed
// with list data only (domain names) by src/list-updates.js.

// ============================================================================
// Constants
// ============================================================================
const SCHEMA = 3;
const AUTO_POLICY_VERSION = 2;
const CATEGORIES = ["ads", "privacy", "security"];               // filter toggles (and our own static ruleset ids)
// Built from EasyList, EasyPrivacy and HaGeZi by tools/build_static_rules.py (see THIRD-PARTY-NOTICES.md).
const STATIC_RULESETS = { ads: ["ads"], privacy: ["privacy"], security: ["security"] };
// Firefox allows only 5,000 dynamic rules, so its build ships the list rules that never
// vary per site as extra static rulesets: "list-<category>", and "list-ads-fixed" for the
// ads rules that apply even on Stealth sites. The Chrome build has none of them.
const MANIFEST_RULESETS = new Set((() => { try { return (chrome.runtime.getManifest().declarative_net_request.rule_resources || []).map((r) => r.id); } catch (e) { return []; } })());
for (const [id, cat] of [["list-easyprivacy", "privacy"], ["list-popups", "ads"], ["list-ads-fixed", "ads"]])
  if (MANIFEST_RULESETS.has(id)) STATIC_RULESETS[cat].push(id);
const ADS_FIXED_STATIC = MANIFEST_RULESETS.has("list-ads-fixed");
const RULESET_CAT = {};
for (const [cat, ids] of Object.entries(STATIC_RULESETS)) for (const id of ids) RULESET_CAT[id] = cat;
function staticCat(rulesetId) { return RULESET_CAT[rulesetId] || null; }
const LADDER = ["off", "lite", "full", "stealth1", "stealth2", "stealth3"];  // the Auto ladder
const AUTO_START = "full";       // Stealth is a response to a confirmed wall, never the starting mode.
const AUTO_MAX = "stealth3";
const RETRY_MS = 30 * 24 * 60 * 60 * 1000;
const FRESH_MS = 2 * 60 * 1000;   // how long after a climb the "first load can't judge" grace lasts
const TRIAL_OK_MS = 24 * 60 * 60 * 1000;                         // a trial that survives a day "worked"

const PRIO = { SHIELD_ALLOW: 50, MALWARE: 60, REDIRECT: 100, OFF_ALLOW: 200, PROCEED: 300 };
const IDBASE = { OFF: 1, SURROGATE: 10000, FAKESUCCESS: 20000, SHIELD: 30000, MALWARE: 40000, LIST: 100000 };
// Rules for list domains that are newer than the bundled copy (src/list-updates.js).
const FRESH_IDS = { block: { security: 60000, ads: 61000, privacy: 62000 }, warn: 63000 };
// Chrome loads the helpers here; Firefox lists them before this file in the manifest.
if (typeof importScripts === "function") importScripts("site-fixes.js", "fix-search.js", "mute-decision.js", "list-updates.js", "lookalike.js");

// Annoyance categories (list names from tools/build_lists.py). "ads" and
// "popups" are ad categories; they follow the Ads filter toggle instead.
const ANNOY_CATS = ["cookies", "newsletter", "notifications", "chat", "annoyances", "social"];

const DEFAULT_GUARD = {
  maxPrompts: 3, timeoutMs: 20000, blockTabUnderMs: 2000, promptForNonHttp: true,
  runOnlyAfterFirstRedirect: false, trustPairs: [], userSafeList: [],
  popupAfterClick: "ask",        // "ask" | "allow": pop-ups opened right after a real click
  overlayGuard: true,            // catch clicks on invisible page-covering links
  enabled: true,                 // master switch for the whole Redirect Guard
  action: "ask",                 // "ask" = show the prompt | "block" = block quietly, no prompt
  fakePopups: "stealth",         // pretend a blocked pop-up opened: "stealth" (on Stealth sites) | "always" | "never"
  linkPopups: true,              // also catch pop-ups opened by page code clicking a hidden <a target=_blank>
  quietAds: true,                // redirects/pop-ups to known ad networks: block without asking
  promptPos: "top-right",
  lookalike: true,               // warn about sites posing as well-known brands (src/lookalike.js)        // "top-right" | "bottom-right"
  malwarePage: true              // stop at a warning page before opening a site on the malware list
};
const DEFAULT_ANNOY = { cookies: true, newsletter: true, notifications: true, chat: true, annoyances: true, social: false };

const DEFAULTS = {
  schema: SCHEMA,
  autoPolicyVersion: AUTO_POLICY_VERSION,
  defaultMode: "auto",
  sites: {},
  filters: { ads: true, privacy: true, security: true, telemetry: false },
  guard: DEFAULT_GUARD,
  sensitiveSites: [],
  shieldNetworks: {},
  autoState: {},
  gentleRetry: true,
  sharedFixes: true,             // use the shared site fixes from Voidy's GitHub (data/site-fixes.json)
  myFixes: {},                   // { host: { allow: [domain], noHiding?, noScripts? } } found with "Fix this site"
  annoy: DEFAULT_ANNOY,
  cookieMode: "reject",          // "reject" = click the site's own Reject button, then hide; "hide" = hide only
  widgetOff: {},                 // { host: true } -> popups & widgets allowed on that site
  guardOff: {},                  // { host: true } -> Redirect Guard off on that site
  adsCosmetic: true,             // EasyList element hiding in Full mode
  autoMax: AUTO_MAX,             // highest level Auto may climb to on its own
  detectLibs: false,             // Library presence alone is not evidence that the page is blocked.
  extraPrivacy: { webrtc: false, ipv6: false, prefetch: false, cookies: false },
  fingerprintSites: {},
  fingerprintDefault: "off",     // protection for every site without its own choice: "off" | "strong" | "maximum"
  rescue: true,                  // un-freeze scrolling after we remove a pop-up
  badge: true,                   // blocked count on the toolbar icon
  theme: "void",                 // universe theme for popup / settings / prompt
  customColors: { primary: "#9b74ff", secondary: "#ec6eb4" },
  myHides: {},                   // { host: [css selector] } elements you hid with "Hide something on this page"
  siteControls: {},              // { host: { scripts3p, scriptsAll, frames3p, sockets3p } } per-site strict controls
  gpc: true                      // send the Global Privacy Control signal ("don't sell or share my data")
};
const GPC_RULE_ID = 58000;       // one rule that adds the Sec-GPC header; never counted as "eaten"
// Per-site strict controls: one grouped rule per control, so the rule count
// stays the same however many sites use them.
const SITE_CONTROLS = ["scripts3p", "scriptsAll", "frames3p", "sockets3p"];
const SITE_CONTROL_ID = 64000, SITE_CONTROL_PRIO = 150;   // above list exceptions, below "Off" (200)
// Site fixes: shared ones from GitHub (56000+) and your own from "Fix this site"
// (57000+). Their allow rules sit above list rules, below site controls and Off.
const SHARED_FIX_ID = 56000, MY_FIX_ID = 57000, FIX_ALLOW_PRIO = 140;
const FIX_TEST_ID = 900000;      // session rules of the guided search (the session-id counter stays below)
const MY_HIDES_PER_SITE = 200;
const THEMES = ["void", "whitehole", "nebula", "supernova", "pulsar", "aurora", "eclipse", "custom"];
// 0.6.0 renamed the colour themes to universes; old names map to the closest one.
const OLD_THEMES = { violet: "void", rose: "nebula", candy: "nebula", ocean: "pulsar", sunset: "supernova", ember: "supernova", mint: "aurora", forest: "aurora" };
const validColour=value=>typeof value==="string"&&/^#[0-9a-fA-F]{6}$/.test(value);
const FINGERPRINT_OFF={canvas:"off",webgl:"off",audio:false,audioStrict:false,fonts:false,fontMetrics:false,clientHints:false,collectors:false,rtc:false};
function fingerprintPolicy(value) {
  if(value===true)return {...FINGERPRINT_OFF,canvas:"strict",webgl:"mask",collectors:true};
  if(!value||typeof value!=="object")return {...FINGERPRINT_OFF};
  return {canvas:["off","gesture","strict"].includes(value.canvas)?value.canvas:"off",webgl:["off","mask","block"].includes(value.webgl)?value.webgl:"off",
    ...Object.fromEntries(["audio","audioStrict","fonts","fontMetrics","clientHints","collectors","rtc"].map(k=>[k,value[k]===true]))};
}
// The "every site" levels, the same as the popup's "Extra" switch and "Maximum privacy".
const FINGERPRINT_PRESETS={off:{...FINGERPRINT_OFF},
  strong:{...FINGERPRINT_OFF,canvas:"strict",webgl:"mask",audio:true,fonts:true,collectors:true},
  maximum:{canvas:"strict",webgl:"block",audio:true,audioStrict:true,fonts:true,fontMetrics:true,clientHints:true,collectors:true,rtc:true}};
const hasFingerprint=p=>p.canvas!=="off"||p.webgl!=="off"||p.audio||p.audioStrict||p.fonts||p.fontMetrics||p.clientHints||p.collectors||p.rtc;
// A site's own choice wins; otherwise the "every site" level applies.
function fingerprintOwner(state,host){
  for(const h of [host,...suffixes(host)])if(Object.prototype.hasOwnProperty.call(state.fingerprintSites,h))return h;
  return null;
}
function fingerprintForHost(state,host){
  const own=fingerprintOwner(state,host);
  if(own)return fingerprintPolicy(state.fingerprintSites[own]);
  if(host)return {...FINGERPRINT_PRESETS[state.fingerprintDefault]};
  return fingerprintPolicy(false);
}
const BROWSER_PRIVACY={webrtc:["network","webRTCIPHandlingPolicy","disable_non_proxied_udp"],prefetch:["network","networkPredictionEnabled",false],cookies:["websites","thirdPartyCookiesAllowed",false]};
function privacyCall(setting, method, args) {
  return new Promise((resolve,reject)=>setting[method](args,result=>{
    const error=chrome.runtime.lastError; if(error) reject(new Error(error.message)); else resolve(result);
  }));
}
async function setBrowserPrivacy(key,enabled) {
  if (!chrome.permissions || !await chrome.permissions.contains({permissions:["privacy"]})) return enabled ? {ok:false,error:"Allow the optional privacy permission first."} : {ok:true};
  try {
    const [section,name,value]=BROWSER_PRIVACY[key],setting=chrome.privacy?.[section]?.[name];
    if(!setting)return {ok:false,error:"This browser doesn't offer this setting."};
    const current=await privacyCall(setting,"get",{});
    if (enabled && !["controllable_by_this_extension","controlled_by_this_extension"].includes(current.levelOfControl)) return {ok:false,error:"This setting is controlled by another extension or browser policy."};
    if(enabled) await privacyCall(setting,"set",{value,scope:"regular"});
    else if(current.levelOfControl==="controlled_by_this_extension") await privacyCall(setting,"clear",{scope:"regular"});
    return {ok:true};
  } catch(error) { return {ok:false,error:error.message}; }
}
const setWebRTCProtection=enabled=>setBrowserPrivacy("webrtc",enabled);
async function extraPrivacyStatus(state,host) {
  const browserControls={};
  const granted=chrome.permissions && await chrome.permissions.contains({permissions:["privacy"]});
  for(const [key,[section,name,value]] of Object.entries(BROWSER_PRIVACY)) {
    const item=browserControls[key]={enabled:false,requested:!!state.extraPrivacy[key],control:"permission_not_granted"};
    if(granted)try{const current=await privacyCall(chrome.privacy[section][name],"get",{});item.enabled=current.value===value;item.control=current.levelOfControl;}catch(_){item.control="unavailable";}
  }
  const policy=fingerprintForHost(state,host);
  return {webrtc:browserControls.webrtc.enabled,webrtcRequested:browserControls.webrtc.requested,webrtcControl:browserControls.webrtc.control,browserControls,
    ipv6:!!state.extraPrivacy.ipv6,policy,fingerprint:hasFingerprint(policy),fingerprintActive:hasFingerprint(policy)&&effectiveLevel(state,host)!=="off",
    fingerprintDefault:state.fingerprintDefault,ownChoice:!!(host&&fingerprintOwner(state,host))};
}
const AUTO_MAX_CHOICES = ["full", "stealth1", "stealth2", "stealth3"];

const SURROGATES = [
  { filter: "||googlesyndication.com/pagead/js/adsbygoogle.js", to: "surrogates/adsbygoogle.js" },
  { filter: "||googlesyndication.com/pagead/show_ads.js",       to: "surrogates/noop.js" },
  { filter: "||googletagservices.com/tag/js/gpt.js",            to: "surrogates/gpt.js" },
  { filter: "||doubleclick.net/tag/js/gpt.js",                  to: "surrogates/gpt.js" },
  { filter: "||doubleclick.net/instream/ad_status.js",          to: "surrogates/empty.js" },
  { filter: "||google-analytics.com/analytics.js",              to: "surrogates/analytics.js" },
  { filter: "||google-analytics.com/ga.js",                     to: "surrogates/analytics.js" },
  { filter: "||googletagmanager.com/gtm.js",                    to: "surrogates/gtm.js" },
  { filter: "||googletagmanager.com/gtag/js",                   to: "surrogates/analytics.js" }
];
// Ad networks whose ad APIs answer with JSON. A page (or the site's own service
// worker, which may proxy every ad request) checks "did the ad API answer?" by
// calling .json() on the reply. A blocked request fails that; so does Stealth
// 2/3's empty 200 (an empty body is not JSON). Stealth answers these with "{}"
// instead: a valid, empty ad response. No ad and no request to the network,
// but the check passes.
const EXO_DOMAINS = ["magsrv.com", "pemsrv.com", "exosrv.com", "exoclick.com", "realsrv.com", "exdynsrv.com", "orbsrv.com", "tsyndicate.com"];
const JSON_FAKES = [{ requestDomains: EXO_DOMAINS, urlFilter: "/v1/api.php" }];
const FAKE_SUCCESS_DOMAINS = ["doubleclick.net", "googlesyndication.com", "google-analytics.com", "adnxs.com", "adsrvr.org", "amazon-adsystem.com",
  "fundingchoicesmessages.google.com"];  // Google's own ad-block-detection message service (see ANTIADBLOCK_DOMAINS)
// Google Ad Blocking Recovery / "Funding Choices": any AdSense publisher can turn
// this on, and it runs from its own domain, independent of whatever ad script
// it is reporting on, so blocking THIS (not just googlesyndication.com) is what
// stops IT specifically. Always on (gated only by the master "Ads" filter, never
// by the cookie-banner toggle it happened to ship inside), never excluded for
// stealth hosts. This is one mechanism sites use, not the only one:
// detector.js is the general backstop for walls that come from elsewhere.
const ANTIADBLOCK_DOMAINS = ["fundingchoicesmessages.google.com"];
// Some sites silently redirect visitors to a SIBLING domain (same content,
// different hostname) based on browser language/platform, e.g. bilinovel.com
// sends some visitors to (tw.)linovelib.com. Without this, a mode chosen on one
// name would do nothing once the redirect landed on the other. canonHost()
// maps every known member to one canonical name, so per-site settings stay
// keyed consistently across the redirect.
const HOST_ALIASES = {
  "linovelib.com": "bilinovel.com", "www.linovelib.com": "bilinovel.com",
  "tw.linovelib.com": "bilinovel.com", "w.linovelib.com": "bilinovel.com",
  "bilinovel.com": "bilinovel.com", "www.bilinovel.com": "bilinovel.com",
  // one YouTube setting for the desktop and mobile sites
  "youtube.com": "www.youtube.com", "www.youtube.com": "www.youtube.com", "m.youtube.com": "www.youtube.com",
};
function canonHost(host) {
  if (!host || typeof host !== "string") return host;
  return HOST_ALIASES[host.toLowerCase()] || host;
}
// The reverse of canonHost: every real hostname that shares this one's canonical
// name (itself included), for building DNR conditions. Chrome's own network
// rules match the REAL hostname making the request — they have no idea two
// names are "the same site" — so a rule scoped to just the canonical name would
// silently not apply once a redirect lands on a sibling. (host storage itself
// stays canonicalized so there's exactly one entry/toggle per site family.)
function aliasGroup(host) {
  const canon = canonHost(host);
  const members = Object.keys(HOST_ALIASES).filter((k) => HOST_ALIASES[k] === canon);
  return members.length ? members : [host];
}
const SHIELD_NETWORKS = {
  google: ["googlesyndication.com", "doubleclick.net", "googleadservices.com", "googletagservices.com"],
  amazon: ["amazon-adsystem.com"],
  media_net: ["media.net"]
};
const COMPANIES = {
  "doubleclick.net": "Google", "googlesyndication.com": "Google", "googleadservices.com": "Google",
  "googletagservices.com": "Google", "googletagmanager.com": "Google", "google-analytics.com": "Google",
  "facebook.net": "Meta", "facebook.com": "Meta", "amazon-adsystem.com": "Amazon",
  "adnxs.com": "Microsoft (Xandr)", "adsrvr.org": "The Trade Desk", "criteo.com": "Criteo",
  "criteo.net": "Criteo", "taboola.com": "Taboola", "outbrain.com": "Outbrain", "media.net": "Media.net",
  "fundingchoicesmessages.google.com": "Google (Ad Blocking Recovery)",
  "pubmatic.com": "PubMatic", "rubiconproject.com": "Magnite", "openx.net": "OpenX",
  "casalemedia.com": "Index Exchange", "indexww.com": "Index Exchange", "scorecardresearch.com": "Comscore",
  "quantserve.com": "Quantcast", "hotjar.com": "Hotjar", "moatads.com": "Oracle Moat",
  "ads-twitter.com": "X (Twitter)", "adform.net": "Adform", "teads.tv": "Teads", "3lift.com": "TripleLift",
  "smartadserver.com": "Equativ", "adroll.com": "AdRoll", "chartbeat.com": "Chartbeat",
  "newrelic.com": "New Relic", "segment.com": "Twilio Segment", "mixpanel.com": "Mixpanel",
  "amplitude.com": "Amplitude", "bidswitch.net": "IPONWEB", "gumgum.com": "GumGum"
};

// ============================================================================
// State helpers
// ============================================================================
async function getState() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return {
    defaultMode: s.defaultMode || "auto",
    sites: s.sites || {},
    filters: { ...DEFAULTS.filters, ...(s.filters || {}) },
    guard: { ...DEFAULT_GUARD, ...(s.guard || {}) },
    sensitiveSites: s.sensitiveSites || [],
    shieldNetworks: s.shieldNetworks || {},
    autoState: s.autoState || {},
    gentleRetry: s.gentleRetry !== false,
    sharedFixes: s.sharedFixes !== false,
    myFixes: s.myFixes || {},
    annoy: { ...DEFAULT_ANNOY, ...(s.annoy || {}) },
    cookieMode: s.cookieMode === "hide" ? "hide" : "reject",
    widgetOff: s.widgetOff || {},
    guardOff: s.guardOff || {},
    adsCosmetic: s.adsCosmetic !== false,
    myHides: s.myHides || {},
    siteControls: s.siteControls || {},
    gpc: s.gpc !== false,
    autoMax: AUTO_MAX_CHOICES.includes(s.autoMax) ? s.autoMax : AUTO_MAX,
    detectLibs: s.detectLibs !== false,
    extraPrivacy: { ...DEFAULTS.extraPrivacy, ...(s.extraPrivacy || {}) },
    fingerprintSites: s.fingerprintSites || {},
    fingerprintDefault: Object.prototype.hasOwnProperty.call(FINGERPRINT_PRESETS, s.fingerprintDefault) ? s.fingerprintDefault : "off",
    rescue: s.rescue !== false,
    badge: s.badge !== false,
    theme: THEMES.includes(s.theme) ? s.theme : OLD_THEMES[s.theme] || "void",
    customColors: {primary:validColour(s.customColors?.primary)?s.customColors.primary:DEFAULTS.customColors.primary,
      secondary:validColour(s.customColors?.secondary)?s.customColors.secondary:DEFAULTS.customColors.secondary}
  };
}

function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ""; } }
function suffixes(host) {
  const p = (host || "").split("."), out = [];
  for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i).join("."));
  return out;
}
function hostMatches(host, list) { return (list || []).some((h) => host === h || host.endsWith("." + h)); }
function baseDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const two = parts.slice(-2).join(".");
  if (/^(co|com|net|org|gov|ac|edu)\.[a-z]{2}$/.test(two)) return parts.slice(-3).join(".");
  return two;
}

function storedMode(state, host) {
  if (!host) return state.defaultMode;
  return state.sites[host] || state.defaultMode;
}
function effectiveLevel(state, host) {
  const mode = storedMode(state, host);
  if (mode !== "auto") return mode;
  const a = state.autoState[host];
  let level = (a && a.level) || AUTO_START;
  if (a && a.ceiling) {
    const ci = LADDER.indexOf(a.ceiling), li = LADDER.indexOf(level);
    if (ci >= 0 && li > ci) level = a.ceiling;
  }
  // The user's "Auto may go up to" setting caps every site (lowering it takes
  // effect immediately, without forgetting what Auto learned).
  const mi = Math.max(LADDER.indexOf(state.autoMax || AUTO_MAX), LADDER.indexOf(a && a.manualMax));
  if (mi >= 0 && LADDER.indexOf(level) > mi) level = LADDER[mi];
  return level;
}
const isStealthish = (lvl) => lvl === "stealth1" || lvl === "stealth2" || lvl === "stealth3" || lvl === "shield";

function widgetsOn(state, host) { return !suffixes(host).some((h) => state.widgetOff[h]); }
function guardOn(state, host) { return state.guard.enabled !== false && !suffixes(host).some((h) => state.guardOff[h]); }

// Sensitive pages: the Redirect Guard steps aside there so sign-in and 3-D
// Secure jumps aren't held. Decided by the SITE only (yours, or a built-in list
// of banks, payment providers and sign-in services), never by words in the
// address: any page can put "/pay/" or "login" in its own address, and would
// then switch the Guard off for itself.
const SENSITIVE_HOSTS = ["paypal.com", "stripe.com", "chase.com", "bankofamerica.com", "wellsfargo.com",
  "citi.com", "capitalone.com", "americanexpress.com", "coinbase.com", "discover.com", "usbank.com",
  "accounts.google.com", "login.microsoftonline.com", "login.live.com", "appleid.apple.com", "id.apple.com",
  "login.yahoo.com", "auth0.com", "okta.com", "onelogin.com", "id.atlassian.com", "adyen.com", "klarna.com", "affirm.com"];
function isSensitiveUrl(state, url) {
  const host = hostOf(url);
  if (!host) return false;
  return hostMatches(host, state.sensitiveSites) || hostMatches(host, SENSITIVE_HOSTS);
}

// ============================================================================
// Your own fixes, found with "Fix this site": addresses allowed on one site
// (never one on the malware and phishing lists).
async function myFixRules(state) {
  const out = [];
  let id = MY_FIX_ID;
  for (const [host, f] of Object.entries(state.myFixes)) {
    if (!HOST_RE.test(host) || !f || !Array.isArray(f.allow) || id >= MY_FIX_ID + 1000) continue;
    const safe = [];
    for (const d of f.allow) if (HOST_RE.test(d) && !(await listedAs(d)).malware) safe.push(d);
    if (safe.length) out.push({ id: id++, priority: FIX_ALLOW_PRIO, action: { type: "allow" }, condition: { initiatorDomains: aliasGroup(host), requestDomains: safe } });
  }
  return out;
}

// ---- "Fix this site": the guided search (src/fix-search.js) -----------------
// The test lives in session storage, so it survives the worker going to sleep
// between answers and ends when the browser closes.
let fixTestNow = null, fixTestLoaded = false;
async function fixTest() {
  if (!fixTestLoaded) { fixTestNow = (await chrome.storage.session.get({ fixTest: null })).fixTest; fixTestLoaded = true; }
  return fixTestNow;
}
async function saveFixTest(t) { fixTestNow = t; fixTestLoaded = true; await chrome.storage.session.set({ fixTest: t }); }
const onSite = (site, host) => !!host && aliasGroup(site).some((h) => host === h || host.endsWith("." + h));
// Is Voidy's page hiding (or are its page scripts) paused on this site: being tested, or your fix?
function fixPaused(state, host, what) {
  const t = fixTestNow;
  if (t && t.S && !t.S.done && !t.S.failed && onSite(t.host, host) && t.S.trying.includes(what)) return true;
  const key = what === "#hiding" ? "noHiding" : "noScripts";
  return suffixes(host || "").some((h) => state.myFixes[h] && state.myFixes[h][key]);
}
const fixLabel = (item) => item === "#hiding" ? "Voidy's page hiding" : item === "#scripts" ? "Voidy's page scripts" : item;
function fixView(t) {
  return { state: "asking", host: t.host, tabId: t.tabId, round: t.S.rounds, of: t.S.rounds + Math.ceil(Math.log2(Math.max(1, t.S.pool.length))),
    trying: t.S.trying, pool: t.S.pool, labels: Object.fromEntries(t.S.pool.map((c) => [c, fixLabel(c)])) };
}
// Let this round's half through: one session allow rule for the hosts, and the
// page-hiding and page-script switches through fixPaused.
async function applyFixRound(t) {
  const old = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id >= FIX_TEST_ID && r.id < FIX_TEST_ID + 100).map((r) => r.id);
  const hosts = t && !t.S.done && !t.S.failed ? t.S.trying.filter((c) => !c.startsWith("#")) : [];
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old, addRules: hosts.length ? [{ id: FIX_TEST_ID, priority: FIX_ALLOW_PRIO + 5,
    action: { type: "allow" }, condition: { initiatorDomains: aliasGroup(t.host), requestDomains: hosts } }] : [] });
  await syncPageScripts(await getState());
}
// Should this tab show the panel (a test is running on it, or its result waits)?
async function fixPanelFor(tabId) {
  const t = await fixTest();
  if (t) return t.tabId === tabId;
  const { fixResult = null } = await chrome.storage.session.get("fixResult");
  return !!(fixResult && fixResult.tabId === tabId);
}
async function endFixTest(result) {
  await saveFixTest(null);
  await applyFixRound(null);
  if (result) await chrome.storage.session.set({ fixResult: result }); else await chrome.storage.session.remove("fixResult");
}
async function startFixTest(host, tabId) {
  await loadStats();
  const cands = [];
  for (const d of Object.keys(tabOf(tabId).domains)) if (HOST_RE.test(d) && !(await listedAs(d)).malware) cands.push(d);
  const t = { host, tabId, S: VOIDY_FIXSEARCH.start([...cands, "#hiding", "#scripts"]), startedAt: Date.now() };
  await chrome.storage.session.remove("fixResult");
  await saveFixTest(t);
  await applyFixRound(t);
  await reloadTab(tabId);
  return fixView(t);
}
async function finishFix(t, item) {
  const state = await getState();
  const mine = { ...(state.myFixes[t.host] || {}) };
  if (item === "#hiding") mine.noHiding = true;
  else if (item === "#scripts") mine.noScripts = true;
  else mine.allow = [...new Set([...(mine.allow || []), item])];
  await chrome.storage.local.set({ myFixes: { ...state.myFixes, [t.host]: mine } });
  const result = { state: "found", host: t.host, tabId: t.tabId, item, label: fixLabel(item) };
  await endFixTest(result);
  await reconcileDynamicRules();
  await logEvent({ kind: "fixFound", host: t.host, item: fixLabel(item) });
  await reloadTab(t.tabId);
  return result;
}
async function answerFixTest(works) {
  const t = await fixTest();
  if (!t) return null;
  const S = VOIDY_FIXSEARCH.answer(t.S, !!works);
  if (S.done) return finishFix(t, S.culprit);
  if (S.failed) {
    const result = { state: "failed", host: t.host, tabId: t.tabId };
    await endFixTest(result); await reloadTab(t.tabId);
    return result;
  }
  const next = { ...t, S };
  await saveFixTest(next); await applyFixRound(next); await reloadTab(t.tabId);
  return fixView(next);
}
async function removeMyFix(host, item) {
  const state = await getState();
  const mine = { ...(state.myFixes[host] || {}) };
  if (item === "#hiding") delete mine.noHiding;
  else if (item === "#scripts") delete mine.noScripts;
  else mine.allow = (mine.allow || []).filter((d) => d !== item);
  if (mine.allow && !mine.allow.length) delete mine.allow;
  const all = { ...state.myFixes };
  if (Object.keys(mine).length) all[host] = mine; else delete all[host];
  await chrome.storage.local.set({ myFixes: all });
  await reconcileDynamicRules(); await syncPageScripts(await getState());
}
// The test ends when its tab closes or leaves the site.
chrome.tabs.onRemoved.addListener(async (tabId) => { const t = await fixTest(); if (t && t.tabId === tabId) await endFixTest(null); });
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const t = await fixTest();
  if (t && t.tabId === tabId && /^https?:/.test(info.url) && !onSite(t.host, hostOf(info.url))) await endFixTest(null);
});

// Shared site fixes (data/site-fixes.json, refreshed from GitHub; see
// src/site-fixes.js). The entry for a host or the nearest parent that has one,
// or null when shared fixes are switched off or the site is set to Off.
async function sharedFixFor(state, host) {
  if (!state.sharedFixes || !host || effectiveLevel(state, host) === "off") return null;
  const { sites } = await LIST_UPDATES.fixes();
  for (const h of suffixes(host)) if (sites[h]) return sites[h];
  return null;
}
// The activity log notes a shared fix on a site at most once a day.
const sharedFixNoted = new Map();
async function noteSharedFix(state, host) {
  try {
    if (Date.now() - (sharedFixNoted.get(host) || 0) < 864e5 || !(await sharedFixFor(state, host))) return;
    sharedFixNoted.set(host, Date.now());
    await logEvent({ kind: "sharedFix", host });
  } catch (e) {}
}
// Feed markers for src/feed-main.js: only with the Ads filter on, on a site
// that isn't Off or Lite, and not switched off in the fixes file.
async function feedsFor(state, host, level) {
  if (!state.filters.ads || level === "off" || level === "lite") return null;
  const fix = await sharedFixFor(state, host);
  return fix && !fix.off && fix.feeds ? fix.feeds : null;
}
// Spotify ad muting: the page signals from the fixes file, and the mute itself.
async function spotifyConfig(state, host) {
  const level = effectiveLevel(state, host);
  if (!state.filters.ads || level === "off" || level === "lite") return null;
  const fix = await sharedFixFor(state, host);
  return fix && !fix.off && fix.adPlaying ? { adPlaying: fix.adPlaying } : null;
}
async function adMute(tabId, on) {
  const { mutedByVoidy = {} } = await chrome.storage.session.get("mutedByVoidy");
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch (e) { return { ok: false }; }
  const m = tab.mutedInfo || {};
  // another extension's mute counts as the person's: never undone by Voidy
  const info = m.reason === "extension" && m.extensionId && m.extensionId !== chrome.runtime.id ? { ...m, reason: "other" } : m;
  const decision = VOIDY_MUTE.muteDecision(mutedByVoidy[tabId] || null, info, on);
  if (decision === "mute") { await chrome.tabs.update(tabId, { muted: true }); mutedByVoidy[tabId] = { byVoidy: true }; }
  else if (decision === "unmute") { await chrome.tabs.update(tabId, { muted: false }); delete mutedByVoidy[tabId]; }
  else if (decision === "forget") delete mutedByVoidy[tabId];
  await chrome.storage.session.set({ mutedByVoidy });
  return { ok: true, decision };
}
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { mutedByVoidy = {} } = await chrome.storage.session.get("mutedByVoidy");
  if (mutedByVoidy[tabId]) { delete mutedByVoidy[tabId]; await chrome.storage.session.set({ mutedByVoidy }); }
});
// Allow and block rules from the shared fixes. An allow never covers an address
// on the malware and phishing lists, whatever the file says.
async function sharedFixRules(state) {
  if (!state.sharedFixes) return [];
  const { sites } = await LIST_UPDATES.fixes();
  const out = [];
  let id = SHARED_FIX_ID;
  for (const [host, e] of Object.entries(sites)) {
    const initiatorDomains = aliasGroup(host);
    if (e.allow) {
      const safe = [];
      for (const d of e.allow) if (!(await listedAs(d)).malware) safe.push(d);
      if (safe.length && id < SHARED_FIX_ID + 1000) out.push({ id: id++, priority: FIX_ALLOW_PRIO, action: { type: "allow" }, condition: { initiatorDomains, requestDomains: safe } });
    }
    if (e.block && state.filters.ads) for (const b of e.block) {
      if (id >= SHARED_FIX_ID + 1000) break;
      out.push({ id: id++, priority: 4, action: { type: "block" }, condition: { initiatorDomains, urlFilter: b.urlFilter, ...(b.types ? { resourceTypes: b.types } : {}) } });
    }
  }
  return out;
}

// DNR — part 1: per-site rules (off / surrogate / fake-success / shield)
// ============================================================================
// Every rule reconciliation reads/replaces shared DNR state. Queue updates so
// startup, Auto reports and settings changes cannot install stale snapshots.
let ruleUpdates = Promise.resolve();
function queueRuleUpdate(operation) {
  const next = ruleUpdates.then(operation, operation);
  ruleUpdates = next.catch(() => {});
  return next;
}
function reconcileDynamicRules() { return queueRuleUpdate(reconcileDynamicRulesNow); }
// The ids of Voidy's dynamic rules, kept in memory. Reading the rules back from
// Chrome takes ~200 ms (the malware warning rules hold ~234,000 addresses) and
// only the ids are ever needed. Asked from Chrome once per wake-up, then kept in
// step with every change; forgotten if a change fails.
let ruleIds = null;
async function dynamicRuleIds() {
  if (!ruleIds) ruleIds = new Set((await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id));
  return ruleIds;
}
async function changeRules(opts) {
  const ids = await dynamicRuleIds();
  for (let tries = 0; ; tries++) {
    try { await chrome.declarativeNetRequest.updateDynamicRules(opts); break; }
    catch (e) {
      // Firefox checks every domain and rejects the whole batch over one malformed list
      // entry (Chrome lets it through). Its error names the entry: drop it and try again.
      // A rule whose list would become empty is dropped too, so it can't widen to match all.
      const m = tries < 25 && /addRules\.(\d+)\.condition\.(\w+)\.(\d+)/.exec(String(e && e.message));
      const rule = m && opts.addRules && opts.addRules[+m[1]], list = rule && rule.condition && rule.condition[m[2]];
      if (!Array.isArray(list)) { ruleIds = null; throw e; }
      rule.condition[m[2]] = list.filter((_, i) => i !== +m[3]);
      if (!rule.condition[m[2]].length) opts = { ...opts, addRules: opts.addRules.filter((r) => r !== rule) };
    }
  }
  for (const id of opts.removeRuleIds || []) ids.delete(id);
  for (const r of opts.addRules || []) ids.add(r.id);
}

// Malware warning pages and list-update rules: see keepStable below.
let lastStableSig = null;
const isStableRule = (id) => (id >= IDBASE.MALWARE && id < IDBASE.MALWARE + 10000) || (id >= FRESH_IDS.block.security && id < FRESH_IDS.warn + 1000);
async function reconcileDynamicRulesNow() {
  const state = await getState();
  const hosts = new Set([...Object.keys(state.sites), ...Object.keys(state.autoState)]);
  const addRules = [];
  let sid = IDBASE.SURROGATE, fid = IDBASE.FAKESUCCESS, shid = IDBASE.SHIELD, oid = IDBASE.OFF;

  // Sites are GROUPED by level, so the rule count stays constant however many
  // sites Auto has disguised. (Chrome allows 5,000 redirect rules; one set per
  // site would eventually make the whole update fail, "Off" rules included.)
  const byLevel = { off: [], s1: [], s2: [], shield: {} };
  const notS1 = [], notS2 = [];
  for (const host of hosts) {
    const level = effectiveLevel(state, host);
    const members = aliasGroup(host);   // expand to every real hostname this stored (canonical) host covers
    if (level === "off") byLevel.off.push(...members);
    if (level === "stealth1" || level === "stealth2" || level === "stealth3") byLevel.s1.push(...members);
    if (level === "stealth2" || level === "stealth3") byLevel.s2.push(...members);
    if (!["stealth1", "stealth2", "stealth3"].includes(level)) notS1.push(...members);
    if (!["stealth2", "stealth3"].includes(level)) notS2.push(...members);
    if (level === "shield") {
      const net = SHIELD_NETWORKS[state.shieldNetworks[host]] ? state.shieldNetworks[host] : "google";
      (byLevel.shield[net] = byLevel.shield[net] || []).push(...members);
    }
  }
  if (byLevel.off.length) {
    addRules.push({ id: oid++, priority: PRIO.OFF_ALLOW, action: { type: "allowAllRequests" },
      condition: { requestDomains: byLevel.off, resourceTypes: ["main_frame", "sub_frame"] } });
    // allowAllRequests only covers requests made INSIDE a frame. A site's
    // service worker belongs to no frame (tabId -1), so its requests would still
    // hit the block lists. Any request the site itself initiates is allowed too.
    addRules.push({ id: oid++, priority: PRIO.OFF_ALLOW, action: { type: "allow" },
      condition: { initiatorDomains: byLevel.off } });
  }
  const defaultLevel = effectiveLevel(state, "");
  const defaultS1 = ["stealth1", "stealth2", "stealth3"].includes(defaultLevel);
  const defaultS2 = ["stealth2", "stealth3"].includes(defaultLevel);
  const s1Scope = defaultS1 ? (notS1.length ? { excludedInitiatorDomains: notS1 } : {}) : { initiatorDomains: byLevel.s1 };
  const s2Scope = defaultS2 ? (notS2.length ? { excludedInitiatorDomains: notS2 } : {}) : { initiatorDomains: byLevel.s2 };
  if (defaultS1 || byLevel.s1.length) {
    for (const s of SURROGATES) {
      const category = /analytics|gtm/.test(s.to) ? "privacy" : "ads";
      if (!state.filters[category]) continue;
      // One above the fake-"OK" rules: a watched script must get its working fake
      // (window.adsbygoogle etc.), not an empty file; otherwise Stealth 2/3 would
      // leave the ad library missing, which is weaker than Stealth 1.
      addRules.push({ id: sid++, priority: PRIO.REDIRECT + 1,
        action: { type: "redirect", redirect: { extensionPath: "/" + s.to } },
        // "xmlhttprequest": modern detectors fetch() the ad script instead of adding a
        // <script> tag, and treat a network error as "ad blocker found".
        condition: { ...s1Scope, urlFilter: s.filter, resourceTypes: ["script", "xmlhttprequest"] } });
    }
  }
  if (state.filters.ads && (defaultS1 || byLevel.s1.length)) {
    for (const j of JSON_FAKES) {
      addRules.push({ id: sid++, priority: PRIO.REDIRECT + 1,
        action: { type: "redirect", redirect: { extensionPath: "/surrogates/empty.json" } },
        // "other": some Chrome versions label a service worker's fetch() this way
        condition: { ...s1Scope, requestDomains: j.requestDomains, urlFilter: j.urlFilter, resourceTypes: ["xmlhttprequest", "other"] } });
    }
  }
  if ((defaultS2 || byLevel.s2.length) && (state.filters.ads || state.filters.privacy)) {
    const fakeDomains = FAKE_SUCCESS_DOMAINS.filter(h => state.filters[/analytics/.test(h) ? "privacy" : "ads"]);
    const fake = (to, types) => addRules.push({ id: fid++, priority: PRIO.REDIRECT,
      action: { type: "redirect", redirect: { extensionPath: to } },
      condition: { ...s2Scope, requestDomains: fakeDomains, resourceTypes: types } });
    fake("/surrogates/empty.js", ["script"]);
    fake("/surrogates/empty.gif", ["image"]);
    // fetch()/XHR/beacon probes to ad servers get an empty 200 instead of an error.
    fake("/surrogates/empty.txt", ["xmlhttprequest", "ping", "other"]);
  }
  for (const [net, sites] of Object.entries(byLevel.shield)) {
    addRules.push({ id: shid++, priority: PRIO.SHIELD_ALLOW, action: { type: "allow" },
      condition: { initiatorDomains: sites, requestDomains: SHIELD_NETWORKS[net] } });
  }
  // Known malware / phishing sites: stop at a warning page instead of loading
  // them. (The security list's rules have no resourceTypes, and Chrome then
  // applies a rule to everything EXCEPT the page you navigate to, so these
  // separate main_frame rules are what catch a visit.) A warning page with "go back" /
  // "continue anyway" instead of a hard block, because block lists are
  // sometimes wrong and a hard block leaves no way through. Sites set to Off
  // are unaffected (their allowAllRequests rule outranks this one).
  // These big rules (~234,000 addresses) rarely change, so they are only
  // rebuilt when something they depend on changed (resending them takes
  // about a second).
  const disabledSecurity = await chrome.declarativeNetRequest.getDisabledRuleIds({ rulesetId: "security" });
  const { listUpdates = {} } = await chrome.storage.local.get("listUpdates");
  const stableSig = JSON.stringify([state.filters.security, state.filters.ads, state.filters.privacy, state.guard.malwarePage !== false,
    disabledSecurity, Object.values(listUpdates.cats || {}).map((c) => c.updated || 0)]);
  const existing = [...await dynamicRuleIds()].map((id) => ({ id }));
  const keepStable = stableSig === lastStableSig && existing.some((r) => isStableRule(r.id));
  if (!keepStable) {
    if (state.filters.security && state.guard.malwarePage !== false) {
      const chunks = await securityChunks();
      const off = new Set(disabledSecurity);
      let mid = IDBASE.MALWARE;
      for (const c of chunks) if (!off.has(c.id)) addRules.push(malwareWarnRule(mid++, c.domains));
    }
    addRules.push(...await LIST_UPDATES.freshRules(state, FRESH_IDS,
      state.filters.security && state.guard.malwarePage !== false ? malwareWarnRule : null));
  }
  // The player loads a tiny script-availability handshake during bootstrap.
  // A network failure can send it through an ad-check retry before content.
  // Serve only that handshake locally on sites with our YouTube adapter.
  const youtubeScript=pageScriptPlan(state).find(s=>s.id==="voidy-yt-cosmetic");
  if(youtubeScript){
    const domains=patterns=>patterns.map(p=>p.replace(/^\*:\/\/\*\./,"").replace(/\/\*$/,""));
    const scope={initiatorDomains:domains(youtubeScript.matches),
      ...(youtubeScript.excludeMatches?.length?{excludedInitiatorDomains:domains(youtubeScript.excludeMatches)}:{})};
    addRules.push({id:55000,priority:PRIO.REDIRECT+2,action:{type:"redirect",redirect:{extensionPath:"/surrogates/youtube-status.js"}},condition:{
      regexFilter:"^https?://static\\.doubleclick\\.net/instream/ad_status\\.js(\\?.*)?$",resourceTypes:["script"],...scope
    }});
  }
  // YouTube scores whether its ad-ID request was answered and sends that score
  // along with each video; a blocked request counts as "ad blocker found", and
  // repeated scores lead to the "Ad blockers are not allowed" wall. Answer it
  // here with an empty reply: nothing reaches Google either way. Network rules,
  // so they follow the Ads filter in Lite too; Off's allow rules outrank them.
  if(state.filters.ads){
    const youtube={initiatorDomains:["youtube.com","youtube-nocookie.com","youtubekids.com"]};
    addRules.push({id:55001,priority:PRIO.REDIRECT+2,action:{type:"redirect",redirect:{extensionPath:"/surrogates/empty.txt"}},condition:{
      urlFilter:"||googleads.g.doubleclick.net/pagead/id",resourceTypes:["xmlhttprequest","other"],...youtube
    }});
    // YouTube's activity log, which also carries the player's own ad-check
    // reports. Video, history and recommendations don't use it.
    addRules.push({id:55002,priority:PRIO.REDIRECT+2,action:{type:"block"},condition:{
      urlFilter:"||youtube.com/youtubei/v1/log_event",...youtube
    }});
  }
  addRules.push(...await sharedFixRules(state), ...await myFixRules(state));
  const fingerprintHosts = Object.keys(state.fingerprintSites).filter(h=>fingerprintPolicy(state.fingerprintSites[h]).collectors && HOST_RE.test(h) && effectiveLevel(state,h)!=="off");
  if(state.filters.privacy&&FINGERPRINT_PRESETS[state.fingerprintDefault].collectors&&effectiveLevel(state,"")!=="off"){
    const skip=[...Object.keys(state.fingerprintSites).filter(h=>HOST_RE.test(h)),...[...new Set([...Object.keys(state.sites),...Object.keys(state.autoState)])].filter(h=>HOST_RE.test(h)&&effectiveLevel(state,h)==="off")].flatMap(aliasGroup);
    addRules.push({id:50999,priority:3,action:{type:"block"},condition:{...(skip.length?{excludedInitiatorDomains:[...new Set(skip)]}:{}),requestDomains:["fpjs.io","fingerprint.com","deviceid.com","iovation.com","threatmetrix.com"],domainType:"thirdParty"}});
  }
  if(state.filters.privacy)for(const [index,host] of fingerprintHosts.slice(0,999).entries()){
    const excluded=Object.keys(state.fingerprintSites).filter(h=>HOST_RE.test(h)&&h.endsWith('.'+host)&&!fingerprintPolicy(state.fingerprintSites[h]).collectors).flatMap(aliasGroup);
    addRules.push({id:50000+index,priority:3,action:{type:"block"},condition:{initiatorDomains:aliasGroup(host),...(excluded.length?{excludedInitiatorDomains:excluded}:{}),requestDomains:["fpjs.io","fingerprint.com","deviceid.com","iovation.com","threatmetrix.com"],domainType:"thirdParty"}});
  }
  // Per-site strict controls (popup: "Script & connection controls")
  const controlled = (k) => Object.keys(state.siteControls).filter((h) => state.siteControls[h][k] && HOST_RE.test(h) && effectiveLevel(state, h) !== "off").flatMap(aliasGroup);
  const siteBlock = (id, hosts, types, thirdParty) => ({ id, priority: SITE_CONTROL_PRIO, action: { type: "block" },
    condition: { initiatorDomains: hosts, resourceTypes: types, ...(thirdParty ? { domainType: "thirdParty" } : {}) } });
  const [s3p, sAll, f3p, w3p] = SITE_CONTROLS.map(controlled);
  if (s3p.length) addRules.push(siteBlock(SITE_CONTROL_ID, s3p, ["script"], true));
  if (f3p.length) addRules.push(siteBlock(SITE_CONTROL_ID + 1, f3p, ["sub_frame"], true));
  if (w3p.length) addRules.push(siteBlock(SITE_CONTROL_ID + 2, w3p, ["websocket"], true));
  if (sAll.length) {
    addRules.push(siteBlock(SITE_CONTROL_ID + 3, sAll, ["script"], false));
    // inline scripts too: the page gets an extra "no scripts" security policy
    addRules.push({ id: SITE_CONTROL_ID + 4, priority: SITE_CONTROL_PRIO, action: { type: "modifyHeaders",
      responseHeaders: [{ header: "Content-Security-Policy", operation: "append", value: "script-src 'none'" }] },
      condition: { requestDomains: sAll, resourceTypes: ["main_frame", "sub_frame"] } });
  }
  // Global Privacy Control header on every request (sites set to Off have an
  // allowAllRequests rule that outranks this one, so they get nothing).
  if (state.gpc) addRules.push({ id: GPC_RULE_ID, priority: 1, action: { type: "modifyHeaders", requestHeaders: [{ header: "Sec-GPC", operation: "set", value: "1" }] },
    condition: { resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "other"] } });
  if(state.extraPrivacy.ipv6)addRules.push({id:59000,priority:1000,action:{type:"block"},condition:{regexFilter:"^(https?|wss?)://\\[[0-9a-fA-F:.%]+\\]"}});
  await changeRules({
    removeRuleIds: existing.filter((r) => r.id < IDBASE.LIST && !(keepStable && isStableRule(r.id))).map((r) => r.id),   // leave list rules alone
    addRules
  });
  lastStableSig = stableSig;
  await reconcileListRulesNow(state);   // same queued transaction; no nested lock
  // Only needed while rules are rebuilt (rare): let them go instead of keeping
  // ~10 MB in memory; they reload from the extension's own files next time.
  secChunks = null; netData = null;
}

// ============================================================================
// Original site-specific page logic. The YouTube response filter is maintained
// in this project and runs only on YouTube family hosts.
// ============================================================================
const SCRIPTS_OFF_LEVELS = new Set(["off", "lite", "shield"]);
const OUR_SCRIPT_IDS = /^(?:voidy-yt(?:-cosmetic)?|voidy-twitch|voidy-feed|voidy-spotify|voidy-gpc|voidy-fingerprint(?:-[a-z0-9-]+)?)$/;
// Match registrations by bundled file as well as ID so upgrades retire older IDs.
const OWNED_PAGE_SCRIPT_FILES = new Set(["src/yt-main.js", "src/yt-cosmetic.js",
  "src/twitch-main.js", "src/feed-main.js", "src/spotify-mute.js", "src/gpc-main.js", "src/fingerprint-main.js"]);
const siteMatch = (h) => `*://*.${h}/*`;          // the site and its subdomains, like our network rules
function pageScriptPlan(state) {
  const hosts = new Set([...Object.keys(state.sites), ...Object.keys(state.autoState)]);
  const offHosts = [], onHosts = [];
  for (const h of hosts) {
    if (!HOST_RE.test(h)) continue;
    (SCRIPTS_OFF_LEVELS.has(effectiveLevel(state, h)) ? offHosts : onHosts).push(...aliasGroup(h));
  }
  // "Fix this site": page scripts paused on the site being tested, or by your fix.
  for (const h of new Set([...(fixTestNow ? [fixTestNow.host] : []), ...Object.keys(state.myFixes)]))
    if (HOST_RE.test(h) && fixPaused(state, h, "#scripts")) offHosts.push(...aliasGroup(h));
  const defaultOn = !SCRIPTS_OFF_LEVELS.has(effectiveLevel(state, ""));
  const widgetOff = Object.keys(state.widgetOff).filter((h) => state.widgetOff[h] && HOST_RE.test(h)).flatMap(aliasGroup);
  const out = [];
  const all = [{ id: "voidy-yt", js: "src/yt-main.js", world: "MAIN", toggle: "ads",
    hosts: ["youtube.com", "youtube-nocookie.com", "youtubekids.com"] },
    { id: "voidy-yt-cosmetic", js: "src/yt-cosmetic.js", world: "ISOLATED", toggle: "ads",
      hosts: ["youtube.com", "youtube-nocookie.com", "youtubekids.com"] },
    { id: "voidy-twitch", js: "src/twitch-main.js", world: "MAIN", toggle: "ads", hosts: ["twitch.tv"] },
    // Feed ads (src/feed-main.js); idle unless getConfig hands it feeds from the shared fixes file.
    { id: "voidy-feed", js: "src/feed-main.js", world: "MAIN", toggle: "ads", hosts: ["facebook.com", "instagram.com", "x.com", "twitter.com"] },
    // Spotify ad muting (src/spotify-mute.js); idle unless the fixes file names the ad signals.
    { id: "voidy-spotify", js: "src/spotify-mute.js", world: "ISOLATED", toggle: "ads", hosts: ["open.spotify.com"] },
    // GPC is a privacy signal, not blocking: Lite sends it too. Only a site set to Off does without.
    { id: "voidy-gpc", js: "src/gpc-main.js", world: "MAIN", toggle: "gpc", hosts: ["*"], offLevels: new Set(["off"]) }];
  for (const b of all) {
    const [kind, sub] = b.toggle.split(":");
    const enabled = kind === "gpc" ? state.gpc !== false : kind === "annoy" ? !!state.annoy[sub] : !!state.filters[kind];
    if (!enabled) continue;
    let offList = offHosts, onList = onHosts, defOn = defaultOn;
    if (b.offLevels) {
      offList = []; onList = [];
      for (const h of hosts) { if (!HOST_RE.test(h)) continue; (b.offLevels.has(effectiveLevel(state, h)) ? offList : onList).push(...aliasGroup(h)); }
      defOn = !b.offLevels.has(effectiveLevel(state, ""));
    }
    let matches;
    if (defOn) matches = b.hosts.includes("*") ? ["http://*/*", "https://*/*"] : b.hosts.map(siteMatch);
    else if (b.hosts.includes("*")) matches = onList.map(siteMatch);
    else matches = onList.filter((h) => b.hosts.some((bh) => h === bh || h.endsWith("." + bh))).map(siteMatch);
    if (!matches.length) continue;
    const exclude = [...offList, ...(kind === "annoy" ? widgetOff : [])];
    const d = { id: b.id, js: [b.js], matches: [...new Set(matches)].sort(), allFrames: true, matchOriginAsFallback: true,
      runAt: "document_start", world: b.world, persistAcrossSessions: true };
    if (exclude.length) d.excludeMatches = [...new Set(exclude.map(siteMatch))].sort();
    out.push(d);
  }
  const groups=new Map();
  const featuresOf=(policy)=>{
    const features=[];if(policy.canvas!=="off")features.push("canvas-"+policy.canvas);if(policy.webgl!=="off")features.push("webgl-"+policy.webgl);
    for(const [key,file] of [["audio","audio"],["audioStrict","audio-strict"],["fonts","fonts"],["fontMetrics","font-metrics"],["clientHints","client-hints"],["rtc","rtc"]])if(policy[key])features.push(file);
    return features;
  };
  const fpScripts=(features)=>["src/privacy/init.js",...features.map(f=>"src/privacy/"+f+".js"),"src/fingerprint-main.js"];
  // Every site without its own choice, except sites set to Off.
  const defFeatures=featuresOf(FINGERPRINT_PRESETS[state.fingerprintDefault]);
  if(defFeatures.length&&effectiveLevel(state,"")!=="off"){
    const offSites=[...hosts].filter(h=>HOST_RE.test(h)&&effectiveLevel(state,h)==="off");
    const skip=[...new Set([...Object.keys(state.fingerprintSites).filter(h=>HOST_RE.test(h)),...offSites].flatMap(aliasGroup))];
    out.push({id:"voidy-fingerprint-all",js:fpScripts(defFeatures),matches:["http://*/*","https://*/*"],...(skip.length?{excludeMatches:skip.map(siteMatch).sort()}:{}),world:"MAIN",runAt:"document_start",allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:true});
  }
  for(const host of Object.keys(state.fingerprintSites)){
    const policy=fingerprintPolicy(state.fingerprintSites[host]);if(!HOST_RE.test(host)||effectiveLevel(state,host)==="off"||!hasFingerprint(policy))continue;
    const features=featuresOf(policy);
    if(!features.length)continue;
    const key=features.join("-");if(!groups.has(key))groups.set(key,{features,hosts:[]});groups.get(key).hosts.push(...aliasGroup(host));
  }
  for(const [key,group] of groups){
    const excluded=new Set([...Object.keys(state.fingerprintSites).flatMap(aliasGroup),...offHosts]);
    const excludeMatches=[...excluded].filter(h=>!group.hosts.includes(h)&&group.hosts.some(parent=>h.endsWith('.'+parent))).map(siteMatch);
    out.push({id:"voidy-fingerprint-"+key,js:fpScripts(group.features),matches:[...new Set(group.hosts.map(siteMatch))],...(excludeMatches.length?{excludeMatches}:{}),world:"MAIN",runAt:"document_start",allFrames:true,matchOriginAsFallback:true,persistAcrossSessions:true});
  }
  return out;
}
let pageScriptSig = null;
async function syncPageScripts(state) {
  if (!chrome.scripting || !chrome.scripting.registerContentScripts) return;
  try {
    const plan = pageScriptPlan(state);
    const sig = JSON.stringify(plan);
    const cur = (await chrome.scripting.getRegisteredContentScripts()).filter((c) => OUR_SCRIPT_IDS.test(c.id) || (c.js || []).some((file) => OWNED_PAGE_SCRIPT_FILES.has(file)));
    if (sig === pageScriptSig && cur.length === plan.length) return;
    // Update registrations in place so mode changes avoid needless work.
    const curById = new Map(cur.map((c) => [c.id, c]));
    const planIds = new Set(plan.map((d) => d.id));
    const gone = cur.filter((c) => !planIds.has(c.id)).map((c) => c.id);
    const fresh = plan.filter((d) => !curById.has(d.id));
    const same = (a, b) => JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort());
    const changed = plan.filter((d) => { const c = curById.get(d.id); return c && (!same(c.matches, d.matches) || !same(c.excludeMatches, d.excludeMatches) || !same(c.js, d.js)); })
      .map((d) => ({ id: d.id, js: d.js, matches: d.matches, excludeMatches: d.excludeMatches || [] }));
    if (gone.length) await chrome.scripting.unregisterContentScripts({ ids: gone });
    if (changed.length) await chrome.scripting.updateContentScripts(changed);
    if (fresh.length) await chrome.scripting.registerContentScripts(fresh);
    pageScriptSig = sig;
  } catch (e) { pageScriptSig = null; console.warn("[Voidy] page script registration failed:", e && e.message); }
}

// ============================================================================
// DNR — part 2: list rules (EasyList paths, pop-unders, annoyances)
// ============================================================================
let netData = null;
// Static list domains, loaded on demand: the malware warning rules reuse the
// security list's own chunks, and the Guard prompt asks "is this destination
// on our ad or malware lists?" (a far better answer than its ~40 built-in names).
let secChunks = null, domainSets = null;
async function securityChunks() {
  if (!secChunks) secChunks = (await (await fetch(chrome.runtime.getURL("rules/security.json"))).json())
    .map((r) => ({ id: r.id, domains: r.condition.requestDomains || [] })).filter((c) => c.domains.length);
  return secChunks;
}
function malwareWarnRule(id, domains) {
  return { id, priority: PRIO.MALWARE,
    action: { type: "redirect", redirect: { regexSubstitution: chrome.runtime.getURL("guard/blocked.html") + "#\1" } },
    condition: { requestDomains: domains, regexFilter: "^(https?://.*)$", resourceTypes: ["main_frame"] } };
}
async function listedAs(host) {
  if (!domainSets) {
    const [sec, ads] = await Promise.all([LIST_UPDATES.activeDomains("security"), LIST_UPDATES.activeDomains("ads")]);
    domainSets = { malware: new Set(sec.flat()), ads: new Set(ads.flat()) };
    setTimeout(() => { domainSets = null; }, 2 * 60 * 1000);   // big; rebuilt if the Guard asks again
  }
  const hs = suffixes(String(host || "").toLowerCase());
  return { malware: hs.some((h) => domainSets.malware.has(h)), ads: hs.some((h) => domainSets.ads.has(h)) };
}

// Session-rule ids handed out one at a time, so two quick "continue" clicks
// can't both compute the same "max + 1" and make the second update fail.
let sessionIdNext = 0;
async function nextSessionRuleId() {
  if (!sessionIdNext) sessionIdNext = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id < FIX_TEST_ID).reduce((m, r) => Math.max(m, r.id), 0) + 1;
  return sessionIdNext++;
}

async function loadNetData() {
  if (!netData) {
    netData = await (await fetch(chrome.runtime.getURL("data/netrules.json"))).json();
    Object.assign(netData, await (await fetch(chrome.runtime.getURL("data/supplemental.json"))).json());
  }
  return netData;
}

// Which categories are on, and which sites each one must skip.
function listPlan(state) {
  const stealthHosts = [];
  const widgetOffHosts = Object.keys(state.widgetOff).filter((h) => state.widgetOff[h]).flatMap(aliasGroup);
  for (const h of new Set([...Object.keys(state.sites), ...Object.keys(state.autoState)])) {
    if (isStealthish(effectiveLevel(state, h))) stealthHosts.push(...aliasGroup(h));
  }
  const plan = {};
  if (state.filters.ads) {
    // EasyList's GENERIC path rules ("/ads.js", "-ad-banner.") include the
    // "bait" files detectors watch, so stealth sites skip those. Rules tied to
    // a domain ("||youtube.com/pagead/", ad-server lists) still apply there —
    // see stealthSkips(). (Skipping all of them would let YouTube's ads play
    // in Stealth: its ad requests are only blocked by domain-anchored rules.)
    plan.ads = stealthHosts.sort();
    plan.popups = [];
    plan.pgl = [];                       // Peter Lowe's ad/tracker servers: plain domain blocks, safe everywhere
    plan.antiadblock = [];               // never excluded — see ANTIADBLOCK_DOMAINS above
    plan.supplementalAds = [];
  }
  if (state.filters.telemetry) plan.telemetry = [];   // opt-in phone/OS telemetry
  if (state.filters.privacy) { plan.supplementalPrivacy = []; plan.easyprivacy = []; }   // EasyPrivacy URL-level tracker rules
  if (state.filters.security) plan.supplementalSecurity = [];
  for (const c of ANNOY_CATS) if (state.annoy[c]) plan[c] = widgetOffHosts.slice().sort();
  return plan;
}

// Should a Stealth site skip this ads-list rule? Yes when it could hit a
// "bait" file — what detectors load to see if it's blocked:
//  - generic path rules ("/ads.js", "-ad-banner.") match any site's own files;
//  - domain-anchored rules for SCRIPTS ("||futbollatam.com/ads.js",
//    "||cnet.com/prebid-client.js"): sites' own ad scripts are the classic bait.
// Kept on Stealth sites: ad-server lists (requestDomains, like the static
// lists that already apply there) and anchored non-script rules such as
// "||youtube.com/pagead/" and "/youtubei/v1/player/ad_break" — the only rules
// that block YouTube's ad requests. Allow rules are never skipped: they only
// un-block, and skipping them could make Stealth block MORE than Full.
// A heuristic, stated honestly: an anchored non-script rule can still be a
// site's bait; that site then needs a higher level or Shield.
function stealthSkips(r) {
  if (r.action && r.action.type === "allow") return false;
  const c = r.condition || {};
  if (c.requestDomains && c.requestDomains.length) return false;
  const u = c.urlFilter || "";
  if (!u.startsWith("||")) return true;
  return /\.js|\/js\/|prebid/i.test(u) || (c.resourceTypes || []).includes("script");
}

// Each list category owns a fixed block of rule ids and is rewritten only when
// its inputs change. This keeps mode changes from reinstalling unrelated lists.
// Retired slots keep existing category ID ranges stable across updates.
const LIST_CATS = ["ads", "popups", "pgl", "antiadblock", "supplementalAds", "supplementalPrivacy", "telemetry", ...ANNOY_CATS,
  "supplementalSecurity", "easyprivacy", "retired-15"];     // easyprivacy reuses the retired slot 14
const REGEX_CATS = new Set();
const LIST_BLOCK = 10000;                                // ids per category (largest today: easyprivacy ~9,000; tools/build_lists.py refuses more)
const listBase = (cat) => IDBASE.LIST + LIST_CATS.indexOf(cat) * LIST_BLOCK;
let regexOk = null;                                      // regex -> supported by this Chrome? (checked once per run)
async function supportedRegexRules(rules) {
  if (!regexOk) regexOk = new Map();
  const out = [];
  for (const r of rules) {
    const rx = r.condition && r.condition.regexFilter;
    if (!rx) { out.push(r); continue; }
    if (!regexOk.has(rx)) {
      let ok = false;
      try { const res = await chrome.declarativeNetRequest.isRegexSupported({ regex: rx, isCaseSensitive: !!r.condition.isUrlFilterCaseSensitive }); ok = !!(res && res.isSupported); } catch (e) {}
      regexOk.set(rx, ok);
    }
    if (regexOk.get(rx)) out.push(r);                    // one unsupported regex would fail the whole update
  }
  return out;
}

function reconcileListRules(stateArg) { return queueRuleUpdate(() => reconcileListRulesNow(stateArg)); }
async function reconcileListRulesNow(stateArg) {
  const state = stateArg || await getState();
  await syncPageScripts(state);        // same inputs (modes, toggles, per-site widget switch)
  const plan = listPlan(state);
  // The extension version is part of each signature: the list DATA changes
  // with updates, and a plan-only signature would keep the old rules.
  const v = chrome.runtime.getManifest().version;
  const { listSigs = {} } = await chrome.storage.local.get({ listSigs: {} });
  const existing = [...await dynamicRuleIds()].map((id) => ({ id }));
  const presentByCat = {};
  for (const r of existing) {
    if (r.id < IDBASE.LIST) continue;
    const i = Math.floor((r.id - IDBASE.LIST) / LIST_BLOCK), cat = LIST_CATS[i];
    (presentByCat[cat || "?"] = presentByCat[cat || "?"] || []).push(r.id);
  }
  const removeRuleIds = [...(presentByCat["?"] || [])];  // ids from an older layout
  const addRules = [];
  const newSigs = {};
  let data = null;
  const max = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES || 5000;
  let budget = max - existing.filter((r) => r.id < IDBASE.LIST).length - 500;   // headroom for per-site rules
  const SYNTHETIC_LISTS = { antiadblock: [{ priority: 1, action: { type: "block" }, condition: { requestDomains: ANTIADBLOCK_DOMAINS } }] };
  const ranges = [];
  const defaultStealth = isStealthish(effectiveLevel(state, ""));
  const genericHosts = [...new Set([...Object.keys(state.sites), ...Object.keys(state.autoState)])]
    .filter(h => !isStealthish(effectiveLevel(state, h))).flatMap(aliasGroup).sort();
  const intersectDomains = (a, b) => [...new Set(a.flatMap(x => b.flatMap(y =>
    x === y || x.endsWith("." + y) ? [x] : y.endsWith("." + x) ? [y] : [])))];
  for (const cat of LIST_CATS) {
    const on = cat in plan && !MANIFEST_RULESETS.has("list-" + cat);   // a static copy (Firefox build) replaces it
    const sig = on ? JSON.stringify({ v, exclude: plan[cat], ...(cat === "ads" ? { defaultStealth, genericHosts } : {}) }) : "";
    const have = presentByCat[cat] || [];
    if (on && sig === (listSigs[cat] || "") && have.length) {
      newSigs[cat] = sig; budget -= have.length;
      if (have.length) ranges.push([listBase(cat), listBase(cat) + LIST_BLOCK - 1, cat]);
      continue;                                          // unchanged: leave it alone
    }
    removeRuleIds.push(...have);
    newSigs[cat] = sig;
    if (!on) continue;
    data = data || await loadNetData();
    let src = SYNTHETIC_LISTS[cat] || data[cat] || [];
    if (REGEX_CATS.has(cat)) src = await supportedRegexRules(src);
    const exclude = plan[cat];
    let id = listBase(cat);
    for (const r of src) {
      if (budget <= 0 || id >= listBase(cat) + LIST_BLOCK) break;
      if (cat === "ads" && ADS_FIXED_STATIC && !stealthSkips(r)) continue;   // shipped in list-ads-fixed
      const cond = { ...r.condition };
      if (cat === "ads" && defaultStealth && stealthSkips(r)) {
        const included = cond.initiatorDomains ? intersectDomains(cond.initiatorDomains, genericHosts) : genericHosts;
        if (!included.length) continue;
        cond.initiatorDomains = included;
      }
      if (exclude.length && (cat !== "ads" || stealthSkips(r))) cond.excludedInitiatorDomains = [...new Set([...(cond.excludedInitiatorDomains || []), ...exclude])];
      addRules.push({ id: id++, priority: r.priority, action: r.action, condition: cond });
      budget--;
    }
    ranges.push([listBase(cat), listBase(cat) + LIST_BLOCK - 1, cat]);
  }
  // Regex categories use separate updates so unsupported expressions cannot
  // prevent other categories from updating.
  const inRange = (id, cat) => id >= listBase(cat) && id < listBase(cat) + LIST_BLOCK;
  const isRx = (id) => [...REGEX_CATS].some((c) => inRange(id, c));
  const rxAdd = addRules.filter((r) => isRx(r.id)), mainAdd = addRules.filter((r) => !isRx(r.id));
  if (removeRuleIds.length || mainAdd.length) {
    try { await changeRules({ removeRuleIds, addRules: mainAdd }); }
    catch (e) { console.warn("[Voidy] list rule update failed:", e && e.message); await chrome.storage.local.set({ listSigs: {} }); return; }
  }
  if (rxAdd.length) {
    try { await changeRules({ addRules: rxAdd }); }
    catch (e) {
      for (const r of rxAdd) { try { await changeRules({ addRules: [r] }); } catch (e2) {} }
    }
  }
  await chrome.storage.local.set({ listSigs: newSigs, listRanges: ranges });
  listRanges = ranges;
}

// Map a dynamic list-rule id to a stats bucket: ad lists -> "ads", annoyance
// lists -> "annoy" (shown with the popups & widgets count).
let listRanges = null;
async function listCat(ruleId) {
  if (ruleId >= 50000 && ruleId < 51000 || ruleId === 59000) return "privacy";
  for (const [cat, base] of Object.entries(FRESH_IDS.block)) if (ruleId >= base && ruleId < base + 1000) return cat;
  if (!listRanges) listRanges = (await chrome.storage.local.get({ listRanges: [] })).listRanges;
  for (const [a, b, cat] of listRanges) {
    if (ruleId < a || ruleId > b) continue;
    if (cat.startsWith("retired-")) return null;
    if (["ads","popups","pgl","antiadblock","supplementalAds"].includes(cat)) return "ads";
    if (cat === "telemetry" || cat === "supplementalPrivacy" || cat === "easyprivacy") return "privacy";
    if (cat === "supplementalSecurity") return "security";
    return "annoy";
  }
  return null;
}

async function reconcileRulesets() {
  const state = await getState();
  const enable = [], disable = [];
  for (const id of CATEGORIES) (state.filters[id] ? enable : disable).push(...STATIC_RULESETS[id]);
  await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
}

// The toolbar badge: how many requests Voidy blocked on this page. Voidy draws it
// itself, so a page left open for hours (a chat app sending telemetry all day)
// shows "1.8k" instead of a number too long for the icon, and the popup can show
// the very same count (Chrome only lets it see the last 5 minutes of matches).
let badgeOn = true;
const badgeTimers = new Map();
function badgeText(n) {
  if (!n) return "";
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.floor(n / 100) / 10).toFixed(1).replace(/\.0$/, "") + "k";   // 1.2k
  return n < 100000 ? Math.floor(n / 1000) + "k" : "99k+";
}
function drawBadge(tabId) {
  if (tabId == null || tabId < 0 || badgeTimers.has(tabId)) return;
  badgeTimers.set(tabId, setTimeout(() => {               // at most a few redraws a second per tab
    badgeTimers.delete(tabId);
    const n = badgeOn && tabStats && tabStats[tabId] ? tabStats[tabId].blocked || 0 : 0;
    chrome.action.setBadgeText({ tabId, text: badgeText(n) }).catch(() => {});
  }, 250));
}
async function enableBadge() {
  try {
    const { badge } = await chrome.storage.local.get({ badge: true });
    badgeOn = badge !== false;
    await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: false });
    await chrome.action.setBadgeBackgroundColor({ color: "#7c5cff" });
    await loadStats();
    for (const t of await chrome.tabs.query({})) drawBadge(t.id);
  } catch (e) {}
}
// Per-tab "stuck" signal. We change the badge COLOR only, so the count stays.
async function markStuck(tabId, on) {
  if (tabId == null || tabId < 0) return;
  try { await chrome.action.setBadgeBackgroundColor({ tabId, color: on ? "#e0a31c" : "#7c5cff" }); } catch (e) {}
}

// ============================================================================
// COSMETIC backend
// ============================================================================
let cosData = null;
// Token and site entries arrive packed as one string ("cat\x1fselector" joined by
// \x1e; see tools/build_lists.py) and are unpacked only when a page needs them.
function pairs(v) {
  if (!v) return [];
  if (typeof v !== "string") return v;                       // older unpacked format
  return v.split("\x1e").map((p) => { const i = p.indexOf("\x1f"); return [+p.slice(0, i), p.slice(i + 1)]; });
}
async function loadCosData() {
  if (!cosData) cosData = await (await fetch(chrome.runtime.getURL("data/cosmetic.json"))).json();
  return cosData;
}

// Categories the cosmetic engine should apply for this page.
function cosmeticCats(state, topHost) {
  const level = effectiveLevel(state, topHost);
  if (level === "off" || level === "lite") return [];
  const cats = [];
  if (level === "full" && state.filters.ads && state.adsCosmetic) cats.push("ads");   // stealth: never hide bait
  if (widgetsOn(state, topHost)) for (const c of ANNOY_CATS) if (state.annoy[c]) cats.push(c);
  return cats;
}

function exceptionSet(d, frameHost) {
  const ex = new Set();
  for (const h of suffixes(frameHost)) for (const s of d.exceptions[h] || []) ex.add(s);
  return ex;
}

// Elements you hid yourself: every mode except Off.
function myHideRules(state, topHost, frameHost) {
  if (effectiveLevel(state, topHost) === "off") return [];
  return suffixes(frameHost).flatMap((h) => (state.myHides[h] || []).map((sel) => ["mine", sel]));
}
const validHideSelector = (sel) => typeof sel === "string" && sel.length > 0 && sel.length <= 500 && !/[{}]/.test(sel);

async function cosmeticInit(state, topHost, frameHost) {
  await fixTest();
  if (fixPaused(state, topHost, "#hiding")) return null;
  const cats = cosmeticCats(state, topHost), mine = myHideRules(state, topHost, frameHost);
  if (cats.includes("ads")) { const fix = await sharedFixFor(state, frameHost); if (fix && fix.hide) for (const sel of fix.hide) mine.push(["ads", sel]); }
  if (!cats.length) return mine.length ? { cats, genericOff: true, rules: mine } : null;
  const d = await loadCosData();
  const catIdx = new Set(cats.map((c) => d.cats.indexOf(c)));
  const ex = exceptionSet(d, frameHost);
  const genericOff = suffixes(frameHost).some((h) => d.genericOff.includes(h));
  const out = [];
  const push = (ci, sel) => { if (!ex.has(sel)) out.push([d.cats[ci], sel]); };
  if (!genericOff) for (const c of cats) for (const sel of d.lowly[c] || []) push(d.cats.indexOf(c), sel);
  for (const h of suffixes(frameHost)) for (const [ci, sel] of pairs(d.specific[h])) if (catIdx.has(ci)) push(ci, sel);
  return { cats, genericOff, rules: out.concat(mine) };
}

async function cosmeticTokens(state, topHost, frameHost, tokens) {
  const cats = cosmeticCats(state, topHost);
  if (!cats.length) return [];
  const d = await loadCosData();
  if (suffixes(frameHost).some((h) => d.genericOff.includes(h))) return [];
  const catIdx = new Set(cats.map((c) => d.cats.indexOf(c)));
  const ex = exceptionSet(d, frameHost);
  const out = [];
  for (const t of tokens.slice(0, 4000)) {
    const hits = pairs(d.tokens[t]);
    if (!hits) continue;
    for (const [ci, sel] of hits) if (catIdx.has(ci) && !ex.has(sel)) out.push([d.cats[ci], sel]);
  }
  return out;
}

// ============================================================================
// Action log
// ============================================================================
async function logEvent(entry) {
  const { log = [] } = await chrome.storage.local.get({ log: [] });
  log.push({ t: Date.now(), ...entry });
  while (log.length > 200) log.shift();
  await chrome.storage.local.set({ log });
}

// ============================================================================
// Auto engine
// ============================================================================
function autoEntry(state, host) {
  return state.autoState[host] || { level: AUTO_START, askShown: false, lastDetectTs: 0, trialing: false };
}
async function saveAuto(host, entry) {
  const { autoState = {} } = await chrome.storage.local.get({ autoState: {} });
  autoState[host] = entry;
  await chrome.storage.local.set({ autoState });
}
async function reloadTab(tabId) { if (tabId != null && tabId >= 0) { try { await chrome.tabs.reload(tabId); } catch (e) {} } }
// Automatic reloads (after Auto climbs) only when the tab is still on, or still heading to,
// the site that asked for it. Otherwise a late reload would pull the user back from the
// page they just moved to.
async function reloadTabIfOn(tabId, host) {
  if (tabId == null || tabId < 0) return;
  try {
    const tab = await chrome.tabs.get(tabId), h = new URL(tab.pendingUrl || tab.url).hostname;
    if (h === host || h.endsWith("." + host)) await chrome.tabs.reload(tabId);
  } catch (e) {}
}

// Auto state is stored as one map and rules are replaced as one set. Serialize
// decisions across hosts too, so simultaneous tabs cannot overwrite each other.
let autoDecisions = Promise.resolve();
function withHostLock(host, fn) {
  const next = autoDecisions.then(fn, fn);
  autoDecisions = next.catch(() => {});
  return next;
}

// signal: "lib:<name>" = a known detector library is PRESENT (it may be fooled
// already); confirmed persistent walls, rather than library presence, drive Auto.
async function onDetected(host, tabId, signal, pageLevel) {
  return withHostLock(host, async () => {
    const state = await getState();
    if (storedMode(state, host) !== "auto") return;
    const a = autoEntry(state, host);
    const libOnly = String(signal).startsWith("lib:");
    if (libOnly) return;                                            // A library can be present on a perfectly working page.
    const curIdx = LADDER.indexOf(effectiveLevel(state, host));

    // A report from a page that loaded at an older level (e.g. sent just before
    // our own reload) says nothing about the current level: ignore it.
    if (pageLevel && pageLevel !== LADDER[curIdx]) return;

    // "Accept the wall": the user chose to live with it here. No climbing, no asking.
    if (a.accepted) return;

    // Early unconfirmed reports can reflect a verdict left by the old load.
    // The detector confirms persistence before sending confirmed: reports,
    // allowing another climb on the same visit when a wall really remains.
    if (a.fresh && !String(signal).startsWith("confirmed:") && Date.now() - (a.lastClimbTs || 0) < FRESH_MS) {
      a.fresh = false;
      await saveAuto(host, a);
      await logEvent({ kind: "wall-after-climb", host, at: LADDER[curIdx], signal });
      return;
    }
    a.fresh = false;

    a.lastDetectTs = Date.now();
    if (a.trialing) {                                               // gentle-retry trial failed
      a.retryWait = Math.min((a.retryWait || RETRY_MS) * 2, RETRY_MS * 8);
      a.trialing = false;
      if (a.trialFrom) { a.level = a.trialFrom; delete a.trialFrom; a.lastClimbTs = Date.now(); a.fresh = true;
        await saveAuto(host, a); await reconcileDynamicRules();
        await logEvent({ kind: "retry-failed", host, to: a.level, signal }); await reloadTabIfOn(tabId, host); return; }
    }
    const maxIdx = Math.max(LADDER.indexOf(state.autoMax), LADDER.indexOf(a.manualMax));
    const ceilIdx = a.ceiling ? LADDER.indexOf(a.ceiling) : maxIdx;
    const topIdx = Math.min(maxIdx, ceilIdx);
    if (curIdx < topIdx) {
      a.level = LADDER[curIdx + 1];
      a.askShown = false;
      a.lastClimbTs = Date.now();
      a.fresh = true;
      await saveAuto(host, a);
      await reconcileDynamicRules();
      await logEvent({ kind: "climb", host, to: a.level, signal });
      await loadStats(); life.totals.climbs = (life.totals.climbs || 0) + 1; scheduleFlush();
      await reloadTabIfOn(tabId, host);
    } else if (!libOnly && !a.askShown) {
      a.askShown = true;
      await saveAuto(host, a);
      await logEvent({ kind: "stuck", host, at: a.level, signal });
      await markStuck(tabId, true);
    } else {
      await saveAuto(host, a);
    }
  });
}

async function manualClimb(host, tabId) {
  return withHostLock(host, async () => {
    const state = await getState();
    const mode = storedMode(state, host);
    const curLevel = effectiveLevel(state, host);
    const curIdx = LADDER.indexOf(curLevel);
    if (curIdx < 0) return { ok: false, reason: "not-on-ladder" };   // Shield / Off: nothing to climb to
    const maxIdx = LADDER.indexOf("stealth3");  // A manual request can exceed the automatic ceiling.
    const a = mode === "auto" ? autoEntry(state, host) : null;
    const topIdx = maxIdx;
    if (curIdx >= topIdx) return { ok: false, reason: "at-ceiling", level: curLevel };
    const nextLevel = LADDER[curIdx + 1];
    if (mode === "auto") {
      a.level = nextLevel; a.manualMax = nextLevel; delete a.ceiling;
      a.askShown = false; a.accepted = false; a.fresh = true; a.lastDetectTs = Date.now(); a.lastClimbTs = Date.now();
      await saveAuto(host, a);
    } else {
      await chrome.storage.local.set({ sites: { ...state.sites, [host]: nextLevel } });
    }
    await reconcileDynamicRules();
    await logEvent({ kind: "climb", host, to: nextLevel, signal: "user-report" });
    await loadStats(); life.totals.climbs = (life.totals.climbs || 0) + 1; scheduleFlush();
    return { ok: true, level: nextLevel };
  });
}

async function onBrokeAuto(host, tabId) {
  return withHostLock(host, async () => {
    const state = await getState();
    const a = autoEntry(state, host);
    const curIdx = LADDER.indexOf(effectiveLevel(state, host));
    const newIdx = Math.max(0, curIdx - 1);
    a.level = LADDER[newIdx];
    a.ceiling = LADDER[newIdx];
    a.askShown = false; a.trialing = false; a.fresh = false; delete a.trialFrom; delete a.manualMax;
    await saveAuto(host, a);
    await reconcileDynamicRules();
    await logEvent({ kind: "broke", host, to: a.level });
    await reloadTab(tabId);
  });
}

// Rule 6 (gentle retry). Called once per top-frame load.
async function maybeGentleRetry(host) {
  return withHostLock(host, async () => {
    const state = await getState();
    if (!state.gentleRetry || storedMode(state, host) !== "auto") return;
    const a = state.autoState[host];
    if (!a || a.accepted) return;     // "Accept the wall" means: stay where you are
    if (a.trialing) {
      // Survived a whole day one level lower without detection: keep it.
      if (Date.now() - (a.trialStart || 0) > TRIAL_OK_MS) {
        a.trialing = false; delete a.trialFrom; a.retryWait = RETRY_MS;
        await saveAuto(host, a);
        await logEvent({ kind: "retry-kept", host, at: a.level });
      }
      return;
    }
    const idx = LADDER.indexOf(a.level);
    if (idx <= LADDER.indexOf(AUTO_START)) return;
    if (Date.now() - (a.lastDetectTs || 0) < (a.retryWait || RETRY_MS)) return;
    a.trialing = true; a.trialStart = Date.now(); a.trialFrom = a.level; a.level = LADDER[idx - 1];
    await saveAuto(host, a);
    await reconcileDynamicRules();
    await logEvent({ kind: "gentle-retry", host, to: a.level });
  });
}

// ============================================================================
// STATS
// ============================================================================
const emptyTab = () => ({ held: 0, blocked: 0, domains: {}, cos: {}, ytMatches: [] });   // cos: { "<frame>:<src>": {ads, annoy} }
const emptyLife = () => ({ since: Date.now(), totals: { ads: 0, privacy: 0, security: 0, hidden: 0, held: 0, annoy: 0, climbs: 0 }, domains: {} });

let tabStats = null, life = null, dirty = false, flushTimer = null, statsLoading = null;
// One shared load, so several blocks arriving together can't each reload the
// stats from storage and overwrite each other's counts.
function loadStats() {
  if (tabStats && life) return Promise.resolve();
  if (!statsLoading) statsLoading = (async () => {
    const s = await chrome.storage.session.get({ tabStats: {} });
    const l = await chrome.storage.local.get({ lifetime: null });
    tabStats = s.tabStats || {};
    life = l.lifetime || emptyLife();
    life.totals = { ...emptyLife().totals, ...life.totals };
  })();
  return statsLoading;
}
function scheduleFlush() { dirty = true; if (flushTimer) return; flushTimer = setTimeout(flush, 1500); }
async function flush() {
  flushTimer = null; if (!dirty) return; dirty = false;
  pruneDomains(life.domains, 400);
  for (const t of Object.values(tabStats)) pruneDomains(t.domains, 60);
  await chrome.storage.session.set({ tabStats });
  await chrome.storage.local.set({ lifetime: life });
}
function pruneDomains(map, keep) {
  const keys = Object.keys(map);
  if (keys.length <= keep * 1.5) return;
  keys.sort((a, b) => map[b].n - map[a].n);
  for (const k of keys.slice(keep)) delete map[k];
}
function bump(map, domain, cat) { const e = map[domain] || (map[domain] = { n: 0, cat }); e.n++; }
function tabOf(tabId) { return tabStats[tabId] || (tabStats[tabId] = emptyTab()); }
function cosTotals(t) {
  let ads = 0, annoy = 0;
  for (const v of Object.values(t.cos || {})) { ads += v.ads || 0; annoy += v.annoy || 0; }
  return { ads, annoy };
}

const debugAvailable = !!(chrome.declarativeNetRequest.onRuleMatchedDebug);
function youtubeMatchKind(url) {
  try {
    const u = new URL(url), h = u.hostname, p = u.pathname;
    if ((h === "youtube.com" || h.endsWith(".youtube.com")) && p === "/youtubei/v1/player/ad_break") return "adBreak";
    if (h === "googleads.g.doubleclick.net" && p === "/pagead/id") return "adServiceId";
    if (h === "www.google.com" && p === "/pagead/lvz") return "adServiceLvz";
    if (h === "static.doubleclick.net" && p === "/instream/ad_status.js") return "startupProbe";
    if ((h === "youtube.com" || h.endsWith(".youtube.com")) && p.startsWith("/pagead/")) return "youtubePagead";
    if (h === "googlevideo.com" || h.endsWith(".googlevideo.com")) return "media";
    if (h === "doubleclick.net" || h.endsWith(".doubleclick.net") || p.startsWith("/pagead/")) return "otherAdService";
  } catch (_) {}
  return "other";
}
async function youtubePlayerFields(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return null;
  try {
    const rows = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: () => {
      const adKey = key => /^ad[A-Z]|[A-Z]d[A-Z]|Ads$|Break|Instream|Vast/.test(key);
      const adKeys = value => value && typeof value === "object"
        ? Object.keys(value).filter(adKey).slice(0, 32) : [];
      const adPaths = root => {
        const out = [], seen = new WeakSet(), queue = [{ value: root, path: "", depth: 0 }];
        let visited = 0;
        while (queue.length && visited++ < 500 && out.length < 32) {
          const { value, path, depth } = queue.shift();
          if (!value || typeof value !== "object" || seen.has(value) || depth > 3) continue;
          seen.add(value);
          for (const key of Object.keys(value).slice(0, 100)) {
            if (!/^(?:[A-Za-z][A-Za-z0-9_]{0,48}|\d{1,4})$/.test(key)) continue;
            const childPath = path ? path + "." + key : key;
            if (adKey(key)) out.push(childPath);
            const item = Object.getOwnPropertyDescriptor(value, key);
            if (depth < 3 && item && "value" in item && item.value && typeof item.value === "object")
              queue.push({ value: item.value, path: childPath, depth: depth + 1 });
            if (out.length >= 32) break;
          }
        }
        return out;
      };
      const initial = window.ytInitialPlayerResponse;
      // Compare media requests with the initial video's own format URLs in
      // this page only. Return labels and timings, never media URLs or IDs.
      const mediaId = raw => {
        try {
          const url = new URL(raw);
          if (!/(^|\.)googlevideo\.com$/.test(url.hostname)) return null;
          const id = url.searchParams.get("id") || url.pathname.match(/\/id\/([^/]+)/)?.[1];
          return id && id.length <= 300 ? id : null;
        } catch (_) { return null; }
      };
      const formatIds = new Set();
      const streaming = initial?.streamingData;
      for (const format of [...(Array.isArray(streaming?.formats) ? streaming.formats : []),
        ...(Array.isArray(streaming?.adaptiveFormats) ? streaming.adaptiveFormats : [])].slice(0, 200)) {
        if (!format || typeof format !== "object") continue;
        let raw = typeof format.url === "string" ? format.url : null;
        if (!raw && typeof (format.signatureCipher || format.cipher) === "string") {
          try { raw = new URLSearchParams(format.signatureCipher || format.cipher).get("url"); } catch (_) {}
        }
        const id = raw && mediaId(raw);
        if (id) formatIds.add(id);
      }
      const mediaTimeline = [];
      try {
        for (const entry of performance.getEntriesByType("resource")) {
          if (mediaTimeline.length >= 8) break;
          let url;
          try { url = new URL(entry.name); } catch (_) { continue; }
          const googlevideo = /(^|\.)googlevideo\.com$/.test(url.hostname);
          if ((!googlevideo && !/\/videoplayback(?:\/|$)/.test(url.pathname)) || entry.startTime > 30000) continue;
          const id = mediaId(entry.name);
          const rawMime = url.searchParams.get("mime") || "";
          const mimeKind = /^audio(?:\/|$)/i.test(rawMime) ? "audio" : /^video(?:\/|$)/i.test(rawMime) ? "video" : "unknown";
          const initiator = ["fetch", "xmlhttprequest", "video"].includes(entry.initiatorType) ? entry.initiatorType : "other";
          mediaTimeline.push({ atMs: Math.round(entry.startTime), durationMs: Math.round(entry.duration),
            requestClass: googlevideo ? "googlevideo" : "other-videoplayback", mimeKind, initiator,
            relation: id && formatIds.size ? formatIds.has(id) ? "initial-content" : "different-media" : "unknown" });
        }
      } catch (_) {}
      const experimentFlags = window.ytcfg?.data_?.EXPERIMENT_FLAGS;
      const networkMachine = {
        enabled: typeof experimentFlags?.all_web_enable_network_machine === "boolean" ? experimentFlags.all_web_enable_network_machine : null,
        rawRequest: typeof experimentFlags?.all_web_network_machine_raw_request === "boolean" ? experimentFlags.all_web_network_machine_raw_request : null
      };
      let legacy = null;
      try {
        const raw = window.ytplayer?.config?.args?.player_response;
        if (typeof raw === "string" && raw.length < 4 * 1024 * 1024) legacy = JSON.parse(raw);
      } catch (_) {}
      // How many ad entries each copy of the player data still holds after
      // our cleaning. "live" is what the video player itself is using now.
      // Counts only; null = that field is absent.
      const count = value => Array.isArray(value) ? value.length : value == null ? null : "not-array";
      const adCounts = data => data && typeof data === "object"
        ? { adSlots: count(data.adSlots), adPlacements: count(data.adPlacements), playerAds: count(data.playerAds) } : null;
      let live = null;
      try { const player = document.getElementById("movie_player"); if (typeof player?.getPlayerResponse === "function") live = player.getPlayerResponse(); } catch (_) {}
      const raw = window.ytplayer?.config?.args?.raw_player_response;
      const adData = { initial: adCounts(initial), rawPlayerResponse: adCounts(raw), legacy: adCounts(legacy), live: adCounts(live),
        liveIsInitial: !!live && live === initial };
      return { initialPresent: !!initial, initialAdKeys: adKeys(initial), initialAdPaths: adPaths(initial),
        legacyPresent: !!legacy, legacyAdKeys: adKeys(legacy), legacyAdPaths: adPaths(legacy), networkMachine,
        mediaComparisonAvailable: formatIds.size > 0, mediaTimeline, adData };
    }});
    return rows?.[0]?.result || null;
  } catch (_) { return null; }
}
if (debugAvailable) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(async (info) => {
    if (info.rule && info.rule.rulesetId === "_dynamic" && info.rule.ruleId === GPC_RULE_ID) return;   // matches every request
    const matchedAt = Date.now();
    const rs = info.rule && info.rule.rulesetId;
    let cat = RULESET_CAT[rs] ? await staticCat(rs, info.rule.ruleId) : (rs === "_dynamic" ? await listCat(info.rule.ruleId) : null);
    await loadStats();
    if (info.request.tabId >= 0 && /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/.test(hostOf(info.request.initiator || ""))) {
      const t = tabOf(info.request.tabId);
      t.ytMatches ||= [];
      if (t.ytMatches.length < 128) {
        t.ytMatches.push({ epoch: matchedAt, kind: youtubeMatchKind(info.request.url), ruleset: rs, ruleId: info.rule.ruleId });
        scheduleFlush();
      }
    }
    if (!cat) return;
    const d = baseDomain(hostOf(info.request.url));
    if (cat === "annoy") { life.totals.annoy++; if (info.request.tabId >= 0) tabOf(info.request.tabId).annoyNet = (tabOf(info.request.tabId).annoyNet || 0) + 1; }
    else life.totals[cat]++;
    // Record the domain for the category breakdown too.
    bump(life.domains, d, cat);
    if (info.request.tabId >= 0) bump(tabOf(info.request.tabId).domains, d, cat);
    scheduleFlush();
  });
}

const MATCH_POLL_ALARM = "matchPoll";
const SW_STARTED = Date.now();
let lastMatchPoll = 0, lastPollAt = 0, polling = null;
// STORE INSTALLS. Chrome only sends the detailed "a rule matched" events to extensions
// loaded unpacked (the block above), so an installed Voidy gets its statistics from two
// things that work everywhere:
//   1. Chrome's matched-rule log (getMatchedRules), read often: exact counts per category,
//      for the bundled lists and the downloaded ones alike.
//   2. webRequest.onErrorOccurred (observation only, nothing is blocked or changed): which
//      site a blocked request was for, so "Top companies" and the per-page list work.
// Read at least every minute (Chrome keeps the log for about five minutes), and whenever a
// page asks for statistics, at most every POLL_MIN_GAP_MS. Chrome refuses more than 20
// reads per 10 minutes, so reads are counted (in session storage, which survives the
// worker going to sleep) and stop at POLL_BUDGET; the log keeps 5 minutes, so the next
// allowed read still catches up.
const POLL_MIN_GAP_MS = 20000;
const POLL_BUDGET = 18, POLL_WINDOW_MS = 10 * 60 * 1000;
const catOfRule = new Map();                                    // "ruleset:id" -> category (or null)
async function categoryOfMatch(rule) {
  const key = rule.rulesetId + ":" + rule.ruleId;
  if (catOfRule.has(key)) return catOfRule.get(key);
  let cat = null;
  if (RULESET_CAT[rule.rulesetId]) cat = await staticCat(rule.rulesetId, rule.ruleId);
  else if (rule.rulesetId === "_dynamic" && rule.ruleId !== GPC_RULE_ID) cat = await listCat(rule.ruleId);
  if (catOfRule.size > 5000) catOfRule.clear();
  catOfRule.set(key, cat);
  return cat;
}
function pollMatchedRules() {
  if (debugAvailable) return Promise.resolve();
  if (polling) return polling;
  polling = (async () => {
    await loadStats();
    if (lastMatchPoll === 0) { const s = await chrome.storage.session.get({ lastMatchPoll: 0 }); lastMatchPoll = s.lastMatchPoll || SW_STARTED; }   // count from when Voidy started, not from the first look
    const now = Date.now();
    const { pollCalls = [] } = await chrome.storage.session.get({ pollCalls: [] });
    const recent = pollCalls.filter((t) => now - t < POLL_WINDOW_MS);
    if (recent.length >= POLL_BUDGET) return;
    lastPollAt = now;
    await chrome.storage.session.set({ pollCalls: [...recent, now] });
    let res;
    try { res = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: lastMatchPoll }); } catch (e) { return; }
    const info = (res && res.rulesMatchedInfo) || [];
    let newest = lastMatchPoll;
    for (const m of info) {
      if (!m.rule || m.timeStamp <= lastMatchPoll) continue;     // already counted
      newest = Math.max(newest, m.timeStamp);
      if (m.rule.rulesetId === "_dynamic" && m.rule.ruleId === GPC_RULE_ID) continue;   // matches every request
      const cat = await categoryOfMatch(m.rule);
      if (cat) life.totals[cat]++;
    }
    lastMatchPoll = newest;
    await chrome.storage.session.set({ lastMatchPoll });
    if (info.length) scheduleFlush();
  })().finally(() => { polling = null; });
  return polling;
}
const pollSoon = () => (Date.now() - lastPollAt < POLL_MIN_GAP_MS ? Promise.resolve() : pollMatchedRules());

// Which category to show next to a blocked site. The exact counts come from the rules
// themselves (above); this only picks a colour and a heading for the site list.
const TRACKER_WORD = /(^|[.-])(analytics?|track(ing|er|ers)?|metrics?|telemetry|pixel|beacons?|stats?|statistics|collect|insights?|measure|measurement|tagmanager|gtm|segment|mixpanel|amplitude|hotjar|clarity|optimizely|newrelic|datadog|sentry|fullstory|heap|crazyegg|chartbeat|parsely|scorecardresearch|quantserve|demdex|krxd|bluekai)([.-]|\d|$)/i;
function guessBlockedCategory(host) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return "security";
  return TRACKER_WORD.test(host) ? "privacy" : "ads";
}
// Blocked requests, as the browser reports them: the badge count everywhere, and
// on store installs also which sites were blocked (unpacked copies get that from
// the detailed events above).
if (chrome.webRequest && chrome.webRequest.onErrorOccurred) {
  // Firefox reports a block as "NS_ERROR_ABORT" before the request ever sends its headers;
  // requests a page cancels itself fail later, with other errors. So on Firefox a request
  // counts only if it failed that way before reaching onSendHeaders.
  const FIREFOX = (() => { try { return chrome.runtime.getURL("").startsWith("moz-extension://"); } catch (e) { return false; } })();
  const sentHeaders = new Set();
  if (FIREFOX) {
    const ALL = { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] };
    chrome.webRequest.onSendHeaders.addListener((d) => { sentHeaders.add(d.requestId); }, ALL);
    chrome.webRequest.onCompleted.addListener((d) => { sentHeaders.delete(d.requestId); }, ALL);
  }
  const firefoxBlocked = (d) => {
    const sent = sentHeaders.delete(d.requestId);
    return FIREFOX && d.error === "NS_ERROR_ABORT" && !sent;
  };
  chrome.webRequest.onErrorOccurred.addListener(async (d) => {
    if (d.error !== "net::ERR_BLOCKED_BY_CLIENT" && !firefoxBlocked(d)) return;
    const host = hostOf(d.url);
    if (!host) return;
    await loadStats();
    if (d.tabId >= 0) { tabOf(d.tabId).blocked++; drawBadge(d.tabId); }
    if (!debugAvailable) {
      const dom = baseDomain(host), cat = guessBlockedCategory(host);
      bump(life.domains, dom, cat);
      if (d.tabId >= 0) bump(tabOf(d.tabId).domains, dom, cat);
    }
    scheduleFlush();
  }, { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] });
}
// The timer only reads the log when nothing else has lately (saves the read budget).
if (!debugAvailable) chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === MATCH_POLL_ALARM && Date.now() - lastPollAt > 90000) pollMatchedRules(); });

chrome.tabs.onRemoved.addListener(async (tabId) => { await loadStats(); delete tabStats[tabId]; scheduleFlush(); });
// New page in a tab: start its per-page stats fresh. Fires when the navigation
// commits, before the page's own requests, so no early blocks are wiped.
// A reload of the same address reports no url, so only the status is checked
// (otherwise mode switches, which reload, kept adding to the old counts).
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "loading") return;
  await loadStats();
  tabStats[tabId] = emptyTab();
  scheduleFlush();
  drawBadge(tabId);
  markStuck(tabId, false);
});

// ---- Look-alike sites (src/lookalike.js, checked on this computer) ----------
// Strong look-alikes stop at the warning page right away; weak ones only when
// the page asks for a password (cosmetic.js reports that). "Continue anyway"
// is remembered for the site.
async function lookalikeFor(state, host) {
  if (!state.filters.security || state.guard.lookalike === false || effectiveLevel(state, host) === "off") return null;
  const hit = VOIDY_LOOKALIKE.check(host);
  if (!hit) return null;
  const { lookalikeOk = [] } = await chrome.storage.local.get("lookalikeOk");
  return suffixes(host).some((h) => lookalikeOk.includes(h)) ? null : hit;
}
function lookalikeWarning(tabId, url, hit) {
  const q = new URLSearchParams({ kind: "lookalike", brand: hit.brand, why: hit.why });
  return chrome.tabs.update(tabId, { url: chrome.runtime.getURL("guard/blocked.html") + "?" + q + "#" + url });
}
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  const url = info.url || (info.status === "loading" && tab && tab.url);
  if (!url || !/^https?:/.test(url)) return;
  let host = ""; try { host = new URL(url).hostname; } catch (e) { return; }
  const hit = await lookalikeFor(await getState(), canonHost(host));
  if (hit && hit.strength === "strong") { await logEvent({ kind: "lookalike", host, brand: hit.brand }); await lookalikeWarning(tabId, url, hit); }
});


async function pageBreakdown(tabId) {
  const out = { ads: 0, privacy: 0, security: 0, annoyNet: 0 };
  try {
    const m = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    for (const r of m.rulesMatchedInfo) {
      const sc = RULESET_CAT[r.rule.rulesetId] ? await staticCat(r.rule.rulesetId, r.rule.ruleId) : null;
      if (sc) out[sc]++;
      else if (r.rule.rulesetId === "_dynamic") {
        const c = await listCat(r.rule.ruleId);
        if (c === "ads") out.ads++; else if (c === "privacy") out.privacy++; else if (c === "security") out.security++; else if (c === "annoy") out.annoyNet++;
      }
    }
  } catch (e) {}
  return out;
}
// Local display labels group blocked domains by the category of our own rules.
const FALLBACK_CAT = {
  ads:      { slug: "_ads",      n: "Ads",               c: "#8a6cf0" },
  privacy:  { slug: "_trackers", n: "Trackers",          c: "#e0a31c" },
  security: { slug: "_malicious", n: "Malicious",        c: "#e8566f" },
  annoy:    { slug: "_widgets",  n: "Pop-ups & widgets", c: "#3ecf8e" }
};
// One blocked domain -> a display record. Names use this project's small local
// map where known and otherwise show the blocked domain itself.
function labelDomain(domain, ourCat, count) {
  const f = FALLBACK_CAT[ourCat] || FALLBACK_CAT.ads;
  return { domain, count, ourCat, name: COMPANIES[domain] || domain, org: COMPANIES[domain] || null,
           catSlug: f.slug, catName: f.n, color: f.c };
}
function topDomains(map, n) {
  return Object.entries(map).sort((a, b) => b[1].n - a[1].n).slice(0, n)
    .map(([domain, v]) => labelDomain(domain, v.cat, v.n));
}
// Group blocked domains by our own filter category and local company labels.
function categoryBreakdown(map) {
  const cats = {};
  for (const [domain, v] of Object.entries(map)) {
    const d = labelDomain(domain, v.cat, v.n);
    const c = cats[d.catSlug] || (cats[d.catSlug] = { slug: d.catSlug, name: d.catName, color: d.color, count: 0, items: {} });
    c.count += v.n;
    const key = d.org || d.name || domain;
    const it = c.items[key] || (c.items[key] = { name: key, count: 0, domains: [] });
    it.count += v.n;
    if (it.domains.length < 8 && !it.domains.includes(domain)) it.domains.push(domain);
  }
  return Object.values(cats).sort((a, b) => b.count - a.count).map((c) => ({
    slug: c.slug, name: c.name, color: c.color, count: c.count,
    items: Object.values(c.items).sort((a, b) => b.count - a.count).slice(0, 12)
  }));
}

// ============================================================================
// lifecycle
// ============================================================================
function migrateAutoPolicy(state) {
  const manualHosts=new Set((state.log || []).filter(e=>e.signal==="user-report").map(e=>e.host));
  return Object.fromEntries(Object.entries(state.autoState || {}).map(([host,entry])=>[
    host, entry && (entry.ceiling || entry.accepted || entry.manualMax || manualHosts.has(host)) ? entry
      : {level:AUTO_START,askShown:false,lastDetectTs:0,trialing:false}
  ]));
}
async function init() {
  const cur = await chrome.storage.local.get(null);
  const merged = { ...DEFAULTS, ...cur,
    guard: { ...DEFAULT_GUARD, ...(cur.guard || {}) },
    annoy: { ...DEFAULT_ANNOY, ...(cur.annoy || {}) } };
  delete merged.youtubeHandshake;                // settings from older versions, no longer used
  delete merged.youtubeProbeTrial;
  delete merged.youtubeNetworkOnly;
  delete merged.youtubeInitialOnly;
  // v2.x -> v3 migration: v2 stored defaultMode "full"; v3's default is Auto.
  if (!cur.schema || cur.schema < 3) { if (!cur.defaultMode || cur.defaultMode === "full") merged.defaultMode = "auto"; }
  // Forget decisions made under the old start-in-stealth/library-presence
  // policy once. Explicit manual choices and breakage limits remain intact.
  if (cur.autoPolicyVersion !== AUTO_POLICY_VERSION) merged.autoState=migrateAutoPolicy(cur);
  merged.autoPolicyVersion=AUTO_POLICY_VERSION;
  // Hosts that are aliases (youtube.com / m.youtube.com -> www.youtube.com):
  // move their stored settings to the canonical name, unless it has its own.
  for (const key of ["sites", "autoState", "shieldNetworks"]) {
    const m = merged[key] || {};
    for (const h of Object.keys(m)) {
      const c = canonHost(h);
      if (c !== h) { if (!(c in m)) m[c] = m[h]; delete m[h]; }
    }
  }
  // Shield mode no longer exists: sites that used it go back to the default (Auto).
  if (merged.defaultMode === "shield") merged.defaultMode = "auto";
  merged.sites = Object.fromEntries(Object.entries(merged.sites || {}).filter(([, mode]) => mode !== "shield"));
  merged.schema = SCHEMA;
  merged.listSigs = {};                                 // force list rules to (re)install after an update
  delete merged.freshLists;                             // large, and untouched here: don't rewrite it
  await chrome.storage.local.set(merged);
  if ("youtubeHandshake" in cur) await chrome.storage.local.remove("youtubeHandshake");
  if ("youtubeProbeTrial" in cur) await chrome.storage.local.remove("youtubeProbeTrial");
  if ("youtubeNetworkOnly" in cur) await chrome.storage.local.remove("youtubeNetworkOnly");
  if ("youtubeInitialOnly" in cur) await chrome.storage.local.remove("youtubeInitialOnly");
  if (!merged.lifetime) await chrome.storage.local.set({ lifetime: emptyLife() });
  await enableBadge();
  for(const key of Object.keys(BROWSER_PRIVACY))if(merged.extraPrivacy?.[key])await setBrowserPrivacy(key,true);
  await reconcileRulesets();
  await reconcileDynamicRules();
  if (!debugAvailable) chrome.alarms.create(MATCH_POLL_ALARM, { periodInMinutes: 2 });
  else { try { await chrome.alarms.clear(MATCH_POLL_ALARM); } catch (e) {} }
}
// ---- Right-click menu: "Hide this with Voidy" opens the element picker with the
// clicked element already chosen. An ad inside a frame selects the frame itself.
const HIDE_MENU = "voidy-hide";
function createHideMenu() {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: HIDE_MENU, title: "Hide this with Voidy",
    contexts: ["page", "image", "link", "frame", "video", "audio", "selection"], documentUrlPatterns: ["http://*/*", "https://*/*"] }));
}
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === HIDE_MENU) hideFromMenu(info, tab); });
async function hideFromMenu(info, tab) {
  if (!tab || tab.id < 0) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, args: [info.frameId || 0, info.frameUrl || ""],
      func: (frameId, frameUrl) => {
        let el = null;
        if (frameId === 0) {
          const t = globalThis.__voidyContextTarget;
          if (t && Date.now() - t.at < 10000) el = t.el;
        } else if (frameUrl) {                                  // find the frame the ad lives in
          const frames = [...document.querySelectorAll("iframe, frame")];
          el = frames.find((f) => f.src === frameUrl) || frames.find((f) => f.src && frameUrl.startsWith(f.src.split("#")[0]));
        }
        globalThis.__voidyPreselect = el;
      } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ["src/picker.js"] });
  } catch (e) {}   // pages Chrome doesn't let extensions touch
}
chrome.runtime.onInstalled.addListener(createHideMenu);

LIST_UPDATES.init(async () => { domainSets = null; listInfo = null; await reconcileDynamicRules(); });
chrome.runtime.onInstalled.addListener(async (details) => {
  await LIST_UPDATES.onInstalled(details); await init();
  // First install only (never on updates): open the short "Start here" guide once.
  if (details.reason === "install") { try { await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html#guide") }); } catch (e) {} }
});
chrome.runtime.onStartup.addListener(async () => { await init(); await LIST_UPDATES.schedule(); });

// ============================================================================
// messaging
// ============================================================================
const PAIR_RE = /^[a-z0-9.-]+\.[a-z0-9-]+>[a-z0-9.-]+\.[a-z0-9-]+$/;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
// (Shield mode no longer exists; init() moves saved Shield sites back to Auto.)
const MODES = ["auto", "full", "lite", "stealth1", "stealth2", "stealth3", "off"];

// Rule counts for the settings page ("what's in each list"). Computed once.
let listInfo = null;
async function getListInfo() {
  if (listInfo) return listInfo;
  // Count what a rule actually covers: one DNR rule can list thousands of domains,
  // so "124 rules" would badly understate a 49,000-domain list.
  const size = (rules) => rules.reduce((n, r) => n + (((r.condition || {}).requestDomains || []).length || 1), 0);
  const count = async (f) => { try { return size(await (await fetch(chrome.runtime.getURL(f))).json()); } catch (e) { return 0; } };
  const [ads, privacy, security] = await Promise.all(["rules/ads.json", "rules/privacy.json", "rules/security.json"].map(count));
  const nd = await loadNetData();
  const lists = {};
  for (const [k, v] of Object.entries(nd)) if (Array.isArray(v)) lists[k] = size(v);
  lists.antiadblock = ANTIADBLOCK_DOMAINS.length;   // synthetic, not in netrules.json — see reconcileListRules()
  const cd = await loadCosData();
  const cos = {};
  for (const [c, sels] of Object.entries(cd.lowly || {})) cos[c] = (cos[c] || 0) + sels.length;
  for (const hits of Object.values(cd.tokens || {})) for (const [ci] of pairs(hits)) { const c = cd.cats[ci]; cos[c] = (cos[c] || 0) + 1; }
  const upd = await LIST_UPDATES.status();
  const fresh = Object.fromEntries(Object.entries(upd.cats).map(([k, v]) => [k, v.added]));
  listInfo = { static: { ads, privacy, security }, fresh, lists, cosmetic: cos,
    surrogates: SURROGATES.length, fakeSuccess: FAKE_SUCCESS_DOMAINS };
  return listInfo;
}

// Is this message from one of Voidy's own pages at `path`? Web-accessible pages
// (the prompt, the warning page) have two addresses: Voidy's real one and
// Chrome's per-session random one (use_dynamic_url). Both belong to Voidy only.
function fromOwnPage(sender, path) {
  if (sender.id !== chrome.runtime.id) return false;
  const url = sender.url || "";
  return url.startsWith("chrome-extension://" + chrome.runtime.id + "/" + path) || url.startsWith(chrome.runtime.getURL(path));
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && typeof msg.host === "string") msg.host = canonHost(msg.host);   // see HOST_ALIASES
    const state = await getState();
    // frameHost stays the page's REAL hostname (not canonicalized): it indexes
    // bundled per-site cosmetic selectors scraped from real filter lists, which
    // know nothing about our alias grouping and are keyed by the real domain.
    const frameHost = hostOf(sender.url || "");
    const topHost = msg.host || canonHost(frameHost);    // content scripts send the TOP site's host; canonicalize when it's our own fallback
    const tabId = sender.tab && sender.tab.id;
    // Our popup / options / guard pages (not content scripts, whose url is the web page).
    const fromExtPage = fromOwnPage(sender, "");

    // ---------------- content scripts ----------------
    if(msg.type==="ytStartup"){
      if(tabId>=0 && /(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/.test(frameHost) && sender.frameId===0){
        const clean={};for(const k of ["videoPresentMs","firstFrameMs","firstContentFrameMs","firstPlayMs","firstLoadStartMs","firstMetadataMs","firstCanPlayMs","loadStarts","waiting","stalled","emptied","firstWaitingMs","firstStalledMs","firstEmptiedMs","firstAdStateMs","lastAdStateMs","adStateTransitions","mediaError","readyState","networkState"]){const v=msg.metrics?.[k];clean[k]=Number.isFinite(v)&&v>=0?Math.min(v,3600000):null;}clean.adObserved=msg.metrics?.adObserved===true;
        clean.resources={};for(const kind of ["playerApi","media","adService","adServiceId","adServiceLvz","adServiceOther","startupProbe"]){
          const input=msg.metrics?.resources?.[kind]||{},out=clean.resources[kind]={};
          for(const key of ["count","firstStartMs","lastStartMs","lastEndMs","longestStartMs","longestDurationMs"]){const v=input[key];out[key]=Number.isFinite(v)&&v>=0?Math.min(v,3600000):null;}
        }
        await loadStats();tabOf(tabId).ytStartup=clean;
        const origin=msg.metrics?.navigationEpochMs;
        if(Number.isFinite(origin)&&origin>1000000000000&&origin<10000000000000)tabOf(tabId).ytOrigin=origin;
      }
      sendResponse({ok:true});return;
    }
    if (msg.type === "getMode") { sendResponse({ mode: effectiveLevel(state, topHost) }); return; }
    if (msg.type === "getConfig") {
      await fixTest();
      const scriptsPaused = fixPaused(state, topHost, "#scripts");
      const level = scriptsPaused ? "lite" : effectiveLevel(state, topHost);
      const top = sender.frameId === 0;
      if (top) { maybeGentleRetry(topHost); noteSharedFix(state, topHost); }
      const cats = cosmeticCats(state, topHost);
      sendResponse({
        level,
        guard: { ...state.guard, enabled: guardOn(state, topHost) && !scriptsPaused,
                 fakePopup: state.guard.fakePopups === "always" || (state.guard.fakePopups !== "never" && /^stealth[123]$/.test(level)) },
        sensitive: isSensitiveUrl(state, sender.url) || isSensitiveUrl(state, msg.topUrl || ""),
        lookalike: top ? await lookalikeFor(state, topHost) : null,
        shieldNetwork: level === "shield" ? (state.shieldNetworks[topHost] || "google") : null,
        auto: storedMode(state, topHost) === "auto",
        annoy: {
          cats,
          cookieMode: cats.includes("cookies") ? state.cookieMode : "off",
          notifications: cats.includes("notifications"),
          rescue: state.rescue
        },
        cosmetic: await cosmeticInit(state, topHost, frameHost),
        fixPanel: top && tabId != null && await fixPanelFor(tabId),
        feeds: await feedsFor(state, topHost, level)
      });
      return;
    }
    if (msg.type === "cosmeticTokens") {
      sendResponse({ rules: await cosmeticTokens(state, topHost, frameHost, msg.tokens || []) });
      return;
    }
    if (msg.type === "adblockDetected") {
      if (topHost && tabId != null && sender.frameId === 0) await onDetected(topHost, tabId, msg.signal || "wall", msg.level);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "cosmeticCount") {                   // current counts for one frame + source
      if (tabId == null) { sendResponse({ ok: false }); return; }
      await loadStats();
      const t = tabOf(tabId);
      t.cos = t.cos || {};
      const key = sender.frameId + ":" + (msg.src || "engine");
      const prev = t.cos[key] || { ads: 0, annoy: 0 };
      const ads = Math.max(prev.ads, Math.min(2000, Number(msg.ads) || 0));
      const annoy = Math.max(prev.annoy, Math.min(2000, Number(msg.annoy) || 0));
      life.totals.hidden += ads - prev.ads;
      life.totals.annoy += annoy - prev.annoy;
      t.cos[key] = { ads, annoy };
      scheduleFlush();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "spotifyConfig") { sendResponse(sender.frameId === 0 ? await spotifyConfig(state, topHost) : null); return; }
    if (msg.type === "adMute") {
      if (tabId == null || sender.frameId !== 0 || !/(^|\.)spotify\.com$/.test(frameHost) || !(await spotifyConfig(state, topHost))) { sendResponse({ ok: false }); return; }
      sendResponse(await adMute(tabId, msg.on === true)); return;
    }
    if (msg.type === "feedCheck") {
      if (tabId == null || !msg.counts || typeof msg.counts !== "object") { sendResponse({ ok: false }); return; }
      await loadStats();
      const t = tabOf(tabId), c = msg.counts, n = (v) => Math.max(0, Math.min(1e6, Number(v) || 0));
      const matched = {};
      for (const [k, v] of Object.entries(c.matched || {}).slice(0, 20)) if (/^[A-Za-z0-9_.]{1,330}$/.test(k)) matched[k] = n(v);
      t.feedCheck = { host: topHost, replies: n(c.replies), items: n(c.items), removed: n(c.removed), matched };
      t.cos = t.cos || {};
      const key = sender.frameId + ":feed", prev = t.cos[key] || { ads: 0, annoy: 0 };
      const ads = Math.max(prev.ads, Math.min(2000, n(c.removed)));
      life.totals.hidden += ads - prev.ads;
      t.cos[key] = { ads, annoy: 0 };
      scheduleFlush();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "held") {
      if (tabId == null) { sendResponse({ ok: false }); return; }
      await loadStats();
      tabOf(tabId).held++; life.totals.held++;
      scheduleFlush();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "saveTrustPair") {
      // Only our own extension-origin prompt may save trust (never a web page).
      const fromGuardFrame = fromOwnPage(sender, "guard/guard-frame.html");
      const pair = String(msg.pair || "").toLowerCase();
      if (!fromGuardFrame || !PAIR_RE.test(pair)) { sendResponse({ ok: false }); return; }
      const pairs = new Set(state.guard.trustPairs || []); pairs.add(pair);
      await chrome.storage.local.set({ guard: { ...state.guard, trustPairs: [...pairs].slice(-200) } });
      await logEvent({ kind: "trust", host: pair });
      sendResponse({ ok: true });
      return;
    }

    // Everything below changes settings: only our popup / options pages.
    if (msg.type === "addMyHide" || msg.type === "removeMyHide") {
      const host = String(msg.host || "").toLowerCase();
      // Settings pages may change any site; the picker only the page it runs on.
      let senderHost = ""; try { senderHost = canonHost(new URL(sender.url).hostname); } catch (e) {}
      const allowed = fromExtPage || (sender.frameId === 0 && senderHost === host);
      if (!allowed || !HOST_RE.test(host) || (msg.type === "addMyHide" && !validHideSelector(msg.selector))) { sendResponse({ ok: false }); return; }
      const { myHides = {} } = await chrome.storage.local.get("myHides");
      const list = (myHides[host] || []).filter((s) => s !== msg.selector && !(msg.type === "removeMyHide" && msg.all));
      if (msg.type === "addMyHide") list.push(msg.selector);
      if (list.length) myHides[host] = list.slice(-MY_HIDES_PER_SITE); else delete myHides[host];
      await chrome.storage.local.set({ myHides });
      sendResponse({ ok: true, count: list.length });
      return;
    }
    if (msg.type === "lookalikePassword") {
      // A look-alike page is open (strong), or a weak one just showed a password box:
      // warn now (top frame only, re-checked here).
      const hit = sender.frameId === 0 && tabId >= 0 ? await lookalikeFor(state, topHost) : null;
      if (hit) { await logEvent({ kind: "lookalike", host: topHost, brand: hit.brand }); await lookalikeWarning(tabId, sender.url, hit); }
      sendResponse({ ok: !!hit });
      return;
    }
    if (!fromExtPage) { sendResponse({ ok: false, error: "not allowed" }); return; }

    // ---------------- popup ----------------
    if (msg.type === "getPopup") {
      await pollSoon();                       // store installs: read what Chrome logged since last time
      await loadStats();
      const host = msg.host;
      const t = (msg.tabId != null && tabStats[msg.tabId]) || emptyTab();
      const a = state.autoState[host];
      const cos = cosTotals(t);
      sendResponse({
        host, mode: storedMode(state, host), level: effectiveLevel(state, host),
        stuck: !!(a && a.askShown && !a.accepted),
        accepted: !!(a && a.accepted) && storedMode(state, host) === "auto",
        autoMax: state.autoMax, ceiling: (a && a.ceiling) || null, theme: state.theme,
        shieldNetwork: state.shieldNetworks[host] || "google",
        widgets: widgetsOn(state, host),
        extraPrivacy: await extraPrivacyStatus(state,host),
        ytStartup:t.ytStartup||null,
        feedCheck: t.feedCheck || null,
        adMuted: !!(msg.tabId != null && ((await chrome.storage.session.get({ mutedByVoidy: {} })).mutedByVoidy || {})[msg.tabId]),
        ytPlayerFields:msg.includeYtFields&&/(^|\.)(youtube\.com|youtube-nocookie\.com|youtubekids\.com)$/.test(host)?await youtubePlayerFields(msg.tabId):null,
        ytMatches:Number.isFinite(t.ytOrigin)?(t.ytMatches||[]).map(m=>({
          atMs:Math.round(m.epoch-t.ytOrigin),kind:m.kind,ruleset:m.ruleset,ruleId:m.ruleId
        })).filter(m=>m.atMs>=-500&&m.atMs<=30000).slice(0,64):[],
        guard: guardOn(state, host), guardEnabled: state.guard.enabled !== false,
        page: await pageBreakdown(msg.tabId),   // popup re-asks Chrome itself (rate limit); this is a fallback
        listRanges: listRanges || (await chrome.storage.local.get({ listRanges: [] })).listRanges,
        rulesetCats: RULESET_CAT,
        hidden: cos.ads, annoy: cos.annoy, held: t.held, blocked: t.blocked || 0,   // (popup adds page.annoyNet to annoy)
        pageTop: topDomains(t.domains, 8),
        pageCats: categoryBreakdown(t.domains),
        lifetime: { since: life.since, totals: life.totals, top: topDomains(life.domains, 8), cats: categoryBreakdown(life.domains) },
        debugAvailable
      });
      return;
    }
    // ---- "Fix this site" (popup, panel and settings pages only) ----
    if (/^(fixStart|fixAnswer|fixPick|fixStop|fixDismiss|getFixTest|listMyFixes|removeMyFix|easeOff)$/.test(msg.type) && !fromExtPage) { sendResponse({ ok: false }); return; }
    if (msg.type === "easeOff") {                         // the panel's "Ease off on this site": one level lower, like the popup's link
      if (!HOST_RE.test(String(msg.host || "")) || !Number.isInteger(msg.tabId)) { sendResponse({ ok: false }); return; }
      await chrome.storage.session.remove("fixResult");
      if (storedMode(state, msg.host) === "auto") await onBrokeAuto(msg.host, msg.tabId);
      else {
        const idx = LADDER.indexOf(effectiveLevel(state, msg.host));
        await chrome.storage.local.set({ sites: { ...state.sites, [msg.host]: LADDER[Math.max(0, idx - 1)] } });
        await reconcileDynamicRules(); await reloadTab(msg.tabId);
      }
      sendResponse({ ok: true }); return;
    }
    if (msg.type === "fixStart") {
      if (!HOST_RE.test(String(msg.host || "")) || !Number.isInteger(msg.tabId)) { sendResponse({ ok: false }); return; }
      sendResponse(await startFixTest(msg.host, msg.tabId)); return;
    }
    if (msg.type === "fixAnswer") { sendResponse(await answerFixTest(msg.works === true)); return; }
    if (msg.type === "fixPick") {
      const t = await fixTest();
      sendResponse(t && t.S.pool.includes(msg.item) ? await finishFix(t, msg.item) : null); return;
    }
    if (msg.type === "fixStop") {
      const t = await fixTest();
      if (t) { await endFixTest(null); await reloadTab(t.tabId); }
      sendResponse({ ok: true }); return;
    }
    if (msg.type === "fixDismiss") { await chrome.storage.session.remove("fixResult"); sendResponse({ ok: true }); return; }
    if (msg.type === "getFixTest") {
      const t = await fixTest();
      if (t) { sendResponse(fixView(t)); return; }
      const { fixResult = null } = await chrome.storage.session.get("fixResult");
      sendResponse(fixResult); return;
    }
    if (msg.type === "listMyFixes") { sendResponse(state.myFixes); return; }
    if (msg.type === "removeMyFix") {
      if (!HOST_RE.test(String(msg.host || "")) || typeof msg.item !== "string") { sendResponse({ ok: false }); return; }
      await removeMyFix(msg.host, msg.item); sendResponse({ ok: true }); return;
    }
    if (msg.type === "brokeAuto") { await onBrokeAuto(msg.host, msg.tabId); sendResponse({ ok: true }); return; }
    if (msg.type === "manualClimb") {
      if (!HOST_RE.test(String(msg.host || ""))) { sendResponse({ ok: false }); return; }
      const r = await manualClimb(msg.host, msg.tabId);
      if (r.ok) await reloadTab(msg.tabId);
      sendResponse(r);
      return;
    }
    if (msg.type === "resolveStuck") {
      const host = msg.host;
      if (!HOST_RE.test(String(host || ""))) { sendResponse({ ok: false }); return; }
      await withHostLock(host, async () => {
        const state = await getState();          // fresh, inside the lock, so a racing Auto save can't undo this
        const a = autoEntry(state, host);
        if (["off", "stealth3"].includes(msg.choice)) {
          // Leaving Auto: drop what Auto learned here, as setMode does, so the
          // "keeps detecting" box doesn't come back on the next popup.
          const autoState = { ...state.autoState }; delete autoState[host];
          await chrome.storage.local.set({ sites: { ...state.sites, [host]: msg.choice }, autoState });
        } else if (msg.choice === "wall") {
          // "Accept the wall" is remembered: Auto stops climbing and asking on
          // this site, at the level it's on, until you pick a mode again.
          a.accepted = true; a.askShown = false; a.fresh = false;
          await saveAuto(host, a);
        }
      });
      await reconcileDynamicRules();
      await logEvent({ kind: "resolve", host, choice: msg.choice });
      await markStuck(msg.tabId, false);
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setGuardSite") {
      const guardOff = { ...state.guardOff };
      if (msg.on) for (const h of suffixes(msg.host)) delete guardOff[h]; else guardOff[msg.host] = true;
      await chrome.storage.local.set({ guardOff });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "guardCheck") { sendResponse(await listedAs(msg.host)); return; }
    if (msg.type === "proceedLookalike") {
      const fromPage = sender.frameId === 0 && sender.tab && fromOwnPage(sender, "guard/blocked.html");
      let host = ""; try { const u = new URL(msg.url); if (/^https?:$/.test(u.protocol)) host = u.hostname; } catch (e) {}
      if (!fromPage || !host || !VOIDY_LOOKALIKE.check(host)) { sendResponse({ ok: false }); return; }
      const { lookalikeOk = [] } = await chrome.storage.local.get("lookalikeOk");
      await chrome.storage.local.set({ lookalikeOk: [...new Set([...lookalikeOk, canonHost(host)])].slice(-500) });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "proceedMalware") {
      // Only our own warning page, as a top-level tab (never framed) may do this.
      const fromPage = sender.frameId === 0 && sender.tab && fromOwnPage(sender, "guard/blocked.html");
      let host = "", proto = "";
      try { const u = new URL(msg.url); host = u.hostname; proto = u.protocol; } catch (e) {}
      // Only for a host that really is on the malware list: blocked.html is
      // web-accessible, so a site could send you to blocked.html#<its own URL>
      // and have one click switch off blocking for itself.
      if (!fromPage || !host || (proto !== "http:" && proto !== "https:") || !(await listedAs(host)).malware) { sendResponse({ ok: false }); return; }
      // A plain "allow" for requests TO that host (the page and its own files),
      // not allowAllRequests: ads and other listed hosts on it stay blocked.
      const id = await nextSessionRuleId();
      await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id, priority: PRIO.PROCEED,
        // resourceTypes listed explicitly: with none, Chrome would skip main_frame —
        // the page itself would keep landing back on the warning page.
        action: { type: "allow" }, condition: { requestDomains: [host], resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image",
          "font", "object", "xmlhttprequest", "ping", "media", "websocket", "other"] } }] });
      await logEvent({ kind: "malware-proceed", host });
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setWidgets") {
      const widgetOff = { ...state.widgetOff };
      if (msg.on) for (const h of suffixes(msg.host)) delete widgetOff[h]; else widgetOff[msg.host] = true;
      await chrome.storage.local.set({ widgetOff });
      await reconcileListRules();
      sendResponse({ ok: true });
      return;
    }

    // ---------------- options page ----------------
    if (msg.type === "getExtraPrivacy") { sendResponse(await extraPrivacyStatus(state,msg.host)); return; }
    if (msg.type === "setExtraPrivacy" && fromExtPage) {
      const result=await withHostLock(msg.host,async()=>{
          const current=await getState();
          const extraPrivacy={...current.extraPrivacy};
          for(const key of Object.keys(BROWSER_PRIVACY))if(typeof msg[key]==="boolean"){
            const applied=await setBrowserPrivacy(key,msg[key]);if(!applied.ok)return applied;extraPrivacy[key]=msg[key];
          }
          if(typeof msg.ipv6==="boolean")extraPrivacy.ipv6=msg.ipv6;
          const patch={extraPrivacy};
          if(Object.prototype.hasOwnProperty.call(FINGERPRINT_PRESETS,msg.fingerprintDefault))patch.fingerprintDefault=msg.fingerprintDefault;
          // "Use the every-site setting" for this site: forget its own choice
          if(msg.followDefault===true&&HOST_RE.test(msg.host||"")){const own=fingerprintOwner(current,msg.host);if(own){patch.fingerprintSites={...current.fingerprintSites};delete patch.fingerprintSites[own];}}
          if((typeof msg.fingerprint==="boolean"||msg.policy)&&HOST_RE.test(msg.host||""))patch.fingerprintSites={...current.fingerprintSites,[msg.host]:fingerprintPolicy(msg.policy??msg.fingerprint)};
          await chrome.storage.local.set(patch);
          await reconcileDynamicRules();
          return {ok:true};
      });
      if(!result.ok){sendResponse(result);return;}
      sendResponse({ok:true,...await extraPrivacyStatus(await getState(),msg.host)}); return;
    }
    if (msg.type === "getStats") { await pollSoon(); await loadStats(); sendResponse({ since: life.since, totals: life.totals, top: topDomains(life.domains, 25), cats: categoryBreakdown(life.domains), debugAvailable }); return; }
    if (msg.type === "resetStats") { await loadStats(); life = emptyLife(); dirty = true; await flush(); sendResponse({ ok: true }); return; }
    if (msg.type === "setMode") {
      if (!HOST_RE.test(String(msg.host || "")) || !MODES.includes(msg.mode)) { sendResponse({ ok: false, error: "bad input" }); return; }
      await withHostLock(msg.host, async () => {   // serialized with Auto's own decisions for this site
        const st = await getState();
        const sites = { ...st.sites };
        if (msg.mode === st.defaultMode) delete sites[msg.host]; else sites[msg.host] = msg.mode;
        const autoState = { ...st.autoState }; delete autoState[msg.host];
        await chrome.storage.local.set({ sites, autoState });
      });
      await reconcileDynamicRules();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setShieldNetwork") {
      await chrome.storage.local.set({ shieldNetworks: { ...state.shieldNetworks, [msg.host]: msg.network } });
      await reconcileDynamicRules();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setFilters") {
      await chrome.storage.local.set({ filters: { ...state.filters, ...msg.filters } });
      await reconcileRulesets(); await reconcileDynamicRules();   // includes lists; security drives the malware page
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setAnnoy") {
      const patch = {};
      if (msg.annoy) patch.annoy = { ...state.annoy, ...msg.annoy };
      if (msg.cookieMode) patch.cookieMode = msg.cookieMode === "hide" ? "hide" : "reject";
      if (typeof msg.adsCosmetic === "boolean") patch.adsCosmetic = msg.adsCosmetic;
      await chrome.storage.local.set(patch);
      await reconcileListRules();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "setGuard") { await chrome.storage.local.set({ guard: { ...state.guard, ...msg.guard } }); await reconcileDynamicRules(); sendResponse({ ok: true }); return; }
    if (msg.type === "setAdvanced") {
      const a = msg.advanced || {}, patch = {};
      if (AUTO_MAX_CHOICES.includes(a.autoMax)) patch.autoMax = a.autoMax;
      for (const k of ["detectLibs", "rescue", "badge", "gpc"]) if (typeof a[k] === "boolean") patch[k] = a[k];
      if (THEMES.includes(a.theme) || OLD_THEMES[a.theme]) patch.theme = OLD_THEMES[a.theme] || a.theme;
      if(a.customColors&&validColour(a.customColors.primary)&&validColour(a.customColors.secondary))patch.customColors={primary:a.customColors.primary,secondary:a.customColors.secondary};
      await chrome.storage.local.set(patch);
      if ("badge" in patch) await enableBadge();
      if ("autoMax" in patch || "gpc" in patch) await reconcileDynamicRules();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "pollNow") { await pollMatchedRules(); sendResponse({ ok: true }); return; }
    if (msg.type === "getListInfo") { sendResponse(await getListInfo()); return; }
    if (msg.type === "hideFromMenu") { await hideFromMenu(msg.info || {}, { id: msg.tabId }); sendResponse({ ok: true }); return; }   // tests: same path as the right-click menu
    if (msg.type === "getSiteControls") { sendResponse(state.siteControls[msg.host] || {}); return; }
    if (msg.type === "setSiteControls") {
      if (!HOST_RE.test(msg.host || "")) { sendResponse({ ok: false }); return; }
      const siteControls = { ...state.siteControls }, c = {};
      for (const k of SITE_CONTROLS) if (msg.controls && msg.controls[k] === true) c[k] = true;
      if (Object.keys(c).length) siteControls[msg.host] = c; else delete siteControls[msg.host];
      await chrome.storage.local.set({ siteControls });
      await reconcileDynamicRules();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "listMyHides") { sendResponse((await chrome.storage.local.get({ myHides: {} })).myHides); return; }
    if (msg.type === "listUpdateStatus") { sendResponse(await LIST_UPDATES.status()); return; }
    if (msg.type === "listUpdateNow") { sendResponse(await LIST_UPDATES.run({ force: true })); return; }
    if (msg.type === "listUpdateAuto") { await LIST_UPDATES.setAuto(msg.on); sendResponse(await LIST_UPDATES.status()); return; }
    if (msg.type === "setSensitiveSites") { await chrome.storage.local.set({ sensitiveSites: msg.list || [] }); sendResponse({ ok: true }); return; }
    if (msg.type === "getSharedFixes") {
      const { siteFixes = null, fixesCheck = {} } = await chrome.storage.local.get(["siteFixes", "fixesCheck"]);
      sendResponse({ on: state.sharedFixes, sites: Object.keys((await LIST_UPDATES.fixes()).sites).length,
        updated: (siteFixes && siteFixes.updated) || null, error: fixesCheck.error || "" });
      return;
    }
    if (msg.type === "setSharedFixes") { await chrome.storage.local.set({ sharedFixes: !!msg.on }); await reconcileDynamicRules(); sendResponse({ ok: true }); return; }
    if (msg.type === "setGentleRetry") { await chrome.storage.local.set({ gentleRetry: !!msg.value }); sendResponse({ ok: true }); return; }
    if (msg.type === "getSettings") { sendResponse(state); return; }
    if (msg.type === "getLog") { const { log = [] } = await chrome.storage.local.get({ log: [] }); sendResponse({ log }); return; }
    if (msg.type === "clearLog") { await chrome.storage.local.set({ log: [] }); sendResponse({ ok: true }); return; }
    if (msg.type === "clearSite") {
      const sites = { ...state.sites }; delete sites[msg.host];
      const autoState = { ...state.autoState }; delete autoState[msg.host];
      const widgetOff = { ...state.widgetOff }; delete widgetOff[msg.host];
      const guardOff = { ...state.guardOff }; delete guardOff[msg.host];
      await chrome.storage.local.set({ sites, autoState, widgetOff, guardOff });
      await reconcileDynamicRules();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "exportSettings") {
      const all = await chrome.storage.local.get(null);
      for (const k of Object.keys(all)) if (!(k in DEFAULTS)) delete all[k];   // settings only (what import reads), not downloaded lists or statistics
      sendResponse({ data: all });
      return;
    }
    if (msg.type === "importSettings") {
      try {
        const d = msg.data || {};
        const clean = {};
        for (const k of Object.keys(DEFAULTS)) if (k in d && typeof d[k] === typeof DEFAULTS[k] && Array.isArray(d[k]) === Array.isArray(DEFAULTS[k])) clean[k] = d[k];   // unknown or wrong-typed keys ignored
        if (clean.sites) for (const [h, m] of Object.entries(clean.sites)) if (!HOST_RE.test(h) || !MODES.includes(m)) delete clean.sites[h];
        if (clean.myHides) clean.myHides = Object.fromEntries(Object.entries(clean.myHides).filter(([h, l]) => HOST_RE.test(h) && Array.isArray(l))
          .map(([h, l]) => [h, l.filter(validHideSelector).slice(-MY_HIDES_PER_SITE)]).filter(([, l]) => l.length));
        if (clean.myFixes) clean.myFixes = Object.fromEntries(Object.entries(clean.myFixes).filter(([h, f]) => HOST_RE.test(h) && f && typeof f === "object")
          .map(([h, f]) => [h, { ...(Array.isArray(f.allow) && f.allow.filter((x) => HOST_RE.test(x)).length ? { allow: f.allow.filter((x) => HOST_RE.test(x)).slice(0, 50) } : {}),
            ...(f.noHiding === true ? { noHiding: true } : {}), ...(f.noScripts === true ? { noScripts: true } : {}) }]).filter(([, f]) => Object.keys(f).length));
        if (clean.autoState && d.autoPolicyVersion !== AUTO_POLICY_VERSION) clean.autoState=migrateAutoPolicy({...d,...clean});
        clean.autoPolicyVersion=AUTO_POLICY_VERSION;
        await chrome.storage.local.set({ ...DEFAULTS, ...clean,
          guard: { ...DEFAULT_GUARD, ...(clean.guard || {}) }, annoy: { ...DEFAULT_ANNOY, ...(clean.annoy || {}) },
          schema: SCHEMA, listSigs: {} });
        const privacyResults=await Promise.all(Object.keys(BROWSER_PRIVACY).map(key=>setBrowserPrivacy(key,!!clean.extraPrivacy?.[key])));
        await reconcileRulesets(); await reconcileDynamicRules(); await enableBadge();
        sendResponse({ ok: true, warning:privacyResults.filter(r=>!r.ok).map(r=>r.error).join(" ")||undefined });
      } catch (e) { sendResponse({ ok: false, error: String(e) }); }
      return;
    }
    if (msg.type === "reset") {
      for(const key of Object.keys(BROWSER_PRIVACY))await setBrowserPrivacy(key,false);
      // Downloaded list updates are data, not settings: keep them (the bundled
      // groups they replaced stay switched off, so dropping them would leave a gap).
      const keep = await chrome.storage.local.get({ lifetime: null, freshLists: null, listUpdates: null, ytConfig: null, siteFixes: null });
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ ...DEFAULTS, lifetime: keep.lifetime || emptyLife(),
        ...(keep.freshLists ? { freshLists: keep.freshLists } : {}), ...(keep.ytConfig ? { ytConfig: keep.ytConfig } : {}),
        ...(keep.siteFixes ? { siteFixes: keep.siteFixes } : {}),
        ...(keep.listUpdates ? { listUpdates: { cats: keep.listUpdates.cats || {} } } : {}) });
      await reconcileRulesets(); await reconcileDynamicRules(); await enableBadge();
      sendResponse({ ok: true });
      return;
    }
    sendResponse({ ok: false, error: "unknown message" });
  })();
  return true;
});
