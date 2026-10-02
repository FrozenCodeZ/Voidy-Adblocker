/*
 * Surrogate for googlesyndication.com/pagead/js/adsbygoogle.js (Stealth 1-3)
 *
 * The site's own script tag loads *something* with a 200, window.adsbygoogle
 * exists and accepts .push(), AND every <ins class="adsbygoogle"> ad slot ends
 * up looking like a slot Google actually served — so the page's own "did the
 * ad render?" check passes. Nothing is fetched from Google, nothing is shown,
 * nothing is reported to anyone. Fully bundled, no remote code.
 *
 * Slots receive a small, blank placeholder frame so page layout and local
 * ad-block checks see a completed slot without contacting an ad network.
 *
 * Why the placeholder matters: some walls check nothing else. They run
 * document.querySelectorAll("ins.adsbygoogle") and ask each slot for a child
 * <div> (or an iframe taller than 0px). An empty slot = "ad blocker" = wall.
 *
 * What a slot gets, mirroring what the real library leaves behind:
 *   <ins class="adsbygoogle" data-adsbygoogle-status="done" data-ad-status="filled">
 *     <div id="aswift_N_host"><iframe id="aswift_N"></iframe></div>
 *   </ins>
 * The iframe is blank (about:blank), 1px tall and invisible — enough for an
 * "offsetHeight > 0" check, not enough to leave a hole in the page.
 *
 * Ethics line (same as shield.js): this satisfies a CLIENT-SIDE check in the
 * page. It sends nothing to Google — no impression, no viewability ping, no
 * click — so no advertiser is billed for anything. That's the line: we fake
 * what the page sees, never what an ad network is told.
 */
(function () {
  "use strict";
  if (window.adsbygoogle && window.adsbygoogle.loaded && window.adsbygoogle.__voidy) return;

  let n = 0;
  function fill(ins) {
    try {
      if (!ins || ins.getAttribute("data-adsbygoogle-status") === "done") return;
      const id = "aswift_" + (n++);
      const host = document.createElement("div");
      host.id = id + "_host";
      host.style.cssText = "border:none;height:1px;width:100%;margin:0;padding:0;position:relative;visibility:visible;background:transparent;display:block;overflow:hidden";
      const fr = document.createElement("iframe");
      fr.id = id;
      fr.name = id;
      fr.setAttribute("frameborder", "0");
      fr.setAttribute("scrolling", "no");
      fr.setAttribute("aria-hidden", "true");
      fr.setAttribute("tabindex", "-1");
      fr.style.cssText = "border:0;width:100%;height:1px;display:block;opacity:0;pointer-events:none";
      host.appendChild(fr);
      ins.appendChild(host);
      ins.setAttribute("data-adsbygoogle-status", "done");
      ins.setAttribute("data-ad-status", "filled");
    } catch (e) {}
  }
  function fillAll() {
    try { document.querySelectorAll("ins.adsbygoogle").forEach(fill); } catch (e) {}
  }

  const queued = Array.isArray(window.adsbygoogle) ? window.adsbygoogle.slice() : [];
  // The real .push({}) means "render the next unfilled slot"; fill them all —
  // a slot the page adds later is picked up by the next push or the observer.
  const push = function () { fillAll(); return 1; };

  window.adsbygoogle = { loaded: true, push: push, length: 0, __voidy: true };
  for (const item of queued) { try { push(item); } catch (e) {} }

  fillAll();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillAll, { once: true });
  // Slots written in after load (document.write, lazy sections, infinite
  // scroll) get filled too; stop watching after a minute to stay cheap.
  try {
    let t = 0;
    const mo = new MutationObserver(() => { if (!t) t = setTimeout(() => { t = 0; fillAll(); }, 50); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { try { mo.disconnect(); } catch (e) {} }, 60000);
  } catch (e) {}

  // Some pages look for these globals from the real lib.
  window.__google_ad_urls = window.__google_ad_urls || [];
  window.google_ad_modifications = window.google_ad_modifications || { eids: [], loeids: [] };
})();
