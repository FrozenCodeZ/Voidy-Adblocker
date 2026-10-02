// Redirect Guard — MAIN world, document_start, all frames.
//
// Holds script-initiated cross-site redirects and pop-ups until the user clicks
// Allow. Real user clicks are never interrupted. Holds from the very first moment
// (fail-safe) until a config arrives.
//
// This file shares the page's world, so the page can replace any built-in
// function or getter after it starts. Everything a decision depends on is
// therefore captured below, before any page script runs, and only those
// captured copies are used:
//   - HANDSHAKE: the config is accepted only if it carries the secret that
//     config-bridge.js handed us before any page script ran. Events are built
//     and read with the captured CustomEvent and `detail` getter, so a page
//     that replaces them can neither read the secret nor rewrite the config.
//   - Replies from the prompt count only if they are real (isTrusted) messages
//     from OUR iframe, checked through the captured MessageEvent getters.
//   - Addresses are parsed with the captured URL, and anything that can't be
//     parsed is treated as another site (asks), never as this one.
//   - Trust-pairs are saved by the extension-origin prompt itself, never through
//     a page-visible event (a page could otherwise forge "trust this redirect").
//   - If a site's security policy blocks our prompt frame, we fall back to the
//     in-page prompt instead of silently denying.
(() => {
  "use strict";

  let nonce = null;
  let active = true;
  let configured = false;
  let cfg = { maxPrompts: 3, timeoutMs: 20000, blockTabUnderMs: 2000, promptForNonHttp: true, runOnlyAfterFirstRedirect: false, trustPairs: [], userSafeList: [],
              popupAfterClick: "ask", overlayGuard: true,
              enabled: true, action: "ask", fakePopup: false, linkPopups: true, quietAds: true, promptPos: "top-right" };
  let sensitive = false;
  let frameUrl = null, replyOrigin = "";
  let armed = true;
  let promptsShown = 0;
  let allowOnce = null;
  let blockRedirectUntil = 0;

  // ---- built-ins, captured NOW (see the header) ------------------------------
  const R_apply = Reflect.apply;
  const getOwn = Object.getOwnPropertyDescriptor, ObjCreate = Object.create;
  const getter = (proto, name) => { try { const d = proto && getOwn(proto, name); return d && d.get; } catch (e) { return undefined; } };
  const read = (g, obj) => R_apply(g, obj, []);
  const wmGet = WeakMap.prototype.get, wmSet = WeakMap.prototype.set;
  const addEL = EventTarget.prototype.addEventListener, removeEL = EventTarget.prototype.removeEventListener;
  const realOpen = window.open;
  const origDispatch = EventTarget.prototype.dispatchEvent;
  const CE = CustomEvent, detailGet = getter(CustomEvent.prototype, "detail");
  const URLC = URL, urlHost = getter(URL.prototype, "hostname"), urlProto = getter(URL.prototype, "protocol"), urlHref = getter(URL.prototype, "href");
  const strLower = String.prototype.toLowerCase, strSplit = String.prototype.split, strEnds = String.prototype.endsWith,
    strSlice = String.prototype.slice, strIndex = String.prototype.indexOf, strTrim = String.prototype.trim;
  const setHas = Set.prototype.has;
  const meOrigin = getter(MessageEvent.prototype, "origin"), meSource = getter(MessageEvent.prototype, "source"), meData = getter(MessageEvent.prototype, "data");
  const frameWin = getter(HTMLIFrameElement.prototype, "contentWindow");
  const preventDefault = Event.prototype.preventDefault, stopImmediate = Event.prototype.stopImmediatePropagation, composedPath = Event.prototype.composedPath;
  const evCancelable = getter(Event.prototype, "cancelable"), evBubbles = getter(Event.prototype, "bubbles"), evTarget = getter(Event.prototype, "target");
  const NE = typeof NavigateEvent === "function" ? NavigateEvent.prototype : null;
  const neUser = getter(NE, "userInitiated"), neDest = getter(NE, "destination"), neDownload = getter(NE, "downloadRequest"), neHash = getter(NE, "hashChange");
  const destUrl = typeof NavigationDestination === "function" ? getter(NavigationDestination.prototype, "url") : undefined;
  const UA = navigator.userActivation, uaActive = UA ? getter(Object.getPrototypeOf(UA), "isActive") : undefined;
  const MouseEventC = MouseEvent;
  const elLocalName = getter(Element.prototype, "localName"), getAttr = Element.prototype.getAttribute, closest = Element.prototype.closest,
    rectOf = Element.prototype.getBoundingClientRect, styleOf = window.getComputedStyle;
  const aHref = getter(HTMLAnchorElement.prototype, "href"), areaHref = getter(HTMLAreaElement.prototype, "href");
  const qs = Document.prototype.querySelector, cssEscape = CSS.escape;
  const originals = [];                                   // [owner, prop, descriptor] — put back when detached

  const lower = (s) => R_apply(strLower, s, []);
  const ends = (s, t) => R_apply(strEnds, s, [t]);
  const userActive = () => { try { return !!(UA && uaActive && read(uaActive, UA)); } catch (e) { return false; } };
  const locHref = () => location.href;                    // Location members belong to the object itself: pages can't replace them

  // ---- look native ----------------------------------------------------------
  // Our replacements must print like built-ins: if window.open.toString()
  // returned this file's source, any page could tell the Guard is here.
  // (stealth-main.js layers the same trick on top of this one for its own
  // wrappers; each layer maps only its own functions, so they chain cleanly.)
  // Known limit: another frame's Function.prototype.toString, called on OUR
  // frame's wrapper, still prints its source (each frame has its own map);
  // closing that would need a marker shared across frames, itself detectable.
  const native = new WeakMap();
  try {
    const fnToString = Function.prototype.toString;
    const toString = { toString() { return R_apply(fnToString, R_apply(wmGet, native, [this]) || this, []); } }.toString;
    R_apply(wmSet, native, [toString, fnToString]);
    Object.defineProperty(Function.prototype, "toString", { ...getOwn(Function.prototype, "toString"), value: toString });
  } catch (e) {}
  // Replace a method with a wrapper named and shaped like the original.
  function wrap(owner, prop, make) {
    const d = getOwn(owner, prop);
    if (!d || typeof d.value !== "function") return;
    const f = make(d.value);
    R_apply(wmSet, native, [f, d.value]);
    originals.push([owner, prop, d]);
    Object.defineProperty(owner, prop, { ...d, value: f });
  }

  // ---- a stand-in for a pop-up we didn't open -------------------------------
  // Some sites open a pop-up only to TEST for a blocker: a null result means
  // "blocked", and they punish it (for example by sending you to another site
  // a few seconds later). When enabled, a blocked pop-up returns this harmless stand-in
  // instead of null: nothing opens, nothing loads, but the page sees a window.
  function fakeWindow() {
    let closed = false;
    const noop = function () {};
    const loc = { href: "about:blank", assign: noop, replace: noop, reload: noop, toString() { return "about:blank"; } };
    const doc = { write: noop, writeln: noop, open: noop, close: noop, body: null, title: "", readyState: "complete" };
    const w = { get closed() { return closed; }, close() { closed = true; }, focus: noop, blur: noop, print: noop,
      postMessage: noop, moveTo: noop, moveBy: noop, resizeTo: noop, resizeBy: noop, scrollTo: noop,
      addEventListener: noop, removeEventListener: noop, location: loc, document: doc, opener: null, name: "", length: 0 };
    w.window = w; w.self = w; w.top = w; w.parent = w; w.frames = w;
    return w;
  }
  // Messages between our scripts travel on event names DERIVED FROM THE
  // SECRET, so a page can't listen for them. Only "voidy:hello" has a fixed
  // name, and it fires before any page script exists. The init dictionary has
  // no prototype, so building the event reads nothing a page could hook.
  const ev = (kind) => "voidy-" + nonce + "-" + kind;
  const emit = (kind, detail) => {
    if (nonce === null) return;
    try { const init = ObjCreate(null); init.detail = { ...detail, nonce }; R_apply(origDispatch, document, [new CE(ev(kind), init)]); } catch (e) {}
  };

  function onConfig(e) {
    let d = null;
    try { d = read(detailGet, e); } catch (err) { return; }
    if (configured || !d || typeof d !== "object") return;
    if (d.nonce !== nonce) return;                          // forged config: ignore
    configured = true;
    sensitive = d.sensitive === true;
    frameUrl = typeof d.frameUrl === "string" ? d.frameUrl : null;
    replyOrigin = typeof d.extOrigin === "string" ? d.extOrigin : "";
    if (d.guard && typeof d.guard === "object") cfg = { ...cfg, ...d.guard };
    if (cfg.runOnlyAfterFirstRedirect) armed = false;
    if ((d.level || "full") === "off" || cfg.enabled === false) detach();   // site Off, Guard off, or Guard off for this site
  }
  // First hello wins (config-bridge sends it before any page script runs).
  R_apply(addEL, document, ["voidy:hello", (e) => {
    let d = null;
    try { d = read(detailGet, e); } catch (err) { return; }
    if (nonce !== null || !d || typeof d.nonce !== "string") return;
    nonce = d.nonce;
    R_apply(addEL, document, [ev("config"), onConfig]);
  }]);

  // Off / Guard off / Guard off for this site: put the page's own functions
  // back, so "Off" stays a real escape hatch if a wrapper ever misbehaved.
  function detach() {
    active = false;
    for (const [owner, prop, d] of originals) { try { Object.defineProperty(owner, prop, d); } catch (e) {} }
  }

  // ---- registrable domain (same list as lib/psl.js) ------------------------
  const SUFFIXES = new Set([
    "co.uk","org.uk","gov.uk","ac.uk","me.uk","ltd.uk","plc.uk","net.uk","sch.uk","nhs.uk","police.uk","co.jp",
    "ne.jp","or.jp","go.jp","ac.jp","ad.jp","ed.jp","gr.jp","lg.jp","com.au","net.au","org.au","gov.au","edu.au",
    "id.au","asn.au","co.nz","net.nz","org.nz","govt.nz","ac.nz","school.nz","com.br","net.br","org.br","gov.br",
    "edu.br","com.cn","net.cn","org.cn","gov.cn","edu.cn","ac.cn","com.mx","org.mx","gob.mx","edu.mx","com.tr",
    "org.tr","gov.tr","edu.tr","net.tr","com.sg","edu.sg","gov.sg","org.sg","net.sg","com.hk","org.hk","gov.hk",
    "edu.hk","net.hk","com.tw","org.tw","gov.tw","edu.tw","net.tw","co.in","net.in","org.in","gov.in","ac.in",
    "edu.in","firm.in","gen.in","ind.in","co.kr","or.kr","go.kr","ac.kr","ne.kr","co.za","org.za","gov.za","ac.za",
    "net.za","com.ar","org.ar","gob.ar","net.ar","com.sa","org.sa","gov.sa","edu.sa","com.eg","org.eg","gov.eg",
    "edu.eg","com.ua","org.ua","gov.ua","net.ua","in.ua","co.il","org.il","gov.il","ac.il","com.my","org.my","gov.my",
    "edu.my","co.id","or.id","go.id","ac.id","web.id","com.ph","org.ph","gov.ph","edu.ph","com.vn","org.vn","gov.vn",
    "edu.vn","net.vn","co.th","or.th","go.th","ac.th","in.th","com.pk","org.pk","gov.pk","edu.pk","com.ng","org.ng",
    "gov.ng","edu.ng","com.co","org.co","gov.co","edu.co","com.pe","gob.pe","com.ve","com.ec","com.uy","com.py",
    "com.bo","com.do","com.gt","com.sv","com.pa","co.ke","or.ke","go.ke","co.tz","co.ug","co.zw","com.gh","com.np",
    "com.bd","com.lk","com.kw","com.qa","com.om","com.bh","com.lb","com.jo","com.cy","com.mt","com.gr","co.at",
    "or.at","gv.at","ac.at","com.pl","net.pl","org.pl","gov.pl","edu.pl","com.ru","org.ru","net.ru","com.es","org.es",
    "gob.es","nom.es","com.pt","org.pt","gov.pt","co.hu","com.ro","org.ro","com.hr","co.rs","com.by","com.kz",
    "org.kz","com.az","com.ge","github.io","gitlab.io","githubusercontent.com","github.dev","bitbucket.io",
    "blogspot.com","wordpress.com","tumblr.com","weebly.com","weeblysite.com","wixsite.com","squarespace.com",
    "myshopify.com","godaddysites.com","jimdosite.com","mystrikingly.com","webflow.io","framer.website","carrd.co",
    "notion.site","gitbook.io","readthedocs.io","neocities.org","000webhostapp.com","surge.sh","pages.dev",
    "workers.dev","r2.dev","trycloudflare.com","netlify.app","vercel.app","now.sh","web.app","firebaseapp.com",
    "appspot.com","herokuapp.com","azurewebsites.net","azurestaticapps.net","azureedge.net","cloudapp.net",
    "cloudfront.net","s3.amazonaws.com","elasticbeanstalk.com","amplifyapp.com","onrender.com","fly.dev","deno.dev",
    "glitch.me","repl.co","replit.app","replit.dev","codesandbox.io","stackblitz.io","pythonanywhere.com","ngrok.io",
    "ngrok.app","ngrok-free.app","loca.lt","googleusercontent.com","translate.goog","duckdns.org","no-ip.org",
    "ddns.net","hopto.org","zapto.org","sytes.net","dynu.net","freemyip.com","dyndns.org"
  ]);
  function isIP(h) {
    if (R_apply(strIndex, h, [":"]) >= 0) return true;
    const p = R_apply(strSplit, h, ["."]);
    if (p.length !== 4) return false;
    for (let i = 0; i < 4; i++) {
      const s = p[i];
      if (!s.length || s.length > 3) return false;
      for (let j = 0; j < s.length; j++) if (s[j] < "0" || s[j] > "9") return false;
    }
    return true;
  }
  function labelsFrom(p, i) { let s = ""; for (let k = i; k < p.length; k++) s += (k > i ? "." : "") + p[k]; return s; }
  function registrable(hostname) {
    let h = lower(String(hostname || ""));
    if (ends(h, ".")) h = R_apply(strSlice, h, [0, -1]);
    if (!h || isIP(h)) return h;
    const p = R_apply(strSplit, h, ["."]), n = p.length;
    for (let k = n - 1 < 3 ? n - 1 : 3; k >= 2; k--)       // the longest listed suffix wins
      if (R_apply(setHas, SUFFIXES, [labelsFrom(p, n - k)])) return labelsFrom(p, n - k - 1);
    return n <= 2 ? h : labelsFrom(p, n - 2);
  }
  // One parse per address, with the captured URL; null when it can't be parsed.
  function parse(url) {
    try { const u = new URLC(String(url), locHref()); return { host: lower(read(urlHost, u)), proto: read(urlProto, u), href: read(urlHref, u) }; }
    catch (e) { return null; }
  }
  function hostOf(url) { const u = parse(url); return u ? u.host : ""; }
  function sameSite(url) {
    const u = parse(url);
    if (!u || (u.proto !== "http:" && u.proto !== "https:")) return false;   // unknown = another site: ask, never allow
    return registrable(u.host) === registrable(location.hostname);
  }

  // ---- classification --------------------------------------------------
  const SAFE_HOSTS = [
    "accounts.google.com","appleid.apple.com","login.microsoftonline.com","login.live.com",
    "login.yahoo.com","paypal.com","checkout.stripe.com","js.stripe.com","stripe.com",
    "github.com","gitlab.com","auth0.com","okta.com","id.atlassian.com","slack.com",
    "secure.bankofamerica.com","chase.com","wellsfargo.com","coinbase.com","discord.com","twitch.tv"
  ];
  const AD_DEST = [
    "doubleclick.net","googlesyndication.com","googleadservices.com",
    "taboola.com","outbrain.com","adnxs.com","adsrvr.org","bidswitch.net","criteo.com",
    "pubmatic.com","rubiconproject.com","openx.net","smartadserver.com","zedo.com","popads.net",
    "propellerads.com","adcash.com","exoclick.com","juicyads.com","clickadu.com","popcash.net",
    "adsterra.com","hilltopads.net","onclickads.net","admaven.com"
  ];
  function inList(host, list) {
    if (!host || !list) return false;
    for (let i = 0; i < list.length; i++) { const h = list[i]; if (typeof h === "string" && h && (host === h || ends(host, "." + h))) return true; }
    return false;
  }
  const isSafeDest = (url) => { const h = hostOf(url); return inList(h, SAFE_HOSTS) || inList(h, cfg.userSafeList); };
  const isAdDest = (url) => inList(hostOf(url), AD_DEST);
  // "Always allow" pairs name the destination's exact host ("news.com>docs.github.io");
  // pairs saved by older versions name its registrable domain, which still matches.
  function trusted(url) {
    const h = hostOf(url);
    if (!h) return false;
    const from = registrable(location.hostname) + ">", a = from + h, b = from + registrable(h), pairs = cfg.trustPairs || [];
    for (let i = 0; i < pairs.length; i++) if (pairs[i] === a || pairs[i] === b) return true;
    return false;
  }
  function protocolOf(url) { const u = parse(url); return u ? u.proto : ""; }

  // ---- prompts ------------------------------------------------------------
  const pending = ObjCreate(null);     // id -> { url, onAllow, frameEl, timer, ready }
  const newId = () => { try { const a = new Uint32Array(2); crypto.getRandomValues(a); return a[0].toString(36) + a[1].toString(36); } catch (e) { return String(Math.random()).slice(2); } };
  let extOrigin = "";

  R_apply(addEL, window, ["message", (ev) => {
    if (!ev.isTrusted || !frameUrl || !extOrigin) return;   // isTrusted can't be faked: page-made MessageEvents stop here
    let origin, source, m;
    try { origin = read(meOrigin, ev); source = read(meSource, ev); m = read(meData, ev); } catch (e) { return; }
    if ((origin !== extOrigin && origin !== replyOrigin) || !m || typeof m !== "object" || typeof m.id !== "string") return;
    const p = pending[m.id];
    if (!p || !p.frameEl || source !== read(frameWin, p.frameEl)) return;   // must be OUR frame
    if (m.type === "voidy-guard-ready") { p.ready = true; return; }
    if (m.type === "voidy-guard-size") {                     // fit the frame to its content
      const h = Math.max(120, Math.min(560, Number(m.h) || 0));
      if (h) p.frameEl.style.setProperty("height", h + "px", "important");
      return;
    }
    if (m.type === "voidy-guard-show") { p.frameEl.style.setProperty("visibility", "visible", "important"); return; }
    if (m.type !== "voidy-guard-result") return;
    delete pending[m.id];
    clearTimeout(p.timer);
    try { p.frameEl.remove(); } catch (e) {}
    if (m.silent) promptsShown = Math.max(0, promptsShown - 1);   // a silently declined ad jump isn't a prompt the user saw
    // Allow only what the person was shown: the page owns the iframe element and
    // could point it at a harmless-looking address, so the prompt echoes back the
    // address it displayed and it must be the one we'd go to.
    if (m.action === "allow" && m.url === p.shownUrl) p.onAllow && p.onAllow();
  }]);

  function promptFrame(kind, url, onAllow) {
    const fu = parse(frameUrl);
    if (!fu) return promptShadow(kind, url, onAllow);
    try { extOrigin = new URLC(frameUrl).origin; } catch (e) { return promptShadow(kind, url, onAllow); }
    const id = newId();
    const iframe = document.createElement("iframe");
    const pu = parse(url), abs = pu ? pu.href : String(url);
    const params = new URLSearchParams({ id, kind, url: abs.slice(0, 2000), host: pu ? pu.host : "", timeout: String(cfg.timeoutMs),
      quietAds: cfg.quietAds !== false ? "1" : "0" });   // the prompt declines silently if our ad LISTS know the destination
    iframe.src = frameUrl + "#" + params.toString();
    const vpos = cfg.promptPos === "bottom-right" ? "bottom:12px" : "top:12px";
    iframe.setAttribute("style", ["position:fixed",vpos,"right:12px","width:min(380px, calc(100vw - 24px))","height:300px","border:0",
      "z-index:2147483647","color-scheme:normal","box-shadow:0 6px 24px rgba(0,0,0,.35)","border-radius:12px",
      "display:block", cfg.quietAds !== false ? "visibility:hidden" : "visibility:visible", "opacity:1"].join(";"));
    // With quiet ad handling the frame decides first whether to show at all;
    // it asks to be shown (voidy-guard-show). Safety net if it never answers:
    if (cfg.quietAds !== false) setTimeout(() => { if (pending[id]) iframe.style.setProperty("visibility", "visible", "important"); }, 700);
    const p = pending[id] = { url, onAllow, frameEl: iframe, ready: false, shownUrl: abs.slice(0, 2000),
      timer: setTimeout(() => { delete pending[id]; try { iframe.remove(); } catch (e) {} }, cfg.timeoutMs + 1000) };
    (document.body || document.documentElement).appendChild(iframe);
    // If the frame never says "ready" (e.g. the site's CSP blocks it), use the
    // in-page prompt instead of silently denying.
    setTimeout(() => {
      if (pending[id] && !p.ready) {
        delete pending[id]; clearTimeout(p.timer);
        try { iframe.remove(); } catch (e) {}
        promptShadow(kind, url, onAllow);
      }
    }, 1500);
  }

  let shadowRoot = null;
  function promptShadow(kind, url, onAllow) {
    if (!shadowRoot) {
      const hostEl = document.createElement("voidy-guard");
      hostEl.style.all = "initial";
      shadowRoot = hostEl.attachShadow({ mode: "closed" });
      const attach = () => (document.body || document.documentElement).appendChild(hostEl);
      if (document.body || document.documentElement) attach();
      else document.addEventListener("DOMContentLoaded", attach, { once: true });
    }
    const box = document.createElement("div");
    box.setAttribute("style", ["position:fixed",cfg.promptPos === "bottom-right" ? "bottom:12px" : "top:12px","right:12px","z-index:2147483647","max-width:320px",
      "background:#1f2430","color:#fff","font:14px/1.4 system-ui,sans-serif","padding:14px 16px",
      "border-radius:10px","box-shadow:0 6px 24px rgba(0,0,0,.35)"].join(";"));
    const title = document.createElement("div");
    title.textContent = kind === "Pop-up" ? "This page tried to open a new tab" : kind === "Overlay" ? "That click hit an invisible link" : "This page tried to send you somewhere else";
    title.setAttribute("style", "font-weight:600;margin-bottom:6px");
    const detail = document.createElement("div");
    detail.textContent = "Going to: " + (hostOf(url) || "an app on your computer");
    detail.setAttribute("style", "font-weight:600;word-break:break-all");
    const full = document.createElement("div");
    const pu = parse(url);
    full.textContent = pu ? pu.href : String(url);
    full.setAttribute("style", "opacity:.7;font:11.5px/1.4 ui-monospace,Consolas,monospace;margin:3px 0 10px;word-break:break-all;max-height:4.2em;overflow:auto");
    const row = document.createElement("div");
    row.setAttribute("style", "display:flex;gap:8px;justify-content:flex-end");
    const mk = (label, bg) => { const b = document.createElement("button"); b.textContent = label;
      b.setAttribute("style", `cursor:pointer;border:0;border-radius:6px;padding:6px 12px;background:${bg};color:#fff;font:inherit`); return b; };
    const deny = mk("Stay here", "#3b6fd4"), allow = mk("Go there", "#3a4152");
    row.append(deny, allow);
    box.append(title, detail, full, row);
    shadowRoot.appendChild(box);
    let done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(t); box.remove(); if (fn) fn(); };
    const t = setTimeout(() => finish(null), cfg.timeoutMs);
    // A short pause before "Go there" works, so a click aimed at what was here before can't land on it.
    const shownAt = Date.now();
    R_apply(addEL, allow, ["click", (ev) => { if (ev.isTrusted && Date.now() - shownAt > 600) finish(onAllow); }]);
    R_apply(addEL, deny, ["click", (ev) => { if (ev.isTrusted) finish(null); }]);
  }

  function doPrompt(kind, url, onAllow) {
    emit("held", {});
    if (cfg.action === "block") return;                     // setting: block quietly, never ask
    if (promptsShown >= cfg.maxPrompts) return;            // over the cap: deny quietly
    promptsShown++;
    if (frameUrl) promptFrame(kind, url, onAllow); else promptShadow(kind, url, onAllow);
  }

  // Returns true if the action may proceed now; false if denied or deferred.
  function decide(kind, url, onAllow) {
    if (!active || sensitive) return true;                 // sensitive: sites the user listed, and known payment / sign-in sites
    const proto = protocolOf(url);
    if (proto && proto !== "http:" && proto !== "https:") {
      if (proto === "mailto:" || proto === "tel:" || proto === "about:" || proto === "blob:" || proto === "javascript:") return true;
      if (cfg.promptForNonHttp) doPrompt(kind, url, onAllow);
      return false;
    }
    if (sameSite(url) || isSafeDest(url) || trusted(url)) return true;
    if (isAdDest(url) && cfg.quietAds !== false) { emit("held", {}); return false; }   // known ad: deny quietly
    doPrompt(kind, url, onAllow);
    return false;
  }

  // ---- 1) redirects (top frame) -----------------------------------------
  if (window.top === window && window.navigation && neUser && neDest && destUrl) {
    R_apply(addEL, window.navigation, ["navigate", (e) => {
      if (!active) return;
      let url, user, cancelable, download, hash;
      try {
        const dest = read(neDest, e);
        url = dest && read(destUrl, dest);
        user = read(neUser, e); cancelable = read(evCancelable, e); download = neDownload ? read(neDownload, e) : null; hash = neHash ? read(neHash, e) : false;
      } catch (err) { return; }
      if (!url) return;
      if (allowOnce === url) { allowOnce = null; return; }
      if (user || !cancelable || download) return;
      if (hash || sameSite(url)) return;                   // same-site / in-page: never interfere
      const stop = () => { try { R_apply(preventDefault, e, []); } catch (err) {} };
      if (Date.now() < blockRedirectUntil) { stop(); return; }   // tab-under
      if (!armed) { armed = true; return; }                // "only after first redirect" option
      if (!decide("Redirect", url, () => { allowOnce = url; location.href = url; })) stop();
    }]);
  }

  // ---- 2) pop-ups --------------------------------------------------------
  // `open()` declared with no parameters so its .length is 0 like the real one
  // (a named parameter would make it 1, a one-line detection).
  wrap(window, "open", (orig) => ({ open() {
    const n = arguments.length, url = arguments[0];
    const args = [];
    for (let i = 0; i < n; i++) args[i] = arguments[i];
    if (!active) return R_apply(orig, this, args);
    // The address is turned into text ONCE: checking one string and opening
    // another (an object whose toString changes) would slip past the Guard.
    const target = url ? String(url) : "about:blank";
    if (url) args[0] = target;
    const run = () => { const w = R_apply(orig, window, args); blockRedirectUntil = Date.now() + (cfg.blockTabUnderMs || 0); return w; };
    // A pop-up that ends up not opening (held by us, or blocked by Chrome's own
    // pop-up blocker) reports as a harmless stand-in when that setting is on —
    // but never right after a real click: that's when sign-in / payment
    // pop-ups open, and their "pop-up blocked -> use a redirect instead"
    // fallback must still see the real null.
    const clicked = userActive();
    const orFake = (w) => (w || !cfg.fakePopup || clicked ? w : fakeWindow());
    if (!sameSite(target) && !armed) { armed = true; return orFake(run()); }
    // Setting "pop-ups right after a click: allow" — trusts a real click unless the
    // destination is a known ad network (pop-unders ride on clicks too).
    if (cfg.popupAfterClick === "allow" && clicked && !isAdDest(target)) return orFake(run());
    if (decide("Pop-up", target, run)) return orFake(run());
    return orFake(null);
  } }).open);

  // ---- 2b) pop-ups opened through a link the page clicks itself ---------------
  // Pop-under scripts often skip window.open: they create a hidden
  // <a href=ad target=_blank> and click it from code while you are clicking
  // something else, so Chrome treats the new tab as yours. Only page-made
  // (untrusted) clicks on links that
  // would open a NEW tab/window on another site are held; your own clicks never
  // reach this code. The page's own click handlers still run — only the link's
  // default action (opening the tab) is cancelled.
  //
  // Deliberately NOT done by wrapping dispatchEvent: pages
  // call it constantly, and every listener it runs would then carry this
  // extension's chrome-extension:// URL in its error stack traces — shipped to
  // any error-reporting service on the page. An early capture listener sees the
  // same clicks without ever being on the page's stack.
  function linkHref(el) {
    try {
      const name = read(elLocalName, el);
      const h = name === "a" ? read(aHref, el) : name === "area" ? read(areaHref, el) : "";
      return typeof h === "string" ? h : "";
    } catch (e) { return ""; }
  }
  const isLink = (el) => !!el && typeof el === "object" && !!linkHref(el);
  const attr = (el, name) => { try { return R_apply(getAttr, el, [name]); } catch (e) { return null; } };
  const opensNewContext = (a) => {
    const t = R_apply(strTrim, String(attr(a, "target") || ""), []);
    const tl = lower(t);
    if (!t || tl === "_self" || tl === "_parent" || tl === "_top") return false;
    try { const e = R_apply(cssEscape, CSS, [t]); if (R_apply(qs, document, ['iframe[name="' + e + '"], frame[name="' + e + '"]'])) return false; } catch (e) {}   // named frame on this page
    return true;
  };
  function heldLinkPopup(a) {
    if (!active || cfg.linkPopups === false || !isLink(a) || !opensNewContext(a)) return false;
    const url = linkHref(a);
    if (sameSite(url)) return false;
    const name = attr(a, "target");
    // Opened the way the link itself would have: no opener handle back to this
    // page (reverse-tabnabbing) and no referrer if the link asked for none.
    const rel = R_apply(strSplit, lower(String(attr(a, "rel") || "")), [" "]);
    let opener = false, noref = false;
    for (let i = 0; i < rel.length; i++) { if (rel[i] === "opener") opener = true; if (rel[i] === "noreferrer") noref = true; }
    const feats = (opener ? "" : "noopener") + (noref ? (opener ? "" : ",") + "noreferrer" : "");
    const run = () => { R_apply(realOpen, window, [url, name, feats]); blockRedirectUntil = Date.now() + (cfg.blockTabUnderMs || 0); };
    if (cfg.popupAfterClick === "allow" && userActive() && !isAdDest(url)) return false;
    return !decide("Pop-up", url, run);
  }
  let inWrappedClick = false;
  const cancelDefault = (e) => { if (!e.isTrusted) R_apply(preventDefault, e, []); };
  // (a) link.click() — also covers a link that was never added to the page,
  // whose click never reaches any window listener.
  wrap(HTMLElement.prototype, "click", (orig) => ({ click() {
    if (active && isLink(this) && heldLinkPopup(this)) {
      R_apply(addEL, this, ["click", cancelDefault, true]);
      inWrappedClick = true;
      try { return R_apply(orig, this, arguments); }
      finally { inWrappedClick = false; R_apply(removeEL, this, ["click", cancelDefault, true]); }
    }
    return R_apply(orig, this, arguments);
  } }).click);
  // (b) link.dispatchEvent(new MouseEvent("click")) on a link in the page:
  // registered now, before any page script, so it runs first.
  R_apply(addEL, window, ["click", (e) => {
    if (!active || e.isTrusted || inWrappedClick || !(e instanceof MouseEventC)) return;
    let path, bubbles;
    try { if (!read(evCancelable, e)) return; path = R_apply(composedPath, e, []); bubbles = read(evBubbles, e); } catch (err) { return; }
    let a = null;
    for (let i = 0; i < path.length; i++) { const n = path[i]; if (isLink(n)) { a = n; break; } if (n === document) break; }
    // A non-bubbling click on something INSIDE a link never activates the link.
    if (a && (a === path[0] || bubbles) && heldLinkPopup(a)) R_apply(preventDefault, e, []);
  }, true]);

  // ---- 3) invisible / page-covering link overlays -------------------------
  R_apply(addEL, window, ["click", (e) => {
    if (!active || !e.isTrusted || cfg.overlayGuard === false) return;
    let a = null;
    try { const t = read(evTarget, e); a = t && R_apply(closest, t, ["a[href]"]); } catch (err) { return; }
    const href = a && linkHref(a);
    if (!href || sameSite(href)) return;
    let coversPage = false, invisible = false;
    try {
      const r = R_apply(rectOf, a, []);
      coversPage = r.width * r.height > 0.5 * innerWidth * innerHeight;
      invisible = parseFloat(R_apply(styleOf, window, [a]).opacity) < 0.1;
    } catch (err) {}
    if (coversPage || invisible) {
      if (!decide("Overlay", href, () => { allowOnce = href; location.href = href; })) {
        R_apply(preventDefault, e, []); R_apply(stopImmediate, e, []);
      }
    }
  }, true]);
})();
