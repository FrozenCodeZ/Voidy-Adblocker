// The settings page's right-hand column: a lively Voidy with something to say
// about the current tab, a live number, quick actions, honest trade-offs and
// tips. Uses send / show / el / ico / fmt / toast from options.js.
(() => {
  // ---- Settings ------------------------------------------------------------
  const SAY_EVERY_MS = 9000;          // Voidy says something new this often
  const ACTS = ["wink", "look", "greet", "coffee", "shades", "giggle", "love", "eye-roll"];
  // --------------------------------------------------------------------------
  const rail = document.getElementById("rail");
  if (!rail) return;
  const days = (t) => Math.max(1, Math.round((Date.now() - (t || Date.now())) / 86400000));
  const settings = () => send({ type: "getSettings" });
  const stats = () => send({ type: "getStats" });
  const ago = (t) => { if (!t) return "not yet"; const m = Math.round((Date.now() - t) / 60000);
    return m < 2 ? "just now" : m < 90 ? m + " min ago" : m < 2160 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " days ago"; };

  const TABS = {
    guide: {
      says: ["New here? I'll keep it short, promise. 🕳️", "Pin me to the toolbar so you can see me snack!", "Every switch has a plain-words explanation. No jargon zone."],
      stat: async () => { const s = await stats(); return [days(s && s.since), "days of Voidy on this computer", "counting since you installed me"]; },
      actions: [["Open the dashboard", "telescope", () => show("dash")]],
      risks: ["No ad blocker catches every ad. YouTube in particular changes its tricks often.",
        "Voidy is free with no paid tier. There's nothing to unlock, and that won't change."],
      tips: ["Right-click any leftover ad and choose <b>Hide this with Voidy</b>.", "A site acting weird? The popup's “Site looks broken?” eases off on that site only.", "Auto is the best default: it only gets sneakier where a site fights back."],
    },
    filters: {
      says: ["Fresh lists, served daily. 🍽️", "Half a million bad addresses and counting!", "I read the lists so you don't have to."],
      stat: async () => { const [info, upd] = await Promise.all([send({ type: "getListInfo" }), send({ type: "listUpdateStatus" })]);
        const f = (info && info.fresh) || {}, st = (info && info.static) || {};
        const n = (st.ads || 0) + (st.privacy || 0) + (st.security || 0) + (f.ads || 0) + (f.privacy || 0) + (f.security || 0);
        const u = upd && upd.cats.security.updated;
        return [n, "blocked addresses loaded", u ? "dangerous-site list updated " + ago(u) : "first automatic update in a few minutes"]; },
      actions: [["Update lists now", "clock", async (b) => { b.disabled = true; b.textContent = "Downloading…"; await send({ type: "listUpdateNow" }); b.disabled = false; b.textContent = "Update lists now"; toast("Lists updated"); render(); }]],
      risks: ["More blocking means a small chance a site breaks. Fix: set that site to Lite or Off in the popup.",
        "List updates come from EasyList and HaGeZi. Like any download they see your IP address; nothing else is sent.",
        "Lists are written by volunteers and are sometimes wrong. Spot a mistake? Tell us with Send feedback."],
      tips: ["Phone & device telemetry is off by default because it can break smart-TV and phone apps.", "Counts here are addresses, not ads seen. One ad network can own thousands."],
    },
    annoy: {
      says: ["Cookie banners? Nom. 🍪", "Newsletter pop-up in 3… 2… gone.", "I only click “Reject”, never “Accept”. Pinky promise."],
      stat: async () => { const s = await stats(); return [(s && s.totals && s.totals.annoy) || 0, "pop-ups & widgets removed", "on every site, all time"]; },
      risks: ["“Reject cookies” clicks the site's own Reject button. A few sites then hide embedded videos or maps until you accept.",
        "Hiding chat bubbles also hides real support chats. Switch widgets back on for that site in the popup.",
        "Login windows are never removed, but a rare sign-up form might be. Turn widgets off for that site if so."],
      tips: ["Each site has its own widgets switch in the popup.", "“Hide only” mode leaves consent choices to you but still tidies the banner away."],
    },
    sites: {
      says: ["Every site gets its own little profile. 📇", "Auto remembers what worked where.", "Off here means off. I'll take a nap on that site."],
      stat: async () => { const s = await settings(); const n = new Set([...Object.keys((s && s.sites) || {}), ...Object.keys((s && s.autoState) || {})]).size;
        return [n, "sites with their own setting", "everything else uses your default"]; },
      risks: ["“Off” really means off: no ad blocking and no dangerous-site warnings on that site.",
        "This list reveals sites you've visited. It never leaves this computer, but anyone using this browser profile can see it."],
      tips: ["Removing a site here sends it back to your default mode.", "Stealth levels picked by Auto are retried lower after a while, in case the site calmed down."],
    },
    privacy: {
      says: ["Your browser shouldn't have a fingerprint. 🫆", "I can blur the bits sites use to recognise you.", "Privacy superpowers, sold separately? Nope, free."],
      stat: async () => { const s = await settings(); const x = (s && s.extraPrivacy) || {}, on = ["webrtc", "ipv6", "prefetch", "cookies"].filter((k) => x[k]).length;
        const every = { strong: "Extra", maximum: "Maximum" }[s && s.fingerprintDefault];
        return [on + Object.keys((s && s.fingerprintSites) || {}).length + (every ? 1 : 0), "extra protections switched on",
          `${every ? "every site: " + every + " · " : ""}${on} for the whole browser · ${Object.keys((s && s.fingerprintSites) || {}).length} per-site`]; },
      risks: ["Global Privacy Control is a request, not a wall: sites that ignore it (many do outside California and a few other places) still see you. It also tells sites one more small fact about your browser.",
        "Fingerprint protection can confuse captchas, bank fraud checks and video calls. Turn it off for that site if something acts up.",
        "WebRTC IP protection can break video calls in the browser (Meet, Discord, Teams).",
        "Blocking third-party cookies can log you out of embedded logins such as comment boxes and “Sign in with…”.",
        "No extension makes you anonymous. For that you need Tor or a VPN you trust."],
      tips: ["Start with one site you care about, not everything at once.", "Set <b>Every site</b> in Extra privacy to protect sites you haven't visited yet. “Maximum privacy” in the popup changes one site."],
    },
    stealth: {
      says: ["Sunglasses on. 😎", "Walls can't find what they can't see.", "Shh… I'm being very sneaky right now."],
      stat: async () => { const s = await stats(); return [(s && s.totals && s.totals.climbs) || 0, "ad-block walls dodged", "Auto only goes stealthy where a site fights back"]; },
      actions: [["See which sites use it", "orbit", () => show("sites")]],
      risks: ["Stealth makes ad checks think ads loaded. The site still earns nothing from you; consider supporting sites you love.",
        "No blocker is undetectable. Sites update their checks, and Auto climbs again when that happens.",
        "Higher levels run more code inside the page, with a small chance of odd behaviour. That's why Auto starts at Full."],
      tips: ["Seeing a wall right now? The popup's pink button goes one level stealthier.", "Stealth never hides “bait” ad boxes. Detectors measure them, and hiding them would give us away."],
    },
    guard: {
      says: ["Surprise tabs? Not on my watch. 🛡️", "Your own clicks always go through.", "I hold sneaky redirects at the door."],
      stat: async () => { const s = await stats(); return [(s && s.totals && s.totals.held) || 0, "redirects & pop-ups held", "all time"]; },
      risks: ["Some logins and payments bounce between sites. If a checkout stalls, allow the jump, or add the pair to “Always allow”.",
        "“Block quietly” never asks, so the rare wanted pop-up is lost too. “Ask” is the safer default."],
      tips: ["Look-alike warnings live here too: they flag “paypa1.com”-style fakes before you type a password.", "Sign-in and payment pages are left alone automatically (see Sensitive pages)."],
    },
    safety: {
      says: ["Banks and checkouts get the gentle treatment. 🔐", "Payments working beats being clever.", "I tiptoe on log-in pages."],
      stat: async () => { const s = await settings(); return [((s && s.sensitiveSites) || []).length, "sites you added", "plus a built-in list of banks and payment providers"]; },
      risks: ["On these pages stealth stands aside, so the site may notice an ad blocker. That's deliberate: nothing important should break.",
        "Ad and malware blocking stay on here. If a payment still fails, set that site to Off just for the purchase."],
      tips: ["Add your bank's or shop's site if its sign-in or checkout jumps get held.", "Payment frames (Stripe, PayPal, Adyen…) are never touched at all."],
    },
    look: {
      says: ["Makeover time! ✨", "Try the Starry eyes. Trust me.", "I look good in every universe, not gonna lie."],
      stat: async () => { const s = await chrome.storage.local.get({ voidyForm: "blackhole", voidyEyes: "shiny", voidyAccessory: "none" });
        return [null, `${s.voidyForm.replace("hole", " hole")} · ${s.voidyEyes} eyes`, s.voidyAccessory === "none" ? "no accessory (yet)" : "wearing: " + s.voidyAccessory]; },
      actions: [["Surprise me", "sparkle", async () => {
        const pick = (a) => a[Math.floor(Math.random() * a.length)];
        await chrome.storage.local.set({ theme: pick(VOIDY_THEME.THEMES.filter((t) => t !== "custom")), voidyForm: pick(VOIDY_MASCOT.FORMS),
          voidyEyes: pick(VOIDY_MASCOT.EYES)[0], voidyAccessory: pick(["none", "halo", "crown", "ears", "bow", "antenna", "wizard", "phones", "sprout"]) });
        life && life.act("love", "Ooh, fancy!"); render(); }]],
      risks: ["Animations use a little battery. On a laptop running low, switch them off.",
        "If you ignore me for a while I get sleepy. That's not a bug, that's a personality."],
      tips: ["Double-click me in the popup. 💜", "Keep poking me and see what happens…"],
    },
    logs: {
      says: ["Dear diary… 📓", "Everything Auto decided, in plain words.", "No secrets here. Well, only yours, and they stay on this computer."],
      stat: async () => { const r = await send({ type: "getLog" }); const log = (r && r.log) || []; return [log.length, "events kept", log.length ? "latest " + ago(log[log.length - 1].t) : "nothing yet"]; },
      risks: ["The log never leaves this computer and only keeps the last 200 events.",
        "It includes site names, so anyone using this browser profile can read it."],
      tips: ["Filter by Stealth, Guard or You to find a decision quickly.", "Warnings about look-alike sites show up here too."],
    },
    backup: {
      says: ["Moving house? Take me with you. 📦", "One file, all your settings.", "Fresh start? I won't take it personally."],
      stat: async () => { const s = await settings(); const n = Object.keys((s && s.sites) || {}).length + ((s && s.sensitiveSites) || []).length;
        return [n, "site settings in a backup", "plus your filters, guard and look"]; },
      actions: [["Download a backup", "down", () => document.getElementById("export")?.click()]],
      risks: ["A backup file lists sites you changed settings for. That's personal: don't share it publicly.",
        "Importing replaces your current settings. Download a backup first if you're unsure.",
        "Reset can't be undone."],
      tips: ["Statistics and the activity log aren't part of a backup; they stay with this browser."],
    },
  };

  // Voidy at the top of the column, shared by every tab
  const head = el("div", { class: "rail-voidy" });
  const mascot = el("div", { class: "rail-mascot", title: "Poke me", "aria-hidden": "true" });
  const says = el("p", { class: "rail-says", role: "status" });
  head.append(mascot, says);
  VOIDY_MASCOT.mount(mascot);
  const life = globalThis.VOIDY_LIFE ? VOIDY_LIFE.attach(mascot.querySelector(".voidy") || mascot, { mood: () => "happy" }) : null;
  const body = el("div", { class: "rail-body" });
  rail.append(head, body);
  const dashSide = document.querySelector(".dash-side"), dashHome = dashSide && dashSide.parentElement;

  let tab = "dash", line = 0, sayTimer = 0;
  function speak() {
    const t = TABS[tab], list = t ? t.says : ["Look at all that stuff I ate! 🕳️", "Everything here stays on your computer.", "Poke me. I dare you."];
    says.textContent = list[line++ % list.length];
    says.classList.remove("pop"); void says.offsetWidth; says.classList.add("pop");
  }
  mascot.addEventListener("click", () => { speak(); life && life.act(ACTS[Math.floor(Math.random() * ACTS.length)]); });

  const card = (cls, title, iconName, ...kids) => el("div", { class: "rail-card " + cls }, el("h4", {}, el("i", { html: ico(iconName) }), title), ...kids);
  let renderId = 0;
  async function render() {
    const id = ++renderId, t = TABS[tab];
    if (dashSide && dashSide.parentElement === body) dashHome.appendChild(dashSide);   // keep the dashboard column alive while another tab shows
    body.innerHTML = "";
    if (!t) { if (dashSide) body.append(dashSide); return; }                 // the dashboard keeps its own column
    const statBox = el("div", { class: "rail-card rail-stat" }, el("b", {}, "…"), el("span", {}, ""), el("small", {}, ""));
    body.append(statBox);
    if (t.actions) {
      const row = el("div", { class: "rail-actions" });
      for (const [label, iconName, run] of t.actions) {
        const b = el("button", { class: "btn rail-btn", type: "button" }, el("i", { html: ico(iconName) }), label);
        b.addEventListener("click", () => run(b));
        row.append(b);
      }
      body.append(row);
    }
    body.append(card("rail-risks", "Trade-offs", "radar", el("ul", {}, ...t.risks.map((r) => el("li", {}, r)))));
    body.append(card("rail-tips", "Tips", "sparkle", el("ul", {}, ...t.tips.map((r) => el("li", { html: r })))));   // our own fixed text
    try {
      const [n, label, sub] = await t.stat();
      if (id !== renderId) return;
      statBox.querySelector("b").textContent = n == null ? "✦" : fmt(n);
      statBox.querySelector("span").textContent = label;
      statBox.querySelector("small").textContent = sub || "";
    } catch (_) { statBox.remove(); }
  }
  function onTab(next) {
    tab = next; line = 0;
    document.body.classList.toggle("rail-dash", !TABS[tab]);
    speak(); render();
    if (life && Math.random() < .5) life.act(ACTS[Math.floor(Math.random() * ACTS.length)]);
  }
  // follow the page's navigation
  const current = () => (document.querySelector(".panel.on") || {}).dataset?.panel || "dash";
  new MutationObserver(() => { if (current() !== tab) onTab(current()); })
    .observe(document.querySelector("main"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  onTab(current());
  clearInterval(sayTimer); sayTimer = setInterval(() => { if (!document.hidden) speak(); }, SAY_EVERY_MS);
  if (globalThis.VOIDY_ICONS) VOIDY_ICONS.fill();
})();
