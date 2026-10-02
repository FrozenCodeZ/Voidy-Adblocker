// Local, opt-in-to-view playback timings. This runs in every YouTube mode so
// Off and Full can be compared on the same video. No URLs or account data leave
// the page; the popup displays only aggregate timings and counts.
// Fresh YouTube settings (data/youtube.json, refreshed by list updates) are
// handed to the page script through an attribute; it reads and removes it.
try {
  chrome.storage.local.get("ytConfig", ({ ytConfig }) => {
    if (ytConfig && typeof ytConfig === "object") document.documentElement.setAttribute("data-voidy-yt", JSON.stringify(ytConfig));
  });
} catch (_) {}
(() => {
  if (window !== top) return;
  const stamp = () => Math.round(performance.now());
  const bucket = () => ({ count: 0, firstStartMs: null, lastStartMs: null,
    lastEndMs: null, longestStartMs: null, longestDurationMs: null });
  const metrics = {
    navigationEpochMs: Math.round(performance.timeOrigin),
    videoPresentMs: null, firstFrameMs: null, firstContentFrameMs: null, firstPlayMs: null,
    firstLoadStartMs: null, firstMetadataMs: null, firstCanPlayMs: null,
    loadStarts: 0, waiting: 0, stalled: 0, emptied: 0,
    firstWaitingMs: null, firstStalledMs: null, firstEmptiedMs: null,
    firstAdStateMs: null, lastAdStateMs: null, adStateTransitions: 0,
    mediaError: null, adObserved: false,
    readyState: null, networkState: null,
    resources: { playerApi: bucket(), media: bucket(), adService: bucket(),
      adServiceId: bucket(), adServiceLvz: bucket(), adServiceOther: bucket(),
      startupProbe: bucket() }
  };
  let pending = null, observed = false, resourceObserver = null;
  let player = null, playerObserver = null, adState = false;
  function publish() {
    if (performance.now() > 30000) return;
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      try { chrome.runtime.sendMessage({ type: "ytStartup", metrics }).catch(() => {}); } catch (_) {}
    }, 120);
  }
  function resourceKind(name) {
    try {
      const u = new URL(name), h = u.hostname, p = u.pathname;
      if ((h === "youtube.com" || h.endsWith(".youtube.com") || h === "youtubei.googleapis.com") && /^\/youtubei\/v1\/(player|get_watch|next)/.test(p)) return "playerApi";
      if (h === "googlevideo.com" || h.endsWith(".googlevideo.com") || /\/videoplayback(?:\/|$)/.test(p)) return "media";
      if ((h === "static.doubleclick.net" && p === "/instream/ad_status.js") || p.endsWith("/surrogates/youtube-status.js")) return "startupProbe";
      if (h === "doubleclick.net" || h.endsWith(".doubleclick.net") || h === "googlesyndication.com" || h.endsWith(".googlesyndication.com") || /\/pagead(?:\/|$)/.test(p)) return "adService";
    } catch (_) {}
    return null;
  }
  function record(entry) {
    if (performance.now() > 30000) return;
    const kind = resourceKind(entry.name);
    if (!kind) return;
    let detail = null;
    if (kind === "adService") {
      try {
        const u = new URL(entry.name);
        detail = u.hostname === "googleads.g.doubleclick.net" && u.pathname === "/pagead/id" ? "adServiceId"
          : u.hostname === "www.google.com" && u.pathname === "/pagead/lvz" ? "adServiceLvz" : "adServiceOther";
      } catch (_) { detail = "adServiceOther"; }
    }
    const end = entry.responseEnd || entry.startTime + entry.duration;
    for (const name of detail ? [kind, detail] : [kind]) {
      const b = metrics.resources[name];
      b.count++;
      b.firstStartMs ??= Math.round(entry.startTime);
      b.lastStartMs = Math.round(entry.startTime);
      if (end > 0) b.lastEndMs = Math.round(end);
      const duration = Math.max(0, end - entry.startTime);
      if (duration > (b.longestDurationMs ?? -1)) {
        b.longestDurationMs = Math.round(duration);
        b.longestStartMs = Math.round(entry.startTime);
      }
    }
    publish();
  }
  try {
    for (const entry of performance.getEntriesByType("resource")) record(entry);
    resourceObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) record(entry); });
    resourceObserver.observe({ type: "resource" });
  } catch (_) {}
  setTimeout(() => resourceObserver?.disconnect(), 30000);
  function samplePlayer() {
    if (!player || performance.now() > 30000) return;
    const active = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
    if (active === adState) return;
    adState = active;
    metrics.adStateTransitions++;
    if (active) {
      metrics.adObserved = true;
      metrics.firstAdStateMs ??= stamp();
    }
    metrics.lastAdStateMs = stamp();
    publish();
  }
  function observePlayer() {
    const current = document.querySelector("#movie_player");
    if (!current || current === player) return !!player;
    playerObserver?.disconnect();
    player = current;
    adState = false;
    samplePlayer();
    playerObserver = new MutationObserver(samplePlayer);
    playerObserver.observe(player, { attributes: true, attributeFilter: ["class"] });
    return true;
  }
  if (!observePlayer()) {
    const search = new MutationObserver(() => { if (observePlayer()) search.disconnect(); });
    search.observe(document, { childList: true, subtree: true });
    setTimeout(() => search.disconnect(), 30000);
  }
  setTimeout(() => playerObserver?.disconnect(), 30000);
  function observeVideo() {
    if (observed) return true;
    const video = document.querySelector("video");
    if (!video) return false;
    observed = true;
    metrics.videoPresentMs = stamp();
    const update = () => {
      metrics.readyState = video.readyState;
      metrics.networkState = video.networkState;
      samplePlayer();
      publish();
    };
    video.addEventListener("loadstart", () => { metrics.loadStarts++; metrics.firstLoadStartMs ??= stamp(); update(); });
    video.addEventListener("loadedmetadata", () => { metrics.firstMetadataMs ??= stamp(); update(); });
    video.addEventListener("canplay", () => { metrics.firstCanPlayMs ??= stamp(); update(); });
    video.addEventListener("waiting", () => { metrics.waiting++; metrics.firstWaitingMs ??= stamp(); update(); });
    video.addEventListener("stalled", () => { metrics.stalled++; metrics.firstStalledMs ??= stamp(); update(); });
    video.addEventListener("emptied", () => { metrics.emptied++; metrics.firstEmptiedMs ??= stamp(); update(); });
    video.addEventListener("playing", () => { metrics.firstPlayMs ??= stamp(); update(); });
    video.addEventListener("error", () => { metrics.mediaError = video.error?.code || null; update(); });
    if (video.requestVideoFrameCallback) {
      const frame = () => {
        samplePlayer();
        const first = metrics.firstFrameMs === null;
        metrics.firstFrameMs ??= stamp();
        if (!adState) metrics.firstContentFrameMs ??= stamp();
        if (first || metrics.firstContentFrameMs !== null) update();
        if (metrics.firstContentFrameMs === null && performance.now() < 30000) video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
    }
    update();
    return true;
  }
  if (!observeVideo()) {
    const observer = new MutationObserver(() => { if (observeVideo()) observer.disconnect(); });
    observer.observe(document, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 30000);
  }
})();
