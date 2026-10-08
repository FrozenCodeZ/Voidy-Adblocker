// Spotify web player: mute ads that get through (ISOLATED world; registered on
// open.spotify.com while the Ads filter is on). Which page elements mean "an ad
// is playing" comes from the shared fixes file; with none, this does nothing.
// It only reports on and off; the background mutes the tab, and only ever
// unmutes a tab it muted itself (src/mute-decision.js).
(() => {
  chrome.runtime.sendMessage({ type: "spotifyConfig" }, (cfg) => {
    if (chrome.runtime.lastError || !cfg || !Array.isArray(cfg.adPlaying)) return;
    const selectors = cfg.adPlaying.filter((s) => { try { document.querySelector(s); return true; } catch (e) { return false; } });
    if (!selectors.length) return;
    const sel = selectors.join(",");
    let on = false, queued = false;
    function check() {
      queued = false;
      const now = !!document.querySelector(sel);
      if (now === on) return;
      on = now;
      try { chrome.runtime.sendMessage({ type: "adMute", on }); } catch (e) {}
    }
    const soon = () => { if (!queued) { queued = true; setTimeout(check, 250); } };
    new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-testid", "aria-label", "class"] });
    setInterval(check, 1000);
    check();
  });
})();
