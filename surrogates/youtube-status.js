// YouTube's script availability handshake, implemented locally. No network,
// ad scheduling, impressions or media are produced by this response.
// Public protocol observed at static.doubleclick.net/instream/ad_status.js.
try { Reflect.set(globalThis, "google_ad_status", 1); } catch (_) {}
