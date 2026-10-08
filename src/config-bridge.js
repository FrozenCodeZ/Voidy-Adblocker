// ISOLATED world, document_start, all frames.
//
// Injected right AFTER the MAIN-world scripts (guard-main, stealth-main) and
// BEFORE any page script. Its jobs:
//
//  1) HANDSHAKE. It immediately (synchronously) hands the MAIN-world scripts a
//     random secret via a "voidy:hello" event. No page script exists yet, so only
//     our scripts can receive it. Every later message between the worlds must
//     carry this secret, so a page can't:
//       - send a fake "config: off" before ours arrives, or
//       - fake "held" / "detected" events.
//  2) Fetch this page's config once and share it with every other isolated
//     content script through globalThis.VOIDY (content scripts of one extension
//     share one isolated world per frame — the page can't see it).
//  3) Deliver the config to the MAIN world, relay "held" (stats) and "detected"
//     (Auto engine) events.
(() => {
  // --- 1) handshake -------------------------------------------------------
  const nonce = (() => {
    try { const a = new Uint32Array(4); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(36)).join(""); }
    catch (e) { return String(Math.random()).slice(2) + Date.now(); }
  })();
  // Firefox walls off objects made here from page scripts unless they are copied into the page.
  const toPage = (o) => (typeof cloneInto === "function" ? cloneInto(o, document.defaultView) : o);
  try { document.dispatchEvent(new CustomEvent("voidy:hello", { detail: toPage({ nonce }) })); } catch (e) {}
  // Every later message uses an event name derived from the secret: a
  // page can't listen for a name it can't know, so it can neither detect us
  // by our events nor read the secret out of them. Only "hello" is fixed, and
  // it fires before any page script exists.
  const ev = (kind) => "voidy-" + nonce + "-" + kind;

  // --- which site is this page part of? (iframes follow the TOP site) ------
  const topHost = (() => {
    try {
      if (window.top === window) return location.hostname;
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return new URL(ao[ao.length - 1]).hostname;
    } catch (e) {}
    return location.hostname;
  })();
  const topUrl = window.top === window ? location.href : "";

  // --- 2) config, shared with the other isolated scripts --------------------
  const FAILSAFE = { level: "full", guard: null, sensitive: false, shieldNetwork: null, auto: false,
                     annoy: { cats: [], cookieMode: "off", notifications: false }, cosmetic: null };
  const config = new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "getConfig", host: topHost, topUrl }, (resp) => {
        resolve(chrome.runtime.lastError || !resp ? FAILSAFE : resp);
      });
    } catch (e) { resolve(FAILSAFE); }
  });
  globalThis.VOIDY = { topHost, nonce, config, isTop: window.top === window };

  // --- 3) deliver to the MAIN world ------------------------------------------
  // The prompt's address uses Chrome's per-session random id (use_dynamic_url),
  // so pages can't probe for Voidy's files; its replies come from the extension's
  // own origin, which the guard checks too.
  let frameUrl = "", extOrigin = "";
  // (Firefox has no dynamic URLs: there the origin is simply that of getURL.)
  try { frameUrl = chrome.runtime.getURL("guard/guard-frame.html");
        extOrigin = frameUrl.startsWith("chrome-extension://") ? "chrome-extension://" + chrome.runtime.id : new URL(frameUrl).origin; } catch (e) {}
  // "Fix this site": while Voidy tests this tab, its question panel sits in a corner.
  let fixFrame = null;
  function showFixPanel() {
    if (fixFrame || window.top !== window || !frameUrl) return;
    fixFrame = document.createElement("iframe");
    fixFrame.src = chrome.runtime.getURL("guard/fix-panel.html");
    fixFrame.allow = "clipboard-write";
    fixFrame.style.cssText = "position:fixed!important;right:16px!important;bottom:16px!important;width:340px!important;height:150px!important;border:0!important;" +
      "z-index:2147483647!important;border-radius:12px!important;box-shadow:0 8px 30px rgba(0,0,0,.45)!important;color-scheme:dark!important;background:#1b1f29!important;display:block!important";
    const attach = () => { (document.body || document.documentElement).appendChild(fixFrame); };
    if (document.body) attach(); else document.addEventListener("DOMContentLoaded", attach, { once: true });
    window.addEventListener("message", (e) => {
      if (!fixFrame || e.source !== fixFrame.contentWindow || !e.data) return;
      if (e.data.height > 0) fixFrame.style.setProperty("height", Math.min(420, Math.ceil(e.data.height)) + "px", "important");
      if (e.data.voidyFixPanel === "close") { fixFrame.remove(); fixFrame = null; }
    });
  }
  // Feed ads (src/feed-main.js): hand over the markers, and pass its counts on
  // for the popup's "Feed check" (counts only).
  function feedBridge(feeds) {
    try { document.documentElement.setAttribute("data-voidy-feed", JSON.stringify(feeds)); } catch (e) { return; }
    let last = "";
    const timer = setInterval(() => {
      const now = document.documentElement.getAttribute("data-voidy-feed-count") || "";
      if (!now || now === last) return;
      last = now;
      try { chrome.runtime.sendMessage({ type: "feedCheck", counts: JSON.parse(now) }); } catch (e) { clearInterval(timer); }
    }, 2000);
  }
  config.then((cfg) => {
    if (cfg.fixPanel) showFixPanel();
    if (Array.isArray(cfg.feeds) && cfg.feeds.length) feedBridge(cfg.feeds);
    const main = { level: cfg.level, guard: cfg.guard, sensitive: cfg.sensitive, auto: cfg.auto,
                   notifGuard: !!(cfg.annoy && cfg.annoy.notifications), frameUrl, extOrigin, nonce };
    try { document.dispatchEvent(new CustomEvent(ev("config"), { detail: toPage(main) })); } catch (e) {}
  });

  // Relay events from the MAIN world — only if they carry the secret.
  let heldThisPage = 0;
  document.addEventListener(ev("held"), (e) => {
    if (!e.detail || e.detail.nonce !== nonce) return;
    if (++heldThisPage > 20) return;
    try { chrome.runtime.sendMessage({ type: "held" }); } catch (err) {}
  });
  document.addEventListener(ev("annoy"), (e) => {
    if (!e.detail || e.detail.nonce !== nonce) return;
    if (typeof globalThis.VOIDY.onAnnoy === "function") globalThis.VOIDY.onAnnoy(1);
  });
  document.addEventListener(ev("detected"), (e) => {
    if (!e.detail || e.detail.nonce !== nonce) return;
    // Hand to detector.js (same isolated world) through a local hook.
    if (typeof globalThis.VOIDY.onDetected === "function") globalThis.VOIDY.onDetected(String(e.detail.signal || "lib"));
    else (globalThis.VOIDY.pendingDetected = globalThis.VOIDY.pendingDetected || []).push(String(e.detail.signal || "lib"));
  });
})();
