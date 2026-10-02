// Ad-frame safety + stealth sweep — ISOLATED world, document_end, all frames.
//
// Generic ad hiding (EasyList) now lives in annoyances.js ("ads" category, Full
// mode only). This file keeps the two jobs that are about ad FRAMES:
//   - every blocking mode except Lite/Off: known ad frames are made unclickable,
//     so a click inside an ad iframe can't hijack the page past the Redirect Guard
//   - stealth modes: hide an ad frame only if it rendered real content; empty
//     bait boxes are left alone because detectors measure them.
// Remember the last right-clicked element for "Hide this with Voidy" (right-click menu).
addEventListener("contextmenu", (e) => { globalThis.__voidyContextTarget = { el: e.target, at: Date.now() }; }, true);
(() => {
  const M = globalThis.VOIDY;
  if (!M) return;
  const AD_FRAME_HOSTS = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "amazon-adsystem.com", "adnxs.com", "adsrvr.org", "criteo.com", "criteo.net",
    "taboola.com", "outbrain.com", "rubiconproject.com", "pubmatic.com", "openx.net",
    "3lift.com", "adform.net", "smartadserver.com", "casalemedia.com", "indexww.com",
    "media.net", "teads.tv", "gumgum.com", "adroll.com", "bidswitch.net", "moatads.com"
  ];
  const AD_FRAMES = AD_FRAME_HOSTS.map((h) => `iframe[src*="${h}"]`).join(",");

  // A site posing as a well-known brand (weak match) that asks for a password:
  // tell the background, which shows the look-alike warning. Top frame only.
  M.config.then((cfg) => {
    if (!cfg || !cfg.lookalike || window.top !== window) return;
    const ask = () => { try { chrome.runtime.sendMessage({ type: "lookalikePassword" }); } catch (e) {} };
    // Strong look-alikes normally never get this far (the background redirects
    // the tab when it starts loading); this is the backup if that was too late.
    if (cfg.lookalike.strength === "strong" || document.querySelector('input[type="password"]')) return ask();
    const mo = new MutationObserver(() => { if (document.querySelector('input[type="password"]')) { mo.disconnect(); ask(); } });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["type"] });
    setTimeout(() => mo.disconnect(), 120000);
  });

  M.config.then((cfg) => {
    const level = cfg && cfg.level;
    if (!level || level === "off" || level === "lite" || level === "shield") return;
    const style = document.createElement("style");
    style.textContent = AD_FRAMES + "{pointer-events:none!important}";
    (document.head || document.documentElement).appendChild(style);
    if (!level.startsWith("stealth")) return;

    let hidden = 0;
    const sweep = () => {
      let frames = [];
      try { frames = Array.from(document.querySelectorAll(AD_FRAMES)); } catch (e) {}
      for (const f of frames) {
        const r = f.getBoundingClientRect();
        if (r.width * r.height > 1000 && f.style.display !== "none") { f.style.setProperty("display", "none", "important"); hidden++; }
      }
      if (hidden) { try { chrome.runtime.sendMessage({ type: "cosmeticCount", ads: hidden, annoy: 0, src: "sweep" }); } catch (e) {} }
    };
    sweep();
    if (document.readyState === "complete") setTimeout(sweep, 1500);
    else addEventListener("load", () => setTimeout(sweep, 1500), { once: true });
  });
})();
