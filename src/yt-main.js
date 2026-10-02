// Project-owned YouTube adapter (Voidy's own code; the approach below was
// learned by studying uBlock Origin Lite's public YouTube filters, GPL-3.0 —
// see THIRD-PARTY-NOTICES.md). Registered at document_start only where the Ads
// switch and site mode permit.
//  1. Remove ad scheduling from player data; keep video, captions and state.
//  2. When ad data is missing, YouTube's video server makes the player wait
//     ~4 s. Player requests that carry a fresh activity time and a
//     player-params value are answered without that wait, so player requests
//     are sent that way, and a first page load that had ads planned reloads
//     its video once through the player (about half a second).
//  3. Pages can't sidestep this by borrowing a clean fetch from a new frame.
(() => {
  "use strict";
  const apply = Reflect.apply;
  const define = Object.defineProperty, descriptor = Object.getOwnPropertyDescriptor;
  const parse = JSON.parse, stringify = JSON.stringify;
  const get = WeakMap.prototype.get, set = WeakMap.prototype.set;
  const read = (map, key) => apply(get, map, [key]);
  const write = (map, key, value) => apply(set, map, [key, value]);
  const originals = new WeakMap();
  const MAX_TEXT = 4 * 1024 * 1024;
  // Refreshable details (data/youtube.json). Built-in values are the fallback;
  // a newer copy arrives through an attribute set by yt-startup.js.
  const settings = { playerParams: "8AUB", freshActivityTime: true, quickReload: true, adKeys: ["adPlacements", "adSlots", "playerAds"] };
  let settingsRead = false;
  function config() {
    if (settingsRead || typeof document !== "object" || !document.documentElement) return settings;
    const raw = document.documentElement.getAttribute("data-voidy-yt");
    if (raw === null) return settings;
    settingsRead = true;
    try {
      document.documentElement.removeAttribute("data-voidy-yt");
      const c = parse(raw);
      if (typeof c.playerParams === "string" && /^[A-Za-z0-9_-]{1,40}={0,2}$/.test(c.playerParams)) settings.playerParams = c.playerParams;
      for (const k of ["freshActivityTime", "quickReload"]) if (typeof c[k] === "boolean") settings[k] = c[k];
      if (Array.isArray(c.adKeys) && c.adKeys.length && c.adKeys.every(k => typeof k === "string" && /^[A-Za-z]{2,40}$/.test(k))) settings.adKeys = c.adKeys.slice(0, 12);
    } catch (_) {}
    return settings;
  }

  // Keep wrapper inspection consistent with the other MAIN-world adapters.
  try {
    const original = Function.prototype.toString;
    const replacement = { toString() { return apply(original, read(originals, this) || this, []); } }.toString;
    write(originals, replacement, original);
    define(Function.prototype, "toString", { ...descriptor(Function.prototype, "toString"), value: replacement });
  } catch (_) {}
  function method(object, key, factory) {
    const d = descriptor(object, key);
    if (!d || typeof d.value !== "function" || (!d.configurable && !d.writable)) return;
    const replacement = factory(d.value);
    try {
      define(replacement, "name", { value: d.value.name });
      define(replacement, "length", { value: d.value.length });
      write(originals, replacement, d.value);
      define(object, key, { ...d, value: replacement });
    } catch (_) {}
  }
  function getter(object, key, factory) {
    const d = descriptor(object, key);
    if (!d || !d.configurable || typeof d.get !== "function") return;
    const replacement = factory(d.get);
    write(originals, replacement, d.get);
    define(object, key, { ...d, get: replacement });
  }
  function target(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!/^https?:$/.test(url.protocol)) return false;
      const host = url.hostname;
      const trusted = ["youtube.com", "youtube-nocookie.com", "youtubekids.com"].some(h => host === h || host.endsWith("." + h)) || host === "youtubei.googleapis.com";
      return trusted && /^\/youtubei\/v1\/(?:player|get_watch|next|reel\/reel_watch_sequence)\/?$/.test(url.pathname);
    } catch (_) { return false; }
  }

  // Walk only known response containers. Long arrays, frozen data and cycles
  // are bounded without touching unrelated application state.
  function clean(root, emptyArrays = false) {
    const seen = new WeakSet(), pending = [{ value: root, depth: 0 }];
    let changed = false, visited = 0;
    while (pending.length && visited++ < 10000) {
      const { value: o, depth } = pending.pop();
      if (!o || typeof o !== "object" || depth > 16 || seen.has(o)) continue;
      seen.add(o);
      if (Array.isArray(o)) {
        for (let i = 0; i < o.length && i < 10000; i++) pending.push({ value: o[i], depth: depth + 1 });
        continue;
      }
      for (const key of config().adKeys) {
        const d = descriptor(o, key);
        if (d && d.configurable) {
          try {
            // Keep an already-empty array intact. Replacing it creates a
            // spurious change to the player's own object even when there is
            // no ad placement to remove.
            if (emptyArrays && Array.isArray(d.value) && d.writable) {
              if (d.value.length) { o[key] = []; changed = true; }
            }
            else changed = Reflect.deleteProperty(o, key) || changed;
          } catch (_) {}
        }
      }
      for (const key of ["playerResponse", "reelWatchSequenceResponse"]) {
        const d = descriptor(o, key);
        if (!d || !("value" in d)) continue;
        if (typeof d.value === "string" && key === "playerResponse" && d.writable) {
          const out = cleanText(d.value);
          if (out !== d.value) { try { o[key] = out; changed = true; } catch (_) {} }
        } else pending.push({ value: d.value, depth: depth + 1 });
      }
      const entries = descriptor(o, "entries");
      if (entries && entries.writable && Array.isArray(entries.value)) {
        const filtered = entries.value.filter(entry => entry?.command?.reelWatchEndpoint?.adClientParams?.isAd !== true);
        if (filtered.length !== entries.value.length) { try { o.entries = filtered; changed = true; } catch (_) {} }
      }
    }
    return changed;
  }
  function cleanText(text) {
    if (typeof text !== "string" || text.length > MAX_TEXT || !new RegExp('"(?:' + config().adKeys.join("|") + '|isAd|playerResponse)"').test(text)) return text;
    try {
      const data = apply(parse, JSON, [text]);
      return clean(data) ? apply(stringify, JSON, [data]) : text;
    } catch (_) { return text; }
  }

  // Preserve existing accessors/non-writable properties. Ordinary assignments
  // are processed before the player reads them.
  function watch(object, key, transform) {
    if (!object || typeof object !== "object") return;
    try {
      const d = descriptor(object, key);
      if (d && (!("value" in d) || !d.configurable || !d.writable)) {
        if ("value" in d) transform(d.value);
        return;
      }
      const safelyTransform = next => { try { return transform(next); } catch (_) { return next; } };
      let value = safelyTransform(d?.value);
      define(object, key, { configurable: true, enumerable: d?.enumerable ?? true,
        get() { return value; }, set(next) { value = safelyTransform(next); } });
    } catch (_) {}
  }
  const observed = new WeakSet();
  function observePlayer(player) {
    if (!player || typeof player !== "object" || observed.has(player)) return player;
    observed.add(player);
    watch(player, "config", config => {
      watch(config, "args", args => {
        watch(args, "player_response", value => typeof value === "string" ? cleanText(value) : (clean(value), value));
        return args;
      });
      return config;
    });
    return player;
  }
  // Remember which video's first-load data had ads planned (see quickReload).
  let adsPlannedFor = "";
  watch(window, "ytInitialPlayerResponse", value => {
    try { if (clean(value, true)) adsPlannedFor = value?.videoDetails?.videoId || ""; } catch (_) {}
    return value;
  });
  watch(window, "ytplayer", observePlayer);

  // Filter as the page consumes the body. Fetch resolves at headers, rather
  // than waiting for a cloned body and a second complete read before startup.
  const NativeResponse = Response, NativeHeaders = Headers;
  const NativeRequest = typeof Request === "function" ? Request : null, NativeBlob = typeof Blob === "function" ? Blob : null;
  const NativeDecompress = typeof DecompressionStream === "function" ? DecompressionStream : null;
  const NativeCompress = typeof CompressionStream === "function" ? CompressionStream : null;

  // ---- 2. player requests without the penalty wait -------------------------
  // YouTube sends /youtubei/v1/player bodies as JSON, often gzip-compressed.
  // /player (first load, reloads) and get_watch (clicking a video inside YouTube,
  // which nests the player request as "playerRequest").
  const isPlayerRequest = (url) => { try { return /^\/youtubei\/v1\/(?:player|get_watch)\/?$/.test(new URL(url, location.href).pathname) && target(url); } catch (_) { return false; } };
  function editPlayerBody(data) {
    if (!data || typeof data !== "object" || data.context?.client?.clientName !== "WEB") return false;
    const request = data.playerRequest && typeof data.playerRequest === "object" ? data.playerRequest : data;
    const c = config();
    if (!request.params && c.playerParams) request.params = c.playerParams;
    const playback = request.playbackContext?.contentPlaybackContext;
    if (c.freshActivityTime && playback && typeof playback === "object") playback.lactMilliseconds = String(Date.now());
    return true;
  }
  const through = (bytes, stream) => new NativeResponse(new NativeBlob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  async function editPlayerBytes(buffer) {
    const bytes = new Uint8Array(buffer), gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
    if (!NativeBlob || (gzip && (!NativeDecompress || !NativeCompress))) return null;
    const text = new TextDecoder().decode(gzip ? await through(bytes, new NativeDecompress("gzip")) : bytes);
    const data = apply(parse, JSON, [text]);
    if (!editPlayerBody(data)) return null;
    const out = new TextEncoder().encode(apply(stringify, JSON, [data]));
    return gzip ? through(out, new NativeCompress("gzip")) : out;
  }
  function editPlayerText(text) {
    try { const data = apply(parse, JSON, [text]); return editPlayerBody(data) ? apply(stringify, JSON, [data]) : text; } catch (_) { return text; }
  }

  // A first page load whose data had ads planned: reload the same video once
  // through the player, so it asks again with the request above.
  let reloadedFor = "";
  function quickReload() {
    if (location.hostname !== "www.youtube.com" || location.pathname !== "/watch") return;
    const query = new URLSearchParams(location.search), id = query.get("v");
    if (!config().quickReload || !id || id !== adsPlannedFor || reloadedFor === id || query.has("list")) return;   // playlists keep their queue
    const player = document.getElementById("movie_player");
    if (!player || typeof player.loadVideoById !== "function" || typeof player.getPlayerResponse !== "function") return;
    const response = player.getPlayerResponse();
    if (!response || response.videoDetails?.videoId !== id) return;
    reloadedFor = id;
    try { player.loadVideoById(id, response.playerConfig?.playbackStartConfig?.startSeconds || 0); } catch (_) {}
  }
  if (typeof MutationObserver === "function" && typeof document === "object") {
    const reloadWatcher = new MutationObserver(() => { if (adsPlannedFor && reloadedFor !== adsPlannedFor) quickReload(); });
    try { reloadWatcher.observe(document, { childList: true, subtree: true }); setTimeout(() => reloadWatcher.disconnect(), 30000); } catch (_) {}
  }
  // get_watch can deliver player data before slower recommendation chunks.
  // Buffer one complete array item, not the entire response. Scan raw bytes so
  // UTF-8 split across network chunks and unchanged payloads retain their bytes.
  function playerStream() {
    let root=null,active=false,kind=null,depth=0,quoted=false,escaped=false,raw=false;
    let parts=[],size=0;
    function append(bytes,controller) {
      if(!bytes.length)return;
      parts.push(bytes);size+=bytes.length;
      if(size>MAX_TEXT){for(const p of parts)controller.enqueue(p);parts=[];size=0;raw=true;}
    }
    function finish(controller) {
      if(raw)return;
      const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
      const text=new TextDecoder().decode(bytes),out=cleanText(text);
      controller.enqueue(out===text?bytes:new TextEncoder().encode(out));parts=[];size=0;active=false;
      if(root!=='array')raw=true;
    }
    return new TransformStream({
      transform(chunk,controller) {
        if(raw){controller.enqueue(chunk);return;}
        let start=0;
        for(let i=0;i<chunk.length;i++){
          const b=chunk[i];
          if(!active){
            if(b===32||b===9||b===10||b===13||root==='array'&&b===44)continue;
            if(root===null&&b===91){root='array';continue;}
            if(root==='array'&&b===93){controller.enqueue(chunk.subarray(start));raw=true;return;}
            if(i>start)controller.enqueue(chunk.subarray(start,i));start=i;
            root??='single';active=true;quoted=b===34;escaped=false;depth=b===123||b===91?1:0;kind=depth?'container':quoted?'string':'primitive';
            continue;
          }
          if(kind==='primitive'&&(b===44||b===93||b===32||b===9||b===10||b===13)){
            append(chunk.subarray(start,i),controller);finish(controller);start=i;
            if(raw){controller.enqueue(chunk.subarray(start));return;}i--;continue;
          }
          if(quoted){if(escaped)escaped=false;else if(b===92)escaped=true;else if(b===34)quoted=false;}
          else if(b===34)quoted=true;
          else if(b===123||b===91)depth++;
          else if(b===125||b===93)depth--;
          if(!quoted&&(kind==='string'||kind==='container'&&depth===0)){
            append(chunk.subarray(start,i+1),controller);finish(controller);start=i+1;
            if(raw){if(start<chunk.length)controller.enqueue(chunk.subarray(start));return;}
          }
        }
        if(start<chunk.length){if(active)append(chunk.subarray(start),controller);else controller.enqueue(chunk.subarray(start));}
      },
      flush(controller){if(parts.length){if(kind==='primitive')finish(controller);else for(const p of parts)controller.enqueue(p);}}
    });
  }
  function responseWithMetadata(body, original) {
    const headers = new NativeHeaders(original.headers);
    headers.delete("content-length"); headers.delete("content-encoding");
    const replacement = new NativeResponse(body, { status: original.status, statusText: original.statusText, headers });
    function decorate(response) {
      for (const key of ["url", "type", "redirected"]) define(response, key, { configurable: true, value: original[key] });
      define(response, "clone", { configurable: true, writable: true, value: ({ clone() {
        return decorate(apply(NativeResponse.prototype.clone, this, []));
      } }).clone });
      return response;
    }
    return decorate(replacement);
  }
  method(window, "fetch", original => ({ fetch(input, init) {
    // 2. edit player requests (a Request object's body is read, edited and rebuilt)
    if (NativeRequest && input instanceof NativeRequest && input.method === "POST" && isPlayerRequest(input.url)) {
      const self = this, rest = [...arguments].slice(1);
      return apply(NativeRequest.prototype.clone, input, []).arrayBuffer().then(async buffer => {
        let body = null;
        try { body = buffer.byteLength ? await editPlayerBytes(buffer) : null; } catch (_) {}
        return filtered(apply(original, self, [body ? new NativeRequest(input, { body }) : input, ...rest]), input);
      }, () => filtered(apply(original, self, arguments), input));
    }
    if (typeof init?.body === "string" && isPlayerRequest(typeof input === "string" ? input : input?.url)) {
      arguments[1] = { ...init, body: editPlayerText(init.body) };
    }
    return filtered(apply(original, this, arguments), input);
  } }).fetch);
  function filtered(promise, input) {
    if (!target(input)) return promise;
    return promise.then(response => {
      if (!response?.ok || !response.body || response.bodyUsed || Number(response.headers.get("content-length")) > MAX_TEXT) return response;
      try {
        return responseWithMetadata(response.body.pipeThrough(playerStream()), response);
      } catch (_) { return response; }
    });
  }
  const requests = new WeakMap(), cache = new WeakMap();
  const playerXhr = new WeakSet();
  method(XMLHttpRequest.prototype, "open", original => ({ open(method, url) {
    const result = apply(original, this, arguments);
    const address = typeof url === "string" ? url : String(url);
    write(requests, this, target(address));
    write(cache, this, null);
    if (String(method).toUpperCase() === "POST" && isPlayerRequest(address)) playerXhr.add(this); else playerXhr.delete(this);
    return result;
  } }).open);
  method(XMLHttpRequest.prototype, "send", original => ({ send(body) {
    if (typeof body === "string" && playerXhr.has(this)) arguments[0] = editPlayerText(body);
    return apply(original, this, arguments);
  } }).send);
  function xhrText(xhr, raw) {
    if (!read(requests, xhr) || xhr.readyState !== 4 || xhr.status < 200 || xhr.status >= 300) return raw;
    const prior = read(cache, xhr);
    if (prior?.raw === raw) return prior.out;
    const out = cleanText(raw);
    write(cache, xhr, { raw, out });
    return out;
  }
  getter(XMLHttpRequest.prototype, "responseText", original => descriptor({ get responseText() {
    return xhrText(this, apply(original, this, []));
  } }, "responseText").get);
  getter(XMLHttpRequest.prototype, "response", original => descriptor({ get response() {
    const value = apply(original, this, []);
    if (typeof value === "string") return xhrText(this, value);
    if (this.responseType === "json" && this.readyState === 4 && this.status >= 200 && this.status < 300 && read(requests, this)) {
      try { clean(value); } catch (_) {}
    }
    return value;
  } }, "response").get);

  // ---- 3. no clean fetch from a fresh frame ---------------------------------
  // A same-origin frame's own fetch would skip the filtering above; frames the
  // page adds use this window's fetch instead.
  const HTMLFrame = typeof HTMLIFrameElement === "function" ? HTMLIFrameElement : null;
  function shareFetch(node) {
    try {
      const frames = node instanceof HTMLFrame ? [node] : node?.querySelectorAll ? node.querySelectorAll("iframe") : [];
      for (const frame of frames) {
        const w = frame.contentWindow;
        if (w && w !== window && w.fetch !== window.fetch) try { define(w, "fetch", { configurable: true, writable: true, value: window.fetch }); } catch (_) {}
      }
    } catch (_) {}
  }
  if (HTMLFrame && typeof Node === "function" && typeof Element === "function") for (const [proto, key] of [[Node.prototype, "appendChild"], [Node.prototype, "insertBefore"], [Element.prototype, "append"]]) {
    method(proto, key, original => ({ [key](node) {
      const result = apply(original, this, arguments);
      if (node && (node instanceof HTMLFrame || node.firstElementChild)) shareFetch(node);
      return result;
    } })[key]);
  }
})();
