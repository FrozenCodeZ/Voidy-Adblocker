// "Detect AND suppress the detector": ISOLATED world, document_end, every frame.
//
// Two jobs, kept apart:
//   - SUPPRESS: in every mode except Off and Lite, hide "please disable your ad
//     blocker" walls and give the page its scrolling back.
//   - REPORT: on Auto sites, tell background.js about a wall that stays, so
//     Auto can step up a level.
//
// Some walls (Google "Funding Choices"-style markup, .fc-ab-root) keep their
// words out of the DOM entirely: the text is painted by CSS
// (`::after { content: '...' }`). So .fc-ab-root is a known selector
// (pre-hidden by a stylesheet so it never flashes), and readSheets() finds wall
// phrases inside CSS `content:` rules and hides what they're drawn on.
// findTextMatches() walks every element's text directly, and this runs in
// every frame, not just the top one.
// Stealth itself fakes a filled ad slot in surrogates/adsbygoogle.js; this
// file is the second layer for modes that block the ad script outright.
//
// Signals:
//   "lib:<name>"    a known anti-adblock library is present (from stealth-main.js,
//                   relayed with the handshake secret). Report-only: there's no
//                   element to hide, just a global variable. Weak-ish: it only
//                   never changes Auto; presence does not prove a blocked page.
//   "known-modal"   known anti-adblock wall markup (.fc-ab-root counts on mere
//                   presence — it is only inserted when shown; others must be
//                   visibly on screen, since sites keep them as hidden templates).
//   "css-wall-text" an element a same-origin stylesheet draws ad-block wording
//                   on (via ::before/::after `content:`).
//   "wall-text"     short, currently-visible DOM text naming ad blocking. Fixed
//                   idiomatic phrases (ADBLOCK_WORDS_INTL) count anywhere; the
//                   loose English regex still needs an overlay-shaped box, since
//                   it also matches ordinary articles ABOUT ad blockers.
(() => {
  const M = globalThis.VOIDY;
  if (!M) return;
  // Our own blank ad-slot placeholders (surrogates/adsbygoogle.js) are
  // about:blank frames; nothing to watch in there.
  try { if (window.frameElement && /^aswift_\d+$/.test(window.frameElement.id || "")) return; } catch (e) {}

  let reported = false;        // one Auto-climb report per page load
  let observer = null;
  let level = null;
  let auto = false;
  let canSuppress = false;     // false in Lite (no DOM changes there, same rule cosmetic hiding follows)
  let probing = false, probeHit = null;   // Off mode: one look-only scan when the popup asks
  const suppressed = new WeakSet();   // elements we've already hidden — scan() keeps finding new ones, not just one

  // Three strengths of evidence, used in different places:
  //  - WALL_CTA: phrases that TELL YOU to do something about your ad blocker
  //    ("add us to your whitelist", "disable your ad blocker"). Specific
  //    enough to count anywhere on the page, no shape check needed.
  //  - ADBLOCK_NOUNS: words that merely NAME ad blocking. They appear in
  //    headlines, settings pages and articles, so they only count inside an
  //    overlay-shaped box (shape pass) or a fixed-position CSS-drawn dialog.
  //  - ADBLOCK_TEXT: loose English sentence grammar — overlay-gated, same
  //    reason (it matches ordinary articles ABOUT ad blockers).
  // Deliberately in neither list: "去广告" ("remove ads" — a common VIP upsell
  // button label) and "支持我们" ("support us" — ordinary donate wording).
  const ADBLOCK_TEXT = /\b(ad\s?-?block(er|ers|ing)?|ad-?blocker)\b.*\b(disable|turn off|pause|whitelist|allowlist|detected|using|support us)\b|\b(disable|turn off|pause|whitelist|allowlist)\b.*\bad\s?-?block/i;
  const WALL_CTA = [
    "插件白名单", "加入白名单", "关闭广告拦截", "关闭广告屏蔽", "禁用广告拦截", "关闭广告过滤",   // Chinese
    "広告ブロックを無効", "広告ブロックをオフ",                                              // Japanese
    "광고 차단을 해제", "광고 차단 해제",                                                  // Korean
    "desactiva tu bloqueador", "desactive su bloqueador",                                // Spanish
    "désactivez votre bloqueur", "désactiver votre bloqueur",                            // French
    "adblocker deaktivieren", "werbeblocker deaktivieren",                               // German
    "desative seu bloqueador", "desative o bloqueador",                                  // Portuguese
    "отключите блокировщик",                                                             // Russian
    "nonaktifkan pemblokir iklan",                                                       // Indonesian
  ];
  // "Ads are blocked"-style wording counts only on an overlay, since a
  // blocker's own stats widget can say "12 ads blocked" innocently.
  const ADS_BLOCKED = /\bads?\s+(are\s+|is\s+|were\s+|have\s+been\s+)?blocked\b/i;
  const ADBLOCK_NOUNS = ["广告屏蔽", "广告拦截", "屏蔽广告", "拦截广告", "广告被屏蔽", "广告被拦截", "広告ブロック", "アドブロック", "광고 차단", "애드블록",
    "bloqueador de anuncios", "bloqueador de publicidad", "bloqueur de publicité", "bloqueur de pub", "werbeblocker",
    "bloqueador de anúncios", "блокировщик рекламы", "pemblokir iklan"];
  const has = (list, txt) => { const t = txt.toLowerCase(); return list.some((w) => t.includes(w.toLowerCase())); };
  const hasCTA = (txt) => has(WALL_CTA, txt);
  // English calls-to-action. Articles ABOUT ad blockers use the same words, so
  // these only count inside something pinned over the page (see scan()).
  const WALL_CTA_EN = ["disable your adblocker", "disable your ad blocker", "disable your ad-blocker", "turn off your adblocker",
    "turn off your ad blocker", "pause your adblocker", "pause your ad blocker", "whitelist our site", "whitelist this site",
    "allowlist our site", "allowlist this site", "adblocker detected", "ad blocker detected", "ad-blocker detected",
    "disable adblock", "turn off adblock", "please disable your ad"];
  const textMatches = (txt) => ADBLOCK_TEXT.test(txt) || ADS_BLOCKED.test(txt) || hasCTA(txt) || has(ADBLOCK_NOUNS, txt);   // overlay-gated use only

  // ".fc-ab-root" / ".fc-whitelist-root": Google's "Ad Blocking Recovery"
  // (Funding Choices) dialog — and, found live on bilinovel.com, self-hosted
  // clones that copy its exact markup and class names. ".fc-ab-root" is ONLY
  // the ad-block dialog; Google's GDPR consent dialog uses ".fc-consent-root",
  // which is deliberately not in this list.
  const KNOWN_SELECTORS = ["#babBox", ".babBox", "[id*='fuckadblock']", ".adblock-notice", ".adblock-modal",
    ".adblock-overlay", "#adblock-modal", ".adblocker-root", "#adBlockDetected", ".adblock-detected",
    ".fc-ab-root", ".fc-whitelist-root"];
  // Hidden by a stylesheet the moment config arrives, so a wall inserted
  // later never even flashes. For these, "would it be visible without our
  // stylesheet?" is the detection (checked by briefly disabling the sheet —
  // synchronous, so nothing paints in between). Other known selectors must be
  // visibly on screen, since sites keep them as hidden templates.
  const PREHIDE_LIST = [".fc-ab-root", ".fc-whitelist-root"];
  const PREHIDE = PREHIDE_LIST.join(",");
  let prehideStyle = null;

  function report(signal) {
    if (String(signal).startsWith("lib:")) return;
    if (!auto || reported || level === null) return;
    reported = true;
    try { chrome.runtime.sendMessage({ type: "adblockDetected", host: M.topHost, signal, level }); } catch (e) {}
  }

  // ---- suppression: hide the wall, then undo whatever it locked -------------
  function unlockScroll() {
    try {
      const de = document.documentElement, b = document.body;
      if (!b) return;
      const lockedEl = (el) => { const cs = getComputedStyle(el); return cs.overflowY === "hidden" || cs.overflowY === "clip"; };
      const bcs = getComputedStyle(b);
      const bodyFixed = bcs.position === "fixed";
      if (lockedEl(de) || lockedEl(b) || bodyFixed) {
        for (const el of [de, b]) { el.style.setProperty("overflow", "auto", "important"); el.style.setProperty("overflow-y", "auto", "important"); }
        if (bodyFixed) {
          const top = parseInt(b.style.top || "0", 10);
          b.style.setProperty("position", "static", "important");
          if (top < 0) window.scrollTo(0, -top);
        }
      }
      if (bcs.pointerEvents === "none") b.style.setProperty("pointer-events", "auto", "important");
      for (const el of [de, b]) {
        let f = ""; try { f = getComputedStyle(el).filter; } catch (e) {}
        if (f && f.includes("blur")) el.style.setProperty("filter", "none", "important");
      }
    } catch (e) {}
  }
  // Every box we hid, so scan() can UNDO a wrong call: if a box we hid later
  // fills up with real page content (an app root that was still empty while
  // the page was loading, with only the wall in it), it was never "just the
  // wall" — put it back, and let the next scan find the wall inside it.
  const hiddenBoxes = [];
  const restored = new WeakSet();
  const originalDisplays = new WeakMap();
  function suppressWall(el) {
    originalDisplays.set(el, [el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")]);
    try { el.style.setProperty("display", "none", "important"); hiddenBoxes.push(el); } catch (e) {}
    unlockScroll();
    // The "lock you in place for N seconds" pattern some walls use re-applies
    // the lock on a timer even after their own box is gone, so check back a
    // few times rather than once.
    setTimeout(unlockScroll, 300);
    setTimeout(unlockScroll, 1200);
    setTimeout(unlockScroll, 3000);
  }
  // Many walls (Admiral and others) offer their own way out: "Continue without
  // disabling". Pressing it is the cleanest fix: the site restores its own page.
  // Never presses anything that disables the blocker, allows ads, pays or signs in.
  const CONTINUE_TEXT = /^\s*(continue|proceed|keep reading|read)( to (the )?(site|article|page))?( without (disabling|supporting|whitelisting|allowlisting|turning (it )?off|changing))?( anyway)?\s*[.!→>»]?\s*$|^\s*(continue|proceed) (anyway|without).{0,30}$|^\s*(no,? thanks|not now|maybe later|i understand|dismiss)\s*[.!]?\s*$/i;
  const NEVER_PRESS = /(disable (my|your|the)|turn off|pause|whitelist|allowlist|allow ads|subscribe|sign ?in|log ?in|register|buy|pay|donate|accept|agree)/i;
  const pressed = new WeakSet();
  function pressContinue(el) {
    for (let box = el, up = 0; box && box !== document.documentElement && up < 6; box = box.parentElement, up++) {
      let buttons = [];
      try { buttons = box.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'); } catch (e) {}
      for (const b of buttons) {
        const t = ((b.tagName === "INPUT" ? b.value : b.innerText) || "").replace(/\s+/g, " ").trim();
        if (!t || t.length > 60 || !CONTINUE_TEXT.test(t) || NEVER_PRESS.test(t) || pressed.has(b)) continue;
        const r = b.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (b.tagName === "A" && b.href && !/^(javascript:|#)/i.test(b.getAttribute("href") || "#") && new URL(b.href, location.href).origin !== location.origin) continue;
        pressed.add(b);
        try { b.click(); } catch (e) { continue; }
        setTimeout(unlockScroll, 300);
        return true;
      }
      if (box === document.body) break;
    }
    return false;
  }

  function handle(el, signal) {
    if (!el || el === document.body || el === document.documentElement || suppressed.has(el)) return;
    if (probing) { probeHit = probeHit || signal; return; }   // Off-mode look-only check: touch nothing
    if (canSuppress && pressContinue(el)) { suppressed.add(el); return; }   // the wall let us through
    suppressed.add(el);
    if (canSuppress) suppressWall(el);
    if (auto) setTimeout(() => {
      if (!el.isConnected || restored.has(el) || reported) return;
      // Check the page's own visibility without painting the wall. A transient
      // verdict removed by the site cannot drive another reload/climb.
      const current = [el.style.getPropertyValue("display"), el.style.getPropertyPriority("display")];
      const before = originalDisplays.get(el) || current;
      let stillVisible = false;
      try {
        if (prehideStyle) prehideStyle.disabled = true;
        if (before[0]) el.style.setProperty("display", before[0], before[1]); else el.style.removeProperty("display");
        stillVisible = visible(el);
      } finally {
        if (current[0]) el.style.setProperty("display", current[0], current[1]); else el.style.removeProperty("display");
        if (prehideStyle) prehideStyle.disabled = false;
      }
      if (stillVisible) report("confirmed:" + signal);
    }, 2000);
  }

  function visible(el) {
    try {
      if (typeof el.checkVisibility === "function")
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true });
      return el.getClientRects().length > 0;
    } catch (e) { return false; }
  }
  function overlayish(el) {
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) return false;
      if (cs.position !== "fixed" && cs.position !== "absolute" && cs.position !== "sticky") return false;
      const r = el.getBoundingClientRect();
      const z = parseInt(cs.zIndex, 10) || 0;
      return r.width * r.height > 0.2 * innerWidth * innerHeight || z >= 1000;
    } catch (e) { return false; }
  }

  // There is deliberately no "big, empty, fixed box" signal: that is exactly
  // what the dim backdrop behind any ordinary pop-up looks like, and it would
  // make Auto climb for a newsletter box. Google's ad-block dialog is a
  // normal-DOM ".fc-ab-root", caught by name in KNOWN_SELECTORS.

  // Text inside a shadow root is invisible to innerText/textContent of its
  // host. Extensions can read even CLOSED roots (chrome.dom), so a wall that
  // hides its wording there is judged by what it actually SAYS, not by shape.
  function shadowText(host) {
    let out = "";
    try {
      const nodes = [host, ...host.querySelectorAll("*")].slice(0, 200);
      for (const n of nodes) {
        let root = n.shadowRoot;
        if (!root && chrome.dom && chrome.dom.openOrClosedShadowRoot) root = chrome.dom.openOrClosedShadowRoot(n);
        // rendered text only: a shadow root's own <style> would otherwise add
        // kilobytes of CSS and push it past the "too long to be a wall" cap
        if (root) for (const c of root.children) if (c.tagName !== "STYLE" && c.tagName !== "SCRIPT") out += " " + (c.innerText || "");
        if (out.length > 1000) break;
      }
    } catch (e) {}
    return out;
  }

  // ---- which box is "the wall"? ----------------------------------------------
  // From the element that carries the wall's words, find the box to hide:
  //  1. an overlay layer: the OUTERMOST position:fixed (or high-z absolute)
  //     ancestor that is still just the wall (short text, at most a logo's
  //     worth of media) — plus any zero-size wrappers around it (a wall's
  //     outer divs often have no box of their own because everything inside
  //     them is position:fixed, e.g. .fc-ab-root);
  //  2. otherwise, an in-flow wall: climb while the ancestor holds nothing but
  //     the wall (short text, <=3 media, <=6 children).
  // Never <body>/<html>, never anything holding real page text or a gallery,
  // and a wrong call is undone later if the box fills up (see hiddenBoxes).
  const shortText = (e) => (e.textContent || "").replace(/\s+/g, "").length <= 300;
  const mediaCount = (e) => { try { return e.querySelectorAll("img,video,canvas,iframe,svg,picture").length; } catch (x) { return 99; } };
  function fixedLike(e) {
    try {
      const cs = getComputedStyle(e);
      return cs.position === "fixed" || cs.position === "sticky" || (cs.position === "absolute" && (parseInt(cs.zIndex, 10) || 0) >= 100);
    } catch (x) { return false; }
  }
  function wallContainer(el) {
    const chain = [];
    for (let p = el; p && p !== document.body && p !== document.documentElement; p = p.parentElement) chain.push(p);
    if (!chain.length) return null;
    let top = null;
    for (const p of chain) {
      if (!shortText(p) || mediaCount(p) > 3) break;
      if (fixedLike(p)) top = p;
    }
    if (top) {
      for (let p = top.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        const r = p.getBoundingClientRect();
        if ((r.width > 0 && r.height > 0) || !shortText(p) || mediaCount(p) > 3) break;
        top = p;
      }
      return top;
    }
    let box = chain[0];
    for (const p of chain.slice(1)) {
      if (!shortText(p) || mediaCount(p) > 3 || p.children.length > 6) break;
      box = p;
    }
    return box;
  }
  const hasFixedAncestor = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) if (fixedLike(p)) return true; return false; };

  // ---- CTA text anywhere in the DOM ------------------------------------------
  // Walks TEXT NODES (not elements): skips <script>/<style>/<noscript>/
  // <template>, finds the innermost element carrying the words, and has no
  // "first N elements" cap that a wall appended at the end of a long page
  // could fall past. Cheap textContent filter first; innerText (rendered text
  // only — excludes script/style and hidden content) confirms the rare hit.
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "TITLE", "OPTION"]);
  // One walk checks both phrase lists (the English one needs an overlay, see
  // scan()). `root` lets a page change be checked without rereading the page.
  // One combined pattern: almost no text on a page matches, and one pattern
  // test per text is far cheaper than ~40 separate searches.
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ANY_CTA = new RegExp([...WALL_CTA, ...WALL_CTA_EN].map(esc).join("|"), "i");
  function kindOf(txt) {
    if (!ANY_CTA.test(txt)) return null;
    const t = txt.toLowerCase();
    return WALL_CTA.some((w) => t.includes(w.toLowerCase())) ? "cta" : "en";
  }
  function findTextMatches(root = document.body) {
    const hits = [];
    if (!root) return hits;
    const seen = new Set();
    try {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n = 0;
      for (let t = tw.nextNode(); t && n < 30000 && hits.length < 8; t = tw.nextNode(), n++) {
        const v = t.nodeValue;
        if (!v || v.length < 4) continue;
        const p = t.parentElement;
        if (!p || seen.has(p) || SKIP_TAGS.has(p.tagName)) continue;
        seen.add(p);
        // the phrase may be split across inline tags (请加入<b>白名单</b>), so
        // judge the text's element and, if still short, one level up
        for (const el of [p, p.parentElement]) {
          if (!el || el === document.body || el === document.documentElement || suppressed.has(el)) break;
          const raw = el.textContent || "";
          if (raw.length > 900) break;
          const kind = kindOf(raw);
          if (!kind) continue;
          const rendered = (el.innerText || "").replace(/\s+/g, " ").trim();
          if (rendered.length > 0 && rendered.length <= 300 && kindOf(rendered)) { hits.push({ el, kind }); break; }
        }
      }
    } catch (e) {}
    return hits;
  }

  // ---- wall text drawn by CSS, not in the DOM ------------------------------
  // bilinovel.com's wall has EMPTY headline/body <div>s; its text is painted
  // by its stylesheet: `.fc-dialog-headline::after { content: '呜呜～是广告屏蔽器‼' }`.
  // No DOM text search can ever see that. So read the page's own stylesheets:
  // a rule whose `content:` carries ad-block wording names, in its selector,
  // the element the wall is drawn on. Cross-origin sheets can't be read and
  // are skipped. Nested style rules are skipped too: their selectorText is
  // relative ("& .title") and, run at top level, would match every .title on
  // the page. @media/@supports/@layer and same-origin @import are followed.
  const sheetsSeen = new WeakSet();
  const cssWall = [];          // { sel, strong }
  function readSheets() {
    let sheets = [];
    try { sheets = Array.from(document.styleSheets); } catch (e) { return; }
    const walk = (list, depth) => {
      for (const r of list) {
        if (r.styleSheet) { try { if (r.styleSheet.cssRules) walk(r.styleSheet.cssRules, depth + 1); } catch (e) {} continue; }   // @import
        const c = r.style && r.style.content;
        if (c && c !== "none" && c !== "normal" && c.length >= 4) {
          const strong = ADBLOCK_TEXT.test(c) || hasCTA(c);
          if (strong || has(ADBLOCK_NOUNS, c)) {
            const sel = (r.selectorText || "").replace(/::?(before|after)\b/g, "").trim();
            if (sel && !sel.includes("&")) cssWall.push({ sel, strong });
          }
        }
        const isStyleRule = typeof CSSStyleRule !== "undefined" && r instanceof CSSStyleRule;
        if (!isStyleRule && r.cssRules && r.cssRules.length && depth < 4) walk(r.cssRules, depth + 1);
      }
    };
    for (const sh of sheets) {
      if (sheetsSeen.has(sh)) continue;
      let rules;
      try { rules = sh.cssRules; } catch (e) {
        // Only give up for good on a genuinely cross-origin sheet; a same-
        // origin one that's still loading also throws here, and must be
        // retried — bilinovel's wall stylesheet is inserted at the very
        // moment the wall appears, which is exactly that case.
        let cross = true;
        try { cross = !!sh.href && new URL(sh.href, location.href).origin !== location.origin; } catch (e2) {}
        if (cross) sheetsSeen.add(sh);
        continue;
      }
      if (!rules) continue;                                                       // not loaded yet: retry next scan
      sheetsSeen.add(sh);
      try { walk(rules, 0); } catch (e) {}
    }
  }

  function wouldShow(el) {
    if (!prehideStyle) return visible(el);
    try { prehideStyle.disabled = true; return visible(el); }
    finally { try { prehideStyle.disabled = false; } catch (e) {} }
  }

  // This does NOT stop at the first match: a wall we've already
  // suppressed is skipped (via `suppressed`), so later scans keep looking for
  // a NEW one — some sites re-inject on a timer after the first is removed.
  const CANDIDATES = 'body > div, body > section, body > aside, html > div, html > section, [role="dialog"], [aria-modal="true"]';
  function scan(roots) {
    const part = Array.isArray(roots);
    const within = (sel, limit) => {            // matching elements in the whole page, or just in the changed parts
      if (!part) { try { return Array.from(document.querySelectorAll(sel)).slice(0, limit); } catch (e) { return []; } }
      const out = [];
      for (const r of roots) { try { if (r.matches(sel)) out.push(r); out.push(...r.querySelectorAll(sel)); } catch (e) {} if (out.length >= limit) break; }
      return out.slice(0, limit);
    };
    // Undo any wrong call first (see hiddenBoxes).
    for (const el of hiddenBoxes) {
      if (restored.has(el)) continue;
      if ((el.textContent || "").replace(/\s+/g, "").length > 800 || mediaCount(el) > 6) {
        try { el.style.removeProperty("display"); } catch (e) {}
        restored.add(el);
      }
    }

    // Known wall markup.
    for (const sel of KNOWN_SELECTORS) {
      const els = within(sel, 50);
      const prehidden = PREHIDE_LIST.includes(sel);
      for (const el of els) if (!suppressed.has(el) && (prehidden ? wouldShow(el) : overlayish(el))) handle(el, "known-modal");
    }

    // Wall wording drawn by the page's CSS (full scans only: style sheets rarely change).
    if (!part) readSheets();
    if (!part) for (const { sel, strong } of cssWall) {
      let els = [];
      try { els = document.querySelectorAll(sel); } catch (e) {}
      for (const el of els) {
        if (!visible(el)) continue;                          // a hidden template isn't a wall on screen
        if (!strong && !hasFixedAncestor(el)) continue;      // a bare noun needs an overlay around it
        const box = wallContainer(el);
        if (box && !suppressed.has(box)) handle(box, "css-wall-text");
      }
    }

    // Calls-to-action anywhere in the DOM, no shape assumptions.
    for (const root of part ? roots : [document.body]) {
      for (const { el, kind } of findTextMatches(root)) {
        if (!visible(el) || (kind === "en" && !hasFixedAncestor(el))) continue;   // English wording needs an overlay
        const box = wallContainer(el);
        if (box && !suppressed.has(box)) handle(box, "wall-text");
      }
    }

    // Shape-based pass: weaker wording (nouns, loose English grammar) only
    // counts inside an overlay-shaped box, because the same words also appear
    // in headlines and in ordinary articles ABOUT ad blockers.
    for (const el of within(CANDIDATES, 80)) {
      if (suppressed.has(el) || !overlayish(el)) continue;
      const txt = ((el.innerText || "") + " " + shadowText(el)).replace(/\s+/g, " ").trim();
      if (txt.length > 800) continue;                          // a wall is short; a page wrapper isn't
      if (txt.length === 0) continue;                          // no text = no evidence (see silent-overlay note above)
      if (textMatches(txt)) handle(el, "wall-text");
    }

    // Overlay IFRAMES the page built itself (about:blank / same-origin): their
    // words live in the iframe's own document, invisible to every pass above.
    // Some "Ads are blocked" boxes are exactly this: a fixed, high z-index
    // about:blank iframe filled via document.write. Same overlay
    // gating as the shape pass; cross-origin frames can't be read and are
    // skipped (a real ad iframe is cross-origin, so it never lands here).
    for (const f of within("iframe", 40)) checkFrame(f);
  }
  function checkFrame(f) {
    if (suppressed.has(f) || !overlayishFrame(f)) return;
    let txt = "";
    try { const d = f.contentDocument; txt = d && d.body ? (d.body.innerText || "") : ""; } catch (e) { return; }
    txt = txt.replace(/\s+/g, " ").trim();
    if (txt.length > 0 && txt.length <= 400 && textMatches(txt)) handle(f, "wall-text");
  }
  // An iframe used as a pop-up: fixed (or high-z absolute) and on top. Size is
  // NOT required: such boxes can be small, far below overlayish()'s 20% bar.
  function overlayishFrame(f) {
    try {
      const cs = getComputedStyle(f);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const z = parseInt(cs.zIndex, 10) || 0;
      return cs.position === "fixed" || (cs.position === "absolute" && z >= 1000);
    } catch (e) { return false; }
  }

  M.config.then((cfg) => {
    if (!cfg || cfg.level === "off") {
      // Off: genuinely untouched: nothing runs, nothing is watched. The one
      // exception is a single look-only scan, top frame only, run only when
      // you open the popup on this tab: "is an ad-block wall on screen right
      // now?" If one is, with Voidy off here, something ELSE is blocking this
      // site's ads (for example a DNS filter on the home network), and the
      // popup says so instead of leaving you to think "Off" is broken.
      if (cfg && window === top) {
        chrome.runtime.onMessage.addListener((m, sender, send) => {
          if (!m || m.type !== "voidyWallCheck" || sender.id !== chrome.runtime.id) return;
          probing = true; probeHit = null;
          try { scan(); } catch (e) {}
          probing = false;
          send({ wall: !!probeHit, signal: probeHit });
        });
      }
      return;
    }
    level = cfg.level;
    auto = !!cfg.auto;
    canSuppress = cfg.level !== "lite";            // Lite: network blocking only, no DOM changes — same rule cosmetic hiding follows
    M.onDetected = (sig) => report(sig);           // lib:<name> signals from stealth-main.js — Auto-only by that file's own gating
    for (const s of M.pendingDetected || []) report(s);
    if (canSuppress) {
      try {
        const st = document.createElement("style");
        st.textContent = PREHIDE + "{display:none!important}";
        (document.head || document.documentElement).appendChild(st);
        prehideStyle = st;
      } catch (e) {}
    }
    scan();
    try {
      // A THROTTLE, not a debounce: "wait until the page has been quiet"
      // keeps getting pushed back on busy pages (a gallery lazy-loading
      // images changes the page non-stop). A scan runs at most 300 ms after
      // the first change of a burst (1 s on pages where a scan is slow).
      // And an overlay IFRAME is
      // checked the moment it's inserted: this callback runs before the
      // browser paints, and a document.write()-filled box already has its
      // words by then — so it's hidden before it's ever drawn.
      // Page changes are checked by looking only at what was ADDED, which is
      // much cheaper than rereading the whole page. Too many additions at
      // once: full scan.
      let t = null, gap = 300;
      const added = new Set();
      observer = new MutationObserver((muts) => {
        try {
          for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.localName === "iframe") checkFrame(n);
            if (added.size <= 150) added.add(n);
          }
        } catch (e) {}
        if (!t && added.size) t = setTimeout(() => {
          t = null;
          const roots = added.size > 150 ? null : [...added].filter((n) => n.isConnected && !added.has(n.parentElement));
          added.clear();
          const t0 = performance.now(); scan(roots || undefined);
          gap = performance.now() - t0 > 25 ? 1000 : 300;   // a heavy page gets fewer scans
        }, gap);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      // Kept alive well past the first seconds: a wall that only shows up after the
      // site's own delayed detection check (the "few seconds later" pattern
      // reported against Stealth) can appear well after initial load.
      setTimeout(() => { if (observer) observer.disconnect(); }, 60000);
      // Full re-checks at spaced moments, for walls that appear by being
      // un-hidden (no new elements) or from a style sheet.
      for (const sec of [1.5, 3, 5, 8, 12, 17, 23, 30, 40, 50, 60]) setTimeout(() => { if (!document.hidden) scan(); }, sec * 1000);
    } catch (e) {}
  });
})();
