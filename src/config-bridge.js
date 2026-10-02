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
  try { document.dispatchEvent(new CustomEvent("voidy:hello", { detail: { nonce } })); } catch (e) {}
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
  try { frameUrl = chrome.runtime.getURL("guard/guard-frame.html"); extOrigin = "chrome-extension://" + chrome.runtime.id; } catch (e) {}
  config.then((cfg) => {
    const main = { level: cfg.level, guard: cfg.guard, sensitive: cfg.sensitive, auto: cfg.auto,
                   notifGuard: !!(cfg.annoy && cfg.annoy.notifications), frameUrl, extOrigin, nonce };
    try { document.dispatchEvent(new CustomEvent(ev("config"), { detail: main })); } catch (e) {}
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
