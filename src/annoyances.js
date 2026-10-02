// Cosmetic + annoyance engine — ISOLATED world, document_start, all frames.
//
// 1) LIST HIDING. The page's class/id names are collected as it builds and sent
//    to the background, which answers with only the EasyList / Fanboy selectors
//    that could match THIS page (plus site-specific ones). Each selector becomes
//    its own CSS rule, so one bad selector can never disable the rest.
//      - "ads" category: only in Full (in stealth, hiding bait would give us away)
//      - cookies / newsletter / notifications / chat / annoyances / social:
//        every mode except Lite and Off, unless the site's widget switch is off
// 2) COOKIE BANNERS. In "reject" mode we click the site's OWN Reject/Decline
//    button (known consent platforms first, then a strict text match inside a
//    cookie banner). We never click anything that says accept/agree/allow.
// 3) NEWSLETTER / SIGN-UP POP-UPS the lists miss: a page-covering dialog with an
//    email field and sign-up wording that appeared WITHOUT you clicking anything.
//    Login dialogs (password field) and things you just opened are left alone.
// 4) SCROLL RESCUE. If we removed a pop-up and the page is still frozen
//    (scroll locked / blurred) with nothing visible covering it, un-freeze it.
(() => {
  const M = globalThis.VOIDY;
  if (!M || M.annoyStarted) return;
  M.annoyStarted = true;

  // Heavy checks (anything that reads computed styles forces the browser to
  // recompute the whole page's styles) wait until the page has parsed, then run
  // in idle time, so they don't slow down loading.
  const idle = (fn) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 50));
  let parsed = document.readyState !== "loading";
  let enabled = null;          // null until config arrives
  let cfg = null;
  let annoyActivity = false;   // did we remove any annoyance on this page?
  let extraAnnoy = 0;          // heuristic hides + suppressed prompts (not CSS-matched)

  // ---------------------------------------------------------------- style
  let styleEl = null;
  const cssText = [];
  const catSelectors = {};
  const P = globalThis.VOIDY_PROC;
  if (P) P.onChange(() => scheduleCount());
  const injected = new Set();
  function ensureStyle() {
    if (styleEl && styleEl.isConnected) return styleEl;
    styleEl = document.createElement("style");
    styleEl.textContent = cssText.join("\n");
    (document.head || document.documentElement).appendChild(styleEl);
    return styleEl;
  }
  function isPlainHideRule(r) {
    return !!r && r.type === 1 && r.style.length === 1 && r.style.getPropertyValue("display") === "none" &&
      r.style.getPropertyPriority("display") === "important" && !(r.cssRules && r.cssRules.length);
  }
  function addRules(rules) {
    if (!rules || !rules.length) return;
    const el = ensureStyle();
    const sheet = el.sheet;
    let added = 0;
    for (const [cat, sel] of rules) {
      if (injected.has(sel)) continue;
      injected.add(sel);
      if (P && P.isProcedural(sel)) { if (P.add(cat, sel)) added++; continue; }   // text-matching rules: src/procedural.js
      const rule = sel + "{display:none!important}";
      // Each rule must come out as exactly one "hide this" rule. A selector from
      // a list (or a backup file) that smuggles in its own CSS ("x{background:url(...);")
      // would parse into something else: it is taken out again and skipped.
      if (!sheet) continue;
      try {
        const at = sheet.insertRule(rule, sheet.cssRules.length), r = sheet.cssRules[at];
        if (!isPlainHideRule(r)) { sheet.deleteRule(at); continue; }
      } catch (e) { continue; }                          // invalid selector: skip only it
      cssText.push(rule);
      (catSelectors[cat] = catSelectors[cat] || []).push(sel);
      added++;
    }
    if (added) scheduleCount();
  }

  // ---------------------------------------------------------------- tokens
  const seen = new Set();
  const queue = new Set();
  let tokenTimer = null;
  function addToken(t) { if (!seen.has(t)) { seen.add(t); queue.add(t); } }   // each name sent once per page
  const WS = /\s+/;
  function collect(el) {
    const id = el.id;
    if (id && typeof id === "string") addToken("i:" + id);
    const cn = el.getAttribute("class");
    if (cn) { const parts = cn.split(WS); for (let i = 0; i < parts.length; i++) if (parts[i]) addToken("c:" + parts[i]); }
  }
  function scanTree(node) {
    if (!node || node.nodeType !== 1) return;
    collect(node);
    if (node.firstElementChild) { try { for (const el of node.querySelectorAll("[id],[class]")) collect(el); } catch (e) {} }
  }
  function flushTokens() {
    tokenTimer = null;
    if (enabled === null) return;                      // config not here yet: keep the queue
    if (!enabled || !queue.size || cfg.cosmetic.genericOff) { queue.clear(); return; }
    const tokens = Array.from(queue); queue.clear();
    try {
      chrome.runtime.sendMessage({ type: "cosmeticTokens", host: M.topHost, tokens }, (r) => {
        if (!chrome.runtime.lastError && r && r.rules) addRules(r.rules);
      });
    } catch (e) {}
  }
  function scheduleTokens() { if (!tokenTimer && enabled !== false) tokenTimer = setTimeout(flushTokens, 50); }

  // ---------------------------------------------------------------- counting
  let countTimer = null, lastSent = "";
  function scheduleCount() { if (!countTimer) countTimer = setTimeout(() => idle(doCount), 700); }
  function countSel(sels) {
    try { return document.querySelectorAll(sels.join(",")).length; }
    catch (e) { let n = 0; for (const s of sels) { try { n += document.querySelectorAll(s).length; } catch (e2) {} } return n; }
  }
  function doCount() {
    countTimer = null;
    let ads = 0, annoy = 0;
    for (const [cat, sels] of Object.entries(catSelectors)) {
      const n = countSel(sels);
      if (cat === "ads" || cat === "mine") ads += n; else annoy += n;
    }
    if (P) for (const [cat, n] of Object.entries(P.counts)) { if (cat === "ads" || cat === "mine") ads += n; else annoy += n; }
    if (annoy > 0 && !annoyActivity) { annoyActivity = true; rescueSoon(); }
    annoy += extraAnnoy;
    const key = ads + ":" + annoy;
    if ((ads || annoy) && key !== lastSent) {
      lastSent = key;
      try { chrome.runtime.sendMessage({ type: "cosmeticCount", ads, annoy, src: "engine" }); } catch (e) {}
    }
  }
  M.onAnnoy = (n) => { extraAnnoy += n || 1; scheduleCount(); };

  // (config may arrive after parsing; onReady then runs immediately)
  // Fixed / sticky elements near the top of the tree (banners and pop-ups are
  // almost always attached high up). Bounded, so it stays cheap.
  let fixedCache = null, fixedAt = 0;
  function fixedElements() {
    if (fixedCache && Date.now() - fixedAt < 1000) return fixedCache;
    const out = [];
    if (!document.body) return out;
    let visited = 0;
    const walk = (el, depth) => {
      for (const c of el.children) {
        if (out.length >= 40 || ++visited > 150) return;
        const tag = c.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "META" || tag === "NOSCRIPT" || tag === "TEMPLATE") continue;
        let pos = ""; try { pos = getComputedStyle(c).position; } catch (e) {}
        if (pos === "fixed" || pos === "sticky") out.push(c);
        else if (depth < 2) walk(c, depth + 1);
      }
    };
    walk(document.body, 0);
    fixedCache = out; fixedAt = Date.now();
    return out;
  }

  // ---------------------------------------------------------------- cookie reject
  const CMPS = [
    "#onetrust-reject-all-handler", ".ot-pc-refuse-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline", "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll",
    "#didomi-notice-disagree-button", ".didomi-continue-without-agreeing",
    ".cmplz-btn.cmplz-deny", ".cky-btn-reject", "#cn-refuse-cookie",
    ".osano-cm-denyAll", ".osano-cm-button--type_denyAll", '[data-tid="banner-decline"]',
    ".iubenda-cs-reject-btn", ".klaro .cm-btn-decline", ".cmpboxbtnno",
    "#BorlabsCookieBox a[data-cookie-refuse]", "button.sp_choice_type_13", "button.sp_choice_type_REJECT_ALL",
    "#truste-consent-required", ".moove-gdpr-infobar-reject-btn", "#wt-cli-reject-btn",
    "#cookie_action_close_header_reject", "#axeptio_btn_dismiss", "#tarteaucitronAllDenied2",
    ".fc-cta-do-not-consent", "#cookiescript_reject", ".cc-deny", ".js-cookie-consent-reject"
  ];
  const CMP_QUERY = CMPS.join(",");
  const QC_SECONDARY = '.qc-cmp2-summary-buttons button[mode="secondary"]';
  const REJECT_TEXT = /^\s*(reject|decline|deny|refuse|disagree)( all)?( cookies| optional cookies| non-essential cookies)?\s*$|^\s*(only|use) (strictly )?(essential|necessary|required)( cookies)?( only)?\s*$|^\s*(strictly )?(essential|necessary) (cookies )?only\s*$|^\s*continue without (accepting|agreeing)\s*$|^\s*(ablehnen|alle ablehnen|refuser|tout refuser|rechazar( todo)?|rifiuta( tutto)?|weigeren|odrzuć)\s*$/i;
  const ACCEPT_TEXT = /\b(accept|agree|allow all|ok|got it|consent to all|akzeptieren|accepter|aceptar|accetta)\b/i;
  let cookieDone = false, cookieTries = 0;

  function visibleText(el) { return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(); }
  function safeClick(el) {
    const t = visibleText(el);
    if (t && ACCEPT_TEXT.test(t) && !REJECT_TEXT.test(t)) return false;   // never click "accept"
    try { el.click(); } catch (e) { return false; }
    return true;
  }
  function tryRejectCookies() {
    if (cookieDone || !cfg || cfg.annoy.cookieMode !== "reject") return;
    if (++cookieTries > 25) return;
    // 1) known consent platforms
    let hit = null;
    try { hit = document.querySelector(CMP_QUERY); } catch (e) {}   // one pass over the page, not 30
    if (hit && safeClick(hit)) return cookieClicked("platform");
    try {
      for (const b of document.querySelectorAll(QC_SECONDARY)) if (REJECT_TEXT.test(visibleText(b)) && safeClick(b)) return cookieClicked("quantcast");
    } catch (e) {}
    try {
      const uc = document.querySelector("#usercentrics-root");
      const b = uc && uc.shadowRoot && uc.shadowRoot.querySelector('[data-testid="uc-deny-all-button"]');
      if (b && safeClick(b)) return cookieClicked("usercentrics");
    } catch (e) {}
    // 2) strict text match, but only inside something that is clearly a cookie
    //    banner. This part reads computed styles, so it runs sparingly.
    if (cookieTries % 3 !== 1) return;
    const containers = new Set();
    try {
      for (const s of catSelectors.cookies || []) { try { document.querySelectorAll(s).forEach((e) => containers.add(e)); } catch (e) {} }
      document.querySelectorAll('[role="dialog"],[aria-modal="true"],[id*="cookie" i],[class*="cookie" i],[id*="consent" i],[class*="consent" i],[id*="gdpr" i],[class*="gdpr" i]')
        .forEach((e) => containers.add(e));
      for (const e of fixedElements()) containers.add(e);     // unnamed banners pinned to the screen
    } catch (e) {}
    let n = 0;
    for (const c of containers) {
      if (++n > 40) break;
      const txt = (c.textContent || "").slice(0, 3000);
      if (!/cookie|consent|gdpr|privacy|datenschutz|tracking/i.test(txt)) continue;
      for (const b of c.querySelectorAll('button, a[role="button"], [role="button"], input[type="button"], input[type="submit"]')) {
        const t = b.value && b.tagName === "INPUT" ? b.value : visibleText(b);
        if (t && t.length < 60 && REJECT_TEXT.test(t) && safeClick(b)) return cookieClicked("text:" + t);
      }
    }
  }
  function cookieClicked(which) {
    cookieDone = true;
    annoyActivity = true;
    extraAnnoy++;
    scheduleCount();
    rescueSoon();
  }

  // ---------------------------------------------------------------- newsletter pop-ups
  let lastGesture = 0;
  const gesture = (e) => { if (e.isTrusted) lastGesture = Date.now(); };
  addEventListener("pointerdown", gesture, true);
  addEventListener("keydown", gesture, true);
  const NEWS_TEXT = /newsletter|subscribe|sign ?up (for|to|and)|join (our|the) (list|community|newsletter|club)|\d+% off|exclusive (offers|deals|discounts)|don'?t miss (out|a thing)|stay (in the loop|updated|informed)|get (the latest|updates)/i;
  const handled = new WeakSet();
  function hideEl(el) { el.style.setProperty("display", "none", "important"); handled.add(el); }
  function checkModal(el) {
    if (!el || el.nodeType !== 1 || handled.has(el) || el === document.body || el === document.documentElement) return;
    if (Date.now() - lastGesture < 2500) return;                  // you probably opened it
    let cs; try { cs = getComputedStyle(el); } catch (e) { return; }
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.05) return;
    const dialogish = cs.position === "fixed" || el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true";
    if (!dialogish) return;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 0.1 * innerWidth * innerHeight) return;
    if (el.querySelector('input[type="password"]')) return;        // a login box: leave it
    const email = el.querySelector('input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[autocomplete="email"]');
    if (!email) return;
    const txt = (el.innerText || "").slice(0, 2000);
    if (txt.length > 1500 || !NEWS_TEXT.test(txt)) return;
    hideEl(el);
    hideBackdrops(el);
    annoyActivity = true;
    extraAnnoy++;
    scheduleCount();
    rescueSoon();
  }
  // A dimming layer next to the pop-up: page-covering, fixed, nearly empty,
  // semi-transparent background. Only looked for near the pop-up we removed.
  function hideBackdrops(modal) {
    const scope = [modal.parentElement, modal.parentElement && modal.parentElement.parentElement, document.body].filter(Boolean);
    for (const root of scope) {
      for (const el of root.children) {
        if (el === modal || handled.has(el)) continue;
        let cs; try { cs = getComputedStyle(el); } catch (e) { continue; }
        if (cs.position !== "fixed" || cs.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 0.7 * innerWidth * innerHeight) continue;
        if ((el.textContent || "").trim().length > 3 || el.querySelector("img,video,canvas,iframe")) continue;
        const m = /rgba?\(([^)]+)\)/.exec(cs.backgroundColor);
        const alpha = m ? parseFloat((m[1].split(",")[3] || "1")) : 0;
        if (alpha >= 0.15 && alpha <= 0.95) hideEl(el);
      }
    }
  }
  // Cheap-to-match candidates only (substring selectors like [class*="modal"]
  // test every element on the page). New elements and pinned (fixed) elements
  // are covered separately.
  const MODAL_CANDIDATES = '[role="dialog"],[aria-modal="true"],dialog[open]';
  const addedCandidates = new Set();
  function scanModals() {
    if (!enabled || !cfg.annoy.cats.includes("newsletter")) { addedCandidates.clear(); return; }
    let list = [];
    try { list = Array.from(document.querySelectorAll(MODAL_CANDIDATES)).slice(0, 60); } catch (e) {}
    for (const el of addedCandidates) list.push(el);
    addedCandidates.clear();
    for (const el of fixedElements()) list.push(el);
    for (const el of list) checkModal(el);
  }

  // ---------------------------------------------------------------- scroll rescue
  function overlayShowing() {
    let el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (el && el !== document.body && el !== document.documentElement) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed") {
        const r = el.getBoundingClientRect();
        if (r.width * r.height > 0.3 * innerWidth * innerHeight) return true;
      }
      el = el.parentElement;
    }
    return false;
  }
  function rescue() {
    if (!annoyActivity || !document.body || window.top !== window) return;
    if (cfg && cfg.annoy && cfg.annoy.rescue === false) return;       // user turned scroll rescue off
    const de = document.documentElement, b = document.body;
    const lockedEl = (el) => { const cs = getComputedStyle(el); return cs.overflowY === "hidden" || cs.overflowY === "clip"; };
    const bcs = getComputedStyle(b);
    const bodyFixed = bcs.position === "fixed";
    const locked = lockedEl(de) || lockedEl(b) || bodyFixed;
    // Only when there is real content you can't reach (app-style layouts that
    // scroll an inner panel are left alone).
    const tall = Math.max(de.scrollHeight, b.scrollHeight) > innerHeight + 50;
    if (locked && tall && !overlayShowing()) {
      for (const el of [de, b]) { el.style.setProperty("overflow", "auto", "important"); el.style.setProperty("overflow-y", "auto", "important"); }
      if (bodyFixed) {
        const top = parseInt(b.style.top || "0", 10);
        b.style.setProperty("position", "static", "important");
        if (top < 0) window.scrollTo(0, -top);
      }
    }
    if (bcs.pointerEvents === "none") b.style.setProperty("pointer-events", "auto", "important");
    let overlay = null;                                   // checked once, and only if something is blurred
    for (const el of [de, b, ...Array.from(b.children).slice(0, 60)]) {
      let f = ""; try { f = getComputedStyle(el).filter; } catch (e) {}
      if (f && f.includes("blur") && !(overlay ??= overlayShowing())) el.style.setProperty("filter", "none", "important");
    }
  }
  let rescueTimers = [];
  function rescueSoon() {
    rescueTimers.forEach(clearTimeout);
    rescueTimers = [300, 1500, 4000].map((ms) => setTimeout(rescue, ms));
  }

  // ---------------------------------------------------------------- observer
  let modalTimer = null, cookieTimer = null;
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") { collect(m.target); continue; }
      for (const n of m.addedNodes) {
        scanTree(n);
        if (n.nodeType === 1 && addedCandidates.size < 40 && !/^(SCRIPT|STYLE|LINK|META)$/.test(n.tagName)) addedCandidates.add(n);
      }
    }
    if (queue.size) scheduleTokens();
    if (enabled) {
      if (styleEl && !styleEl.isConnected) ensureStyle();
      if (!parsed) return;                                  // still loading: tokens only
      if (!modalTimer) modalTimer = setTimeout(() => idle(() => { modalTimer = null; scanModals(); }), 1000);
      if (!cookieDone && !cookieTimer) cookieTimer = setTimeout(() => idle(() => { cookieTimer = null; tryRejectCookies(); }), 700);
    }
  });
  // Not observed while the page is parsing: watching every node the parser
  // inserts measurably slowed page loads. Instead: site-specific and always-on
  // rules apply from the very start; one fast sweep when parsing ends picks up
  // the page's class/id names; then only later changes are watched.
  const startObserving = () => {
    try { mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "id"] }); } catch (e) {}
  };

  // ---------------------------------------------------------------- start
  M.config.then((c) => {
    cfg = c;
    enabled = !!(c && c.cosmetic);
    if (!enabled) { queue.clear(); return; }
    addRules(c.cosmetic.rules);
    scheduleTokens();
    const onReady = () => {
      parsed = true;
      scanTree(document.documentElement);                   // one sweep of the finished page
      scheduleTokens();
      startObserving();
      tryRejectCookies();
      idle(() => { scanModals(); scheduleCount(); });
    };
    // Run just AFTER DOMContentLoaded rather than inside it, so the page's own
    // "ready" moment isn't held up by our sweep.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(onReady, 0), { once: true });
    else setTimeout(onReady, 0);
    addEventListener("load", () => idle(() => { tryRejectCookies(); scanModals(); scheduleCount(); }), { once: true });
    // Timed pop-ups ("wait 10s, then ask for your email"): keep looking for 90s.
    let ticks = 0;
    const iv = setInterval(() => idle(() => { if (!document.hidden) scanModals(); if (++ticks >= 30) clearInterval(iv); }), 3000);
  });
})();
