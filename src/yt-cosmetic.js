// Site-specific ad containers; no broad class-name bait or player controls.
// Runs in the isolated world only when YouTube Ads is enabled for this site.
(() => {
  const css = ["ytd-ad-slot-renderer", "ytd-display-ad-renderer", "ytd-promoted-sparkles-web-renderer",
    "ytd-in-feed-ad-layout-renderer", "ytd-promoted-video-renderer", "ytd-action-companion-ad-renderer",
    "ytd-companion-slot-renderer"].join(",") + "{display:none!important}";
  const style = document.createElement("style");
  style.textContent = css;
  function attach() {
    if (style.isConnected) return;
    const parent = document.head || document.documentElement;
    if (parent) parent.appendChild(style);
  }
  attach();
  if (!style.isConnected) {
    const observer = new MutationObserver(() => { attach(); if (style.isConnected) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
  }
})();
