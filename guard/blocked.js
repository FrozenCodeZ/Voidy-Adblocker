// Warning page shown instead of a site on the security (malware / phishing)
// list. The background redirects such top-level navigations here, with the
// original address after the "#".
//
// Safety: this page is web-accessible (the redirect needs that), so a web page
// could try to embed it and trick a click on "Continue anyway". It therefore
// does nothing at all when framed, only reacts to real (isTrusted) clicks, and
// the background double-checks the request came from this page in a real,
// top-level tab before allowing anything.
(() => {
  const $ = (i) => document.getElementById(i);
  if (window.top !== window) {                       // framed: refuse to be a button someone else can press
    $("back").hidden = true; $("go").hidden = true; $("fine").hidden = true; $("framed").hidden = false;
    return;
  }
  const raw = location.hash.slice(1);             // already a valid URL; decoding would corrupt %2F etc.
  let u = null;
  try { u = new URL(raw); } catch (e) {}
  const ok = u && (u.protocol === "http:" || u.protocol === "https:");
  $("site").textContent = ok ? u.hostname : "an unknown address";
  // Look-alike warning (?kind=lookalike). Any website can open this page with
  // any address after it, so the brand and the reason are worked out HERE from
  // the site's own address, never taken from the link: otherwise a scam page
  // could make Voidy's warning say "Go to the real <its own domain>".
  const q = new URLSearchParams(location.search);
  const hit = ok && q.get("kind") === "lookalike" && globalThis.VOIDY_LOOKALIKE ? VOIDY_LOOKALIKE.check(u.hostname) : null;
  const lookalike = !!hit, brand = hit ? hit.brand : "";
  if (lookalike) {
    document.title = "Warning: look-alike site";
    $("title").textContent = "This site may be pretending to be " + brand;
    $("text").textContent = "Its address " + String(hit.why || "looks like " + brand).slice(0, 60) +
      ". Scam sites copy the names of well-known companies to steal passwords and payment details.";
    const real = $("real"); real.hidden = false; real.textContent = "Go to the real " + brand; real.href = "https://" + brand + "/";
    $("fine").textContent = "Voidy checks addresses on your computer and can be wrong. \u201cContinue anyway\u201d remembers this site.";
  }
  $("url").textContent = ok ? u.href : "";
  if (!ok) $("go").hidden = true;
  // Armed a moment after the page is actually visible, so a click (or the
  // second half of a double-click) aimed at whatever was here before can't land on it.
  $("go").disabled = true;
  const arm = () => setTimeout(() => { $("go").disabled = false; }, 1000);
  if (document.visibilityState === "visible") arm();
  else document.addEventListener("visibilitychange", function once() { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", once); arm(); } });

  $("back").addEventListener("click", async (e) => {
    if (!e.isTrusted) return;
    if (history.length > 1) { history.back(); return; }
    try { const t = await chrome.tabs.getCurrent(); if (t) { chrome.tabs.remove(t.id); return; } } catch (err) {}
    location.replace("about:blank");
  });
  $("go").addEventListener("click", (e) => {
    if (!e.isTrusted || !ok) return;
    $("go").disabled = true;
    chrome.runtime.sendMessage({ type: lookalike ? "proceedLookalike" : "proceedMalware", url: u.href }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok) { $("go").hidden = true; return; }   // refused: not a listed site
      location.replace(u.href);
    });
  });
})();
