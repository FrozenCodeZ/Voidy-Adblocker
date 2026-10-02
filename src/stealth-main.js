// MAIN world, document_start, all frames (after guard-main).
//
//  B) STEALTH 3: NEUTRALIZE common anti-adblock libraries with locked
//     no-op stubs that report "no ad blocker". Flips to pass-through if a
//     password/card field appears. Never runs inside payment-provider frames.
//  C) NOTIFICATION GUARD (annoyances): a site may only raise the browser's
//     "Allow notifications?" prompt right after a real user action (click / key).
//     Unprompted requests on page load get a quiet "default" (= not now), so the
//     site can ask again later when you actually click its bell button.
//
// All messages to the isolated world carry the handshake secret (see
// config-bridge.js), so a page can't forge them.
(() => {
  "use strict";

  const PAY_FRAMES = ["stripe.com", "paypal.com", "paypalobjects.com", "adyen.com",
    "braintreegateway.com", "braintree-api.com", "checkout.com", "squareup.com"];
  const here = location.hostname.toLowerCase();
  if (PAY_FRAMES.some((h) => here === h || here.endsWith("." + h))) return;

  // ---- D) HIDE THE REDIRECT (runs first, in every frame) --------------------
  // Stealth answers ad probes with files from inside the extension. Chrome then
  // reports the answer's address as "chrome-extension://…", and a detector only
  // has to read `response.url` / `xhr.responseURL` to catch us. Here, a response WE
  // redirected reports the address the page asked for, with redirected=false.
  // Everything else passes through untouched, so this is inert on sites where
  // nothing is redirected. Wrapped functions still print as native code.
  // Built-ins captured now, before any page script: a page that later patches
  // Function.prototype.call/apply or WeakMap.prototype.* must neither see our
  // calls go through its patch (detection) nor redirect them.
  const R_apply = Reflect.apply;
  const WM = WeakMap.prototype, wmGet = WM.get, wmSet = WM.set, wmHas = WM.has, wmDel = WM.delete;
  const mget = (m, k) => R_apply(wmGet, m, [k]), mset = (m, k, v) => R_apply(wmSet, m, [k, v]);
  const mhas = (m, k) => R_apply(wmHas, m, [k]), mdel = (m, k) => R_apply(wmDel, m, [k]);
  const native = new WeakMap();                       // our wrapper -> the original it stands in for
  try {
    const fnToString = Function.prototype.toString;
    const toString = { toString() { return R_apply(fnToString, mget(native, this) || this, []); } }.toString;
    mset(native, toString, fnToString);
    Object.defineProperty(Function.prototype, "toString", { ...Object.getOwnPropertyDescriptor(Function.prototype, "toString"), value: toString });
  } catch (e) {}
  const EXT = "chrome-extension:";
  const RESP_URL_GET = Object.getOwnPropertyDescriptor(Response.prototype, "url").get;
  const asked = new WeakMap();                        // Response / XHR -> URL the page asked for
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return null; } };
  function wrapGetter(proto, prop, make) {
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || !d.get) return;
    const g = make(d.get);
    mset(native, g, d.get);
    Object.defineProperty(proto, prop, { ...d, get: g });
  }
  function wrapMethod(owner, prop, make) {
    const d = Object.getOwnPropertyDescriptor(owner, prop);
    if (!d || typeof d.value !== "function") return;
    const f = make(d.value);
    mset(native, f, d.value);
    Object.defineProperty(owner, prop, { ...d, value: f });
  }
  try {
    wrapMethod(window, "fetch", (orig) => ({ fetch(input) {
      const u = abs(input && typeof input === "object" && "url" in input ? input.url : String(input));
      return R_apply(orig, this, arguments).then((r) => {
        try { if (u && !u.startsWith(EXT) && r && String(R_apply(RESP_URL_GET, r, [])).startsWith(EXT)) mset(asked, r, u); } catch (e) {}
        return r;
      });
    } }).fetch);
  } catch (e) {}
  try {
    const urlGet = Object.getOwnPropertyDescriptor(Response.prototype, "url").get;
    wrapGetter(Response.prototype, "url", (orig) => ({ get url() { const v = R_apply(orig, this, []); return mhas(asked, this) && String(v).startsWith(EXT) ? mget(asked, this) : v; } }).__lookupGetter__("url"));
    wrapGetter(Response.prototype, "redirected", (orig) => ({ get redirected() { const v = R_apply(orig, this, []); return v && mhas(asked, this) && String(R_apply(urlGet, this, [])).startsWith(EXT) ? false : v; } }).__lookupGetter__("redirected"));
    wrapMethod(Response.prototype, "clone", (orig) => ({ clone() { const c = R_apply(orig, this, arguments); if (mhas(asked, this)) mset(asked, c, mget(asked, this)); return c; } }).clone);
  } catch (e) {}
  try {
    const X = XMLHttpRequest.prototype;
    wrapMethod(X, "open", (orig) => ({ open(method, url) { const u = abs(url); if (u && !u.startsWith(EXT)) mset(asked, this, u); else mdel(asked, this); return R_apply(orig, this, arguments); } }).open);
    wrapGetter(X, "responseURL", (orig) => ({ get responseURL() { const v = R_apply(orig, this, []); return mhas(asked, this) && String(v).startsWith(EXT) ? mget(asked, this) : v; } }).__lookupGetter__("responseURL"));
  } catch (e) {}

  let nonce = null;
  const origDispatch = EventTarget.prototype.dispatchEvent, addEL = EventTarget.prototype.addEventListener;
  // Captured before any page script, like guard-main.js: a page that replaces
  // CustomEvent or its `detail` getter must not see the secret or the config.
  const CE = CustomEvent, ObjCreate = Object.create;
  const detailGet = Object.getOwnPropertyDescriptor(CustomEvent.prototype, "detail").get;
  const UA = navigator.userActivation, uaActive = UA ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(UA), "isActive").get : null;
  const userActive = () => { try { return !!(UA && uaActive && R_apply(uaActive, UA, [])); } catch (e) { return false; } };
  // Event names derived from the secret: see config-bridge.js.
  const ev = (kind) => "voidy-" + nonce + "-" + kind;
  const emit = (kind, detail) => {
    if (nonce === null) return;
    try { const init = ObjCreate(null); init.detail = { ...detail, nonce }; R_apply(origDispatch, document, [new CE(ev(kind), init)]); } catch (e) {}
  };
  R_apply(addEL, document, ["voidy:hello", (e) => {
    let d = null;
    try { d = R_apply(detailGet, e, []); } catch (err) { return; }
    if (nonce !== null || !d || typeof d.nonce !== "string") return;
    nonce = d.nonce;
    R_apply(addEL, document, [ev("config"), onConfig]);
  }]);

  const KNOWN_GLOBALS = ["FuckAdBlock", "BlockAdBlock", "fuckAdBlock", "blockAdBlock",
    "sadblock", "adblockDetector", "AdBlockDetector", "canRunAds", "adBlockDetected",
    "googlefc"];
  let stealthOn = true;

  // ---- B) neutralize -----------------------------------------------------
  function makeFakeFAB() {
    function FAB() { this._not = []; }
    const p = FAB.prototype;
    p.onDetected = function () { return this; };
    p.onNotDetected = function (cb) { if (stealthOn && typeof cb === "function") this._not.push(cb); return this; };
    p.on = function (detected, cb) { if (!detected && stealthOn && typeof cb === "function") this._not.push(cb); return this; };
    p.check = function () { this._fire(); return true; };
    p.emitEvent = function () { this._fire(); return this; };
    p.clearEvent = function () { return this; };
    p.setOption = function () { return this; };
    p.options = function () { return this; };
    p._fire = function () { if (!stealthOn) return; for (const cb of this._not) { try { cb(); } catch (e) {} } };
    return FAB;
  }
  function lock(name, value) {
    try { Object.defineProperty(window, name, { configurable: false, get() { return value; }, set() {} }); }
    catch (e) { try { window[name] = value; } catch (e2) {} }
  }
  function installStealth3() {
    const FAB = makeFakeFAB();
    lock("FuckAdBlock", FAB); lock("BlockAdBlock", FAB);
    lock("fuckAdBlock", new FAB()); lock("blockAdBlock", new FAB()); lock("sadblock", new FAB());
    lock("canRunAds", true); lock("canShowAds", true); lock("adBlockDetected", false);
    const checkFields = () => {
      let f = false;
      try { f = !!document.querySelector("input[type='password'], input[autocomplete*='cc-'], input[name*='card'], input[name*='cvc'], input[name*='cvv']"); } catch (e) {}
      if (f) stealthOn = false;
    };
    checkFields();
    try {
      let t;
      const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(checkFields, 300); });
      document.addEventListener("DOMContentLoaded", () => mo.observe(document.documentElement, { childList: true, subtree: true }), { once: true });
      setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 30000);
    } catch (e) {}
  }

  // ---- C) notification guard (installed now; decides once config arrives) --
  let notifGuard = null;              // null = config not here yet
  let resolveCfg;
  const cfgReady = new Promise((r) => { resolveCfg = r; });
  try {
    const N = window.Notification;
    if (N && typeof N.requestPermission === "function") {
      const real = N.requestPermission.bind(N);
      // Method shorthand with no declared parameter: .length 0 and no
      // .prototype, like the built-in (a plain `function (cb)` differed on both).
      const replacement = ({ requestPermission() {
        const cb = arguments[0];
        const withGesture = userActive();
        const decideNow = () => {
          if (!notifGuard || N.permission !== "default" || withGesture) return real(cb);
          emit("annoy", { kind: "notification-prompt" });
          if (typeof cb === "function") { try { cb("default"); } catch (e) {} }
          return Promise.resolve("default");
        };
        return notifGuard === null ? cfgReady.then(decideNow) : decideNow();
      } }).requestPermission;
      mset(native, replacement, N.requestPermission);
      Object.defineProperty(N, "requestPermission", { ...Object.getOwnPropertyDescriptor(N, "requestPermission"), value: replacement });
    }
  } catch (e) {}

  // ---- config gate (must carry the handshake secret) ------------------------
  let configured = false;
  function onConfig(e) {
    let d = null;
    try { d = R_apply(detailGet, e, []); } catch (err) { return; }
    if (configured || !d || typeof d !== "object") return;
    if (d.nonce !== nonce) return;
    configured = true;
    notifGuard = !!d.notifGuard;
    resolveCfg();
    if (d.level === "stealth3") installStealth3();
  }
})();
