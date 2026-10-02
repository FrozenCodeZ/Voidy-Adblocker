// The Redirect Guard prompt, running in the extension origin (chrome-extension://).
// The page can't reach into this document, fake a click here, or forge its
// messages. Only a real (isTrusted) click on "Go there" allows. No answer
// before the countdown ends = Stay.
//
// Its job is to let a person decide sensibly: WHAT happened, WHERE it goes (site
// + full address), and any WARNING SIGNS, in plain words.
//
// Trust ("always allow this site -> that site") is saved from HERE, directly to
// the background. The "from" site comes from location.ancestorOrigins, which the
// browser fills in and the page cannot fake.
//
// Clickjacking: any page can embed this frame, make it invisible and slide it
// under the user's clicks. So the buttons and the trust box only work once the
// prompt has been on screen, uncovered and unchanged by the page, for ARM_MS
// (Chrome's visibility tracking reports covered, faded or transformed frames).
// Where that tracking doesn't exist, the pause alone still applies.
(() => {
  const params = new URLSearchParams(location.hash.slice(1));
  const id = params.get("id");
  const kind = params.get("kind") || "Redirect";          // Redirect | Pop-up | Overlay | Protocol
  const rawUrl = params.get("url") || "";
  const timeout = Math.max(5000, parseInt(params.get("timeout"), 10) || 20000);
  const $ = (i) => document.getElementById(i);
  let shownAt = 0, visibleSince = 0, tracked = false;   // see "only clicks on a prompt the person can actually see"
  const R = self.VOIDY_PSL.registrable;

  let u = null;
  try { u = new URL(rawUrl); } catch (e) {}
  const destHost = u ? u.hostname.toLowerCase() : (params.get("host") || "").toLowerCase();
  const destSite = destHost ? R(destHost) : "";

  let parentHost = "";
  try { const ao = location.ancestorOrigins; if (ao && ao.length) parentHost = new URL(ao[0]).hostname; } catch (e) {}

  // ---- what happened ------------------------------------------------------
  const TEXT = {
    "Redirect": ["This page tried to send you somewhere else", "You didn't click a link. The page's own code tried to do this."],
    "Pop-up":   ["This page tried to open a new tab", "Pages often do this to show ads. It wasn't opened."],
    "Overlay":  ["That click hit an invisible link", "An invisible link was covering the page, a common ad trick. It wasn't followed."],
    "Protocol": ["This page tried to open an app on your computer", "Links like this can launch programs. Only allow it if you expected an app to open."]
  };
  const isProtocol = u && u.protocol !== "http:" && u.protocol !== "https:";
  const [title, why] = TEXT[isProtocol ? "Protocol" : kind] || TEXT.Redirect;
  $("title").textContent = title;
  $("why").textContent = why;

  // ---- where it goes --------------------------------------------------------
  const site = $("site");
  site.textContent = "";
  if (isProtocol) {
    site.textContent = u.protocol.replace(":", "") + " app";
  } else if (destHost) {
    const sub = destHost.endsWith(destSite) ? destHost.slice(0, destHost.length - destSite.length) : "";
    if (sub) { const s = document.createElement("span"); s.className = "sub"; s.textContent = sub; site.append(s); }
    site.append(document.createTextNode(destSite || destHost));
  } else {
    site.textContent = "an unknown address";
  }
  const urlEl = $("url");
  urlEl.textContent = rawUrl || "(no address given)";
  requestAnimationFrame(() => { if (urlEl.scrollHeight > urlEl.clientHeight + 2) $("more").hidden = false; sendSize(); });
  $("more").addEventListener("click", () => { urlEl.classList.add("open"); $("more").hidden = true; sendSize(); });
  $("copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(rawUrl); $("copy").textContent = "Copied"; }
    catch (e) { const r = document.createRange(); r.selectNodeContents(urlEl); getSelection().removeAllRanges(); getSelection().addRange(r); $("copy").textContent = "Selected. Press Ctrl+C to copy."; }
  });
  if (parentHost) {
    $("from").append("You're on ");
    const b = document.createElement("b"); b.textContent = R(parentHost); $("from").append(b);
    if (destSite && destSite !== R(parentHost) && !isProtocol) $("from").append(". This is a different site.");
  }

  // ---- warning signs --------------------------------------------------------
  const SHORTENERS = ["bit.ly","t.co","tinyurl.com","goo.gl","ow.ly","is.gd","buff.ly","rebrand.ly","cutt.ly","shorturl.at",
    "rb.gy","tiny.cc","lnkd.in","s.id","t.ly","bl.ink","adf.ly","shorte.st","ouo.io","linkvertise.com","bitly.com","v.gd"];
  const ADNETS = ["doubleclick.net","googlesyndication.com","googleadservices.com","taboola.com","outbrain.com","adnxs.com",
    "popads.net","propellerads.com","adcash.com","exoclick.com","adsterra.com","clickadu.com","popcash.net","hilltopads.net","admaven.com"];
  const RISKY_FILES = /\.(exe|msi|scr|bat|cmd|com|ps1|vbs|js|jar|apk|dmg|pkg|iso|zip|rar|7z)(\?|#|$)/i;
  const inList = (h, list) => list.some((x) => h === x || h.endsWith("." + x));
  const sig = [];
  if (u && !isProtocol) {
    if (u.protocol === "https:") sig.push(["good", "Secure connection (https)."]);
    else sig.push(["warn", "Not encrypted (http). Anyone on your network could see or change this page."]);
    if (inList(destHost, ADNETS)) sig.push(["bad", "This is an advertising network, not a real destination."]);
    if (inList(destHost, SHORTENERS)) sig.push(["warn", "Link shortener: the real destination is hidden until you go."]);
    if (RISKY_FILES.test(u.pathname)) sig.push(["bad", "This would download a file (" + u.pathname.split(".").pop().toLowerCase() + "). Only allow if you meant to download it."]);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(destHost) || destHost.includes(":")) sig.push(["warn", "Goes to a bare number address, not a named website."]);
    if (destHost.split(".").some((p) => p.startsWith("xn--"))) sig.push(["bad", "The name uses look-alike characters. It may be imitating another site."]);
    if (/(^|[.-])(login|signin|verify|secure|account|update|wallet)[.-]/.test(destHost) && destSite !== R(parentHost))
      sig.push(["warn", "The address uses words like \"login\" or \"verify\". Be careful about typing passwords there."]);
  } else if (isProtocol) {
    sig.push(["warn", "Opens: " + u.protocol.replace(":", "") + " (a program on your computer, not a website)."]);
  }
  function renderSignals() {
    $("signals").textContent = "";
    for (const [lvl, text] of sig) {
      const li = document.createElement("li"); li.className = lvl;
      const d = document.createElement("span"); d.className = "dot";
      const t = document.createElement("span"); t.textContent = text;
      li.append(d, t); $("signals").append(li);
    }
    // One-glance verdict: the worst warning sign decides the colour of the whole box.
    // "No red flags found", not "Looks normal": the checks can only ever find
    // known problems; an unknown site passing them isn't evidence it's fine.
    const risk = sig.some((x) => x[0] === "bad") ? "bad" : sig.some((x) => x[0] === "warn") ? "warn" : "good";
    $("box").dataset.risk = risk;
    $("verdict").textContent = { good: "No red flags found", warn: "Be careful", bad: "Likely a trick" }[risk];
    $("verdict").hidden = false;
    try { sendSize(); } catch (e) {}   // first call runs before `post` below exists; it re-sends then
  }
  renderSignals();
  // Look the destination up in our own block lists (tens of thousands of ad and
  // malware domains), not just the few dozen names built into this file.
  // With "block ad-network jumps without asking" on, the prompt stays invisible
  // until that lookup answers: a listed ad server is then declined silently
  // (the page script only knows ~25 ad networks; the lists know ~49,000).
  // Anything else — or no answer within 400 ms — shows the prompt as usual.
  const quietAds = params.get("quietAds") === "1";
  let revealed = false;
  // The page's guard keeps our iframe itself hidden too (so not even its
  // shadow shows); "voidy-guard-show" asks it to reveal us.
  const reveal = () => { if (revealed) return; revealed = true; document.documentElement.style.visibility = ""; shownAt = performance.now();
    try { sendSize(); post({ type: "voidy-guard-show" }); } catch (e) {} };
  if (!(u && !isProtocol && destHost && quietAds)) setTimeout(reveal, 0);          // nothing to wait for
  if (u && !isProtocol && destHost) {
    if (quietAds) { document.documentElement.style.visibility = "hidden"; setTimeout(reveal, 400); }
    try {
      chrome.runtime.sendMessage({ type: "guardCheck", host: destHost }, (r) => {
        if (chrome.runtime.lastError || !r) { reveal(); return; }
        if (r.ads && !r.malware && quietAds && !revealed) { result("deny", true); return; }   // ad server: no prompt at all
        if (r.malware) sig.unshift(["bad", "This site is on our malware / phishing block list."]);
        else if (r.ads && !inList(destHost, ADNETS)) sig.unshift(["bad", "This is an ad or tracking server on our block lists, not a real destination."]);
        if (r.malware || r.ads) renderSignals();
        reveal();
      });
    } catch (e) { reveal(); }
  }

  // ---- trust ------------------------------------------------------------------
  // The exact destination host: "always allow" for docs.github.io must not
  // cover every other site on github.io.
  const pair = parentHost && destHost && !isProtocol ? R(parentHost) + ">" + destHost : "";
  if (!pair) $("trustrow").hidden = true;
  else $("trustlabel").textContent = "Always allow " + R(parentHost) + " → " + destHost;

  // ---- only clicks on a prompt the person can actually see count ---------------
  const ARM_MS = 600;
  try {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!("isVisible" in en)) continue;
        tracked = true;
        visibleSince = en.isVisible ? (visibleSince || performance.now()) : 0;
      }
    }, { trackVisibility: true, delay: 100, threshold: [0, 1] });
    io.observe($("box"));
  } catch (e) {}
  function seen() {
    const now = performance.now();
    if (!shownAt || now - shownAt < ARM_MS) return false;
    return !tracked || (visibleSince > 0 && now - visibleSince >= ARM_MS);
  }
  function refuse() {
    let n = $("covered");
    if (!n) { n = document.createElement("div"); n.id = "covered"; n.className = "covered"; $("box").append(n); }
    n.textContent = "Voidy ignored that click: the prompt had only just appeared, or something on the page was covering it.";
    sendSize();
  }

  // ---- talk to the page's guard --------------------------------------------------
  const post = (m) => { try { parent.postMessage({ ...m, id }, "*"); } catch (e) {} };
  function sendSize() { post({ type: "voidy-guard-size", h: Math.ceil($("box").getBoundingClientRect().height) + 2 }); }
  post({ type: "voidy-guard-ready" });
  sendSize();
  try { new ResizeObserver(sendSize).observe($("box")); } catch (e) {}   // keep the frame fitted (fonts, "show full address")

  let done = false;
  function result(action, silent) {
    if (done) return; done = true;
    clearInterval(timer);
    if (action === "allow" && pair && $("trust").checked) {
      try { chrome.runtime.sendMessage({ type: "saveTrustPair", pair }); } catch (e) {}
    }
    post({ type: "voidy-guard-result", action, silent: !!silent, url: rawUrl });   // silent = declined without ever being shown; url = what was shown
  }
  $("allow").addEventListener("click", (e) => { if (!e.isTrusted) return; if (seen()) result("allow"); else refuse(); });
  $("trust").addEventListener("click", (e) => { if (!e.isTrusted || !seen()) { e.preventDefault(); refuse(); } });
  $("stay").addEventListener("click", (e) => { if (e.isTrusted) result("deny"); });
  addEventListener("keydown", (e) => { if (e.isTrusted && e.key === "Escape") result("deny"); });

  let left = Math.round(timeout / 1000);
  const tick = () => { $("stay").textContent = "Stay here (" + left + ")"; };
  tick();
  const timer = setInterval(() => { left--; tick(); if (left <= 0) result("deny"); }, 1000);
})();
