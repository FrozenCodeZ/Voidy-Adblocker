// Twitch without stream ads (Voidy's own code). Runs in the page at
// document_start on twitch.tv, only where the Ads switch and site mode allow.
//
// Twitch stitches ads into the live video playlist itself, so there is nothing
// separate to block. Whether a playlist carries an ad is decided per request
// and per player type ("site", "popout", "embed"...). So when the playlist the
// player downloads contains ad segments, the same channel at the same quality
// is requested through other player types, and the player is handed the first
// playlist without ads. This is checked on every playlist refresh, so breaks in
// the middle of a stream are covered too.
//
// Twitch's video player downloads playlists from a Web Worker, so the watcher
// is added to the start of every worker the page creates.
(() => {
  "use strict";
  const NativeWorker = window.Worker;
  if (typeof NativeWorker !== "function") return;

  // ---- runs inside the video worker -----------------------------------------
  function workerPrelude() {
    // ---- Settings ----------------------------------------------------------
    const BACKUP_TYPES = ["popout", "frontpage", "autoplay", "site", "embed"];   // tried in this order
    const CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";                           // twitch.tv's public web client id
    const TOKEN_TTL_MS = 5 * 60 * 1000;
    // ------------------------------------------------------------------------
    const nativeFetch = self.fetch;
    const AD = /stitched-ad|X-TV-TWITCH-AD|CLASS="twitch-stitched-ad"|EXT-X-DATERANGE:ID="stitched/i;
    const QUERY = 'query PlaybackAccessToken_Voidy($login:String!,$playerType:String!){streamPlaybackAccessToken(channelName:$login,params:{platform:"web",playerBackend:"mediaplayer",playerType:$playerType}){value signature}}';
    const variants = new Map();      // media playlist URL -> { login, resolution, query, path }
    const backups = new Map();       // login|type -> { at, streams: [{ resolution, url }] }
    let preferred = null;            // the player type that last gave a clean playlist

    const text = async (url, init) => { const r = await nativeFetch(url, init); if (!r.ok) throw new Error(String(r.status)); return r.text(); };
    function parseMaster(body) {
      const lines = body.split("\n"), out = [];
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
        const res = (lines[i].match(/RESOLUTION=(\d+x\d+)/) || [])[1] || "audio";
        const url = (lines[i + 1] || "").trim();
        if (url.startsWith("http")) out.push({ resolution: res, url });
      }
      return out;
    }
    async function backupStreams(login, type, query, path) {
      const key = login + "|" + type, hit = backups.get(key);
      if (hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.streams;
      const r = await nativeFetch("https://gql.twitch.tv/gql", { method: "POST", headers: { "Client-ID": CLIENT_ID },
        body: JSON.stringify({ query: QUERY, variables: { login, playerType: type } }) });
      const token = (await r.json())?.data?.streamPlaybackAccessToken;
      if (!token) throw new Error("no token");
      const params = new URLSearchParams(query);
      params.set("sig", token.signature); params.set("token", token.value); params.set("p", String(Math.floor(Math.random() * 1e7)));
      const streams = parseMaster(await text(`https://usher.ttvnw.net${path}?${params}`));
      backups.set(key, { at: Date.now(), streams });
      return streams;
    }
    const pixels = (res) => { const [w, h] = String(res).split("x").map(Number); return (w || 0) * (h || 0); };
    async function cleanPlaylist(info) {
      const order = preferred ? [preferred, ...BACKUP_TYPES.filter((t) => t !== preferred)] : BACKUP_TYPES;
      for (const type of order) {
        try {
          const streams = await backupStreams(info.login, type, info.query, info.path);
          if (!streams.length) continue;
          const want = pixels(info.resolution);
          const pick = streams.find((s) => s.resolution === info.resolution)
            || streams.slice().sort((a, b) => Math.abs(pixels(a.resolution) - want) - Math.abs(pixels(b.resolution) - want))[0];
          const body = await text(pick.url);
          if (!AD.test(body)) { preferred = type; return body; }
        } catch (_) { backups.delete(info.login + "|" + type); }
      }
      return null;
    }

    self.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      const response = await nativeFetch.apply(this, arguments);
      try {
        if (!url || !response.ok) return response;
        // the channel's list of qualities (Twitch has used /api/ and /api/v2/ paths)
        const master = /^https:\/\/usher\.ttvnw\.net(\/api\/(?:v\d+\/)?channel\/hls\/([a-z0-9_]+)\.m3u8)/i.exec(url);
        if (master) {
          const path = master[1], login = master[2].toLowerCase(), query = url.split("?")[1] || "";
          for (const s of parseMaster(await response.clone().text())) variants.set(s.url, { login, resolution: s.resolution, query, path });
          return response;
        }
        const info = variants.get(url);
        if (!info) return response;
        const body = await response.clone().text();
        if (!AD.test(body)) return response;
        const clean = await cleanPlaylist(info);
        if (!clean) return response;                          // no clean copy found: Twitch's own playlist
        return new Response(clean, { status: 200, statusText: "OK", headers: response.headers });
      } catch (_) { return response; }
    };
  }

  // ---- page side: add the watcher to every worker the page starts -----------
  const prelude = "(" + workerPrelude.toString() + ")();\n";
  function wrapScript(url) {
    const absolute = new URL(String(url), location.href).href;
    return URL.createObjectURL(new Blob([prelude, "importScripts(" + JSON.stringify(absolute) + ");"], { type: "text/javascript" }));
  }
  const Wrapped = function Worker(url, options) {
    if (!new.target) throw new TypeError("Failed to construct 'Worker': Please use the 'new' operator.");
    let target = url;
    try {
      // only Twitch's own workers (same origin, including its blob: URLs), never module workers
      if ((!options || options.type !== "module") && new URL(String(url), location.href).origin === location.origin) target = wrapScript(url);
    } catch (_) { target = url; }
    return Reflect.construct(NativeWorker, [target, options], new.target === Wrapped ? NativeWorker : new.target);
  };
  Wrapped.prototype = NativeWorker.prototype;
  Object.setPrototypeOf(Wrapped, NativeWorker);
  try { Object.defineProperty(window, "Worker", { configurable: true, writable: true, value: Wrapped }); } catch (_) {}
})();
