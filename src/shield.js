// Shield: ISOLATED world, document_end, all frames. Only runs at level "shield".
//
// Shield is the last resort for sites that verify ads on THEIR server. The
// background lets exactly ONE ad network's requests load (so the server's check
// passes); this script then nullifies those ads at the interface:
//   - invisible (opacity 0) and unclickable (pointer-events none)
//   - video ads muted, and "skip" clicked when offered
//
// Everything else stays blocked, the security filter and the Redirect Guard stay
// on. This file only HIDES a loaded ad. It never fakes "the ad was seen"
// (viewability) and never fakes a click, because either would be ad fraud.
// So it dispatches no synthetic events: it just hides and mutes.
(() => {
  const AD_FRAME_HOSTS = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagservices.com",
    "amazon-adsystem.com", "media.net"
  ];
  const AD_FRAME_SELECTOR = AD_FRAME_HOSTS.map((h) => `iframe[src*="${h}"]`);
  const BOX = ["ins.adsbygoogle", '[id^="div-gpt-ad"]', '[id^="google_ads_iframe"]', ".ad-container", ".ad-banner"];

  function apply() {
    const sel = AD_FRAME_SELECTOR.concat(BOX).join(",\n");
    const style = document.createElement("style");
    // Not display:none — the ad has already loaded (the server saw the request);
    // we just make it take up no attention. We do NOT claim it was viewed.
    style.textContent = sel + " { opacity: 0 !important; pointer-events: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  }

  // Mute video ads and click a "skip" control if the site shows one. We only
  // ever act on controls the site itself renders; we invent no impressions.
  // Exact player classes only (a loose "[class*=skip]" match could click a site's
// "skip to content" link).
  const SKIP_SELECTORS = [".ytp-ad-skip-button", ".ytp-ad-skip-button-modern", ".ytp-skip-ad-button", ".videoAdUiSkipButton"];
  function tameVideos() {
    try {
      document.querySelectorAll("video").forEach((v) => {
        // Mute only while an ad is signalled by the player (best-effort, class-based).
        const player = v.closest(".ad-showing, .ad-interrupting, [class*='ad-showing']");
        if (player) v.muted = true;
      });
    } catch (e) {}
    for (const s of SKIP_SELECTORS) {
      let btn = null;
      try { btn = document.querySelector(s); } catch (e) {}
      if (btn && btn.offsetParent !== null) { try { btn.click(); } catch (e) {} }
    }
  }

  const M = globalThis.VOIDY;
  if (!M) return;
  M.config.then((cfg) => {
    if (!cfg || cfg.level !== "shield") return;
    apply();
    tameVideos();
    try {
      const mo = new MutationObserver(() => { clearTimeout(tameVideos._t); tameVideos._t = setTimeout(tameVideos, 400); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 60000);
    } catch (e) {}
  });
})();
