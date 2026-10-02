// Voidy in the popup: builds the mascot, sets its mood, plays mode-switch
// animations, eats blocked items, and runs the Customize panel.
// Pure decoration: it only shows numbers and modes popup.js already has.
(() => {
  // ---- Settings you can play with ----------------------------------------
  const MAX_TILT_DEG = 16;        // how far Voidy leans toward the mouse
  const FIRST_FEED_MAX = 12;      // max crumbs shown when the popup opens
  const LATER_FEED_MAX = 6;       // max crumbs for new blocks while it's open
  const CRUMB_GAP_MS = 110;       // time between crumbs
  // -------------------------------------------------------------------------

  const THEMES = [["void", "Black hole"], ["whitehole", "White hole"], ["nebula", "Nebula"], ["supernova", "Supernova"],
    ["pulsar", "Pulsar"], ["aurora", "Aurora"], ["eclipse", "Eclipse"], ["custom", "My colours"]];
  const ACCESSORIES = [["none", "None", "hole"], ["halo", "Zero halo", "orbit"], ["crown", "Crown", "crown"], ["ears", "Cat ears", "cat"],
    ["bow", "Bow", "bow"], ["antenna", "Antenna", "antenna"], ["wizard", "Wizard", "hat"], ["phones", "Headphones", "headphones"], ["sprout", "Sprout", "leaf"]];
  const FORMS = [["blackhole", "Black hole"], ["whitehole", "White hole"], ["nebula", "Nebula"], ["supernova", "Supernova"],
    ["pulsar", "Pulsar"], ["aurora", "Aurora"], ["eclipse", "Eclipse"], ["galaxy", "Galaxy"], ["comet", "Comet"]];
  const MOODS = ["idle", "off", "lite", "happy", "stealth1", "stealth2", "stealth3"];

  const root = document.getElementById("voidy");
  if (!root) return;
  VOIDY_MASCOT.mount(root);
  const logo = document.getElementById("voidy-logo");
  if (logo) VOIDY_MASCOT.mount(logo, { mini: true });
  const tilt = root.querySelector(".v-tilt");
  const crumbs = root.querySelector(".v-crumbs");
  const says = document.getElementById("voidy-says");
  const still = () => document.documentElement.classList.contains("still");
  let lastTotal = null, mood = "", eatTimer = 0, transTimer = 0, charging = false;

  // Lean toward the pointer; eyes follow it.
  document.addEventListener("pointermove", e => {
    if (still()) return;
    const r = root.getBoundingClientRect();
    const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 180));
    const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / 180));
    tilt.style.setProperty("--ry", (dx * MAX_TILT_DEG).toFixed(1) + "deg");
    tilt.style.setProperty("--rx", (-dy * MAX_TILT_DEG).toFixed(1) + "deg");
    root.style.setProperty("--px", (dx * 3.2).toFixed(2) + "px");
    root.style.setProperty("--py", (dy * 3.2).toFixed(2) + "px");
  });
  document.addEventListener("pointerleave", () => {
    for (const k of ["--rx", "--ry"]) tilt.style.removeProperty(k);
    for (const k of ["--px", "--py"]) root.style.removeProperty(k);
  });

  // ---- eating ------------------------------------------------------------
  const COLORS = ["var(--c-ads)", "var(--c-trk)", "var(--c-mal)", "var(--c-hid)"];
  function crumb(delay) {
    const el = document.createElement("span");
    const isAd = Math.random() < 0.4;
    el.className = "v-crumb" + (isAd ? " ad" : "");
    if (isAd) el.textContent = "AD";
    else el.style.background = el.style.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    el.style.setProperty("--a", Math.floor(Math.random() * 360) + "deg");
    el.style.setProperty("--d", (74 + Math.random() * 26).toFixed(0) + "px");
    el.style.animationDelay = delay + "ms";
    el.addEventListener("animationend", () => { el.remove(); munch(); });
    crumbs.appendChild(el);
  }
  function munch() {
    root.classList.add("eating");
    clearTimeout(eatTimer);
    eatTimer = setTimeout(() => root.classList.remove("eating"), 900);
  }
  // Show newly blocked items being eaten. Only real counts trigger crumbs.
  function feed(total) {
    if (!Number.isFinite(total)) return;
    const fresh = lastTotal === null ? Math.min(total, FIRST_FEED_MAX) : Math.min(Math.max(0, total - lastTotal), LATER_FEED_MAX);
    lastTotal = total;
    if (still() || mood === "off" || mood === "idle" || mood === "stealth3") return;
    for (let i = 0; i < fresh; i++) crumb(i * CRUMB_GAP_MS);
  }

  // ---- moods and mode-switch animations (lib/voidy.css "t-<mood>") ------
  function play(next) {
    root.classList.remove(...MOODS.map(m => "t-" + m));
    if (still() || next === "idle") return;
    void root.offsetWidth;          // restart the animation if it's the same one
    root.classList.add("t-" + next);
    clearTimeout(transTimer);
    transTimer = setTimeout(() => root.classList.remove("t-" + next), 1300);
  }
  function setMood(next) {
    const changed = next !== mood, first = mood === "";
    for (const m of MOODS) root.classList.toggle("is-" + m, m === next);
    mood = next;
    if (charging || (changed && !first)) play(next);
    charging = false;
    root.classList.remove("charging");
  }
  // A mode button was clicked: spin the disk up until the new mode arrives.
  function gulp() {
    if (still()) return;
    charging = true;
    root.classList.add("charging");
  }
  function say(html) { if (says) says.innerHTML = html; }

  // ---- animations switch -------------------------------------------------
  const motionBtn = document.getElementById("voidy-motion");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function showMotion(on) {
    motionBtn.setAttribute("aria-pressed", String(on && !reduced));
    motionBtn.disabled = reduced;
    motionBtn.title = reduced ? "Animations are off because your system asks for reduced motion" : on ? "Turn animations off" : "Turn animations on";
    document.documentElement.classList.toggle("still", reduced || !on);
    if (!on) { crumbs.replaceChildren(); root.classList.remove("eating", "charging", ...MOODS.map(m => "t-" + m)); }
  }
  motionBtn.addEventListener("click", () => {
    const on = motionBtn.getAttribute("aria-pressed") !== "true";
    showMotion(on);
    try { chrome.storage.local.set({ voidyMotion: on }); } catch (_) {}
  });

  // ---- Customize panel ---------------------------------------------------
  const styleBtn = document.getElementById("voidy-style"), panel = document.getElementById("style-panel");
  const themeChips = document.getElementById("theme-chips"), accChips = document.getElementById("acc-chips");
  const formChips = document.getElementById("form-chips"), eyeChips = document.getElementById("eye-chips");
  for (const [id, name] of THEMES) {
    const b = document.createElement("button");
    b.className = "chip"; b.dataset.theme = id; b.dataset.v = id; b.type = "button"; b.title = name;
    b.innerHTML = `<span class="orb"></span>${name}`;
    b.addEventListener("click", () => { try { chrome.storage.local.set({ theme: id }); } catch (_) {} });
    themeChips.appendChild(b);
  }
  // Form chips hold a tiny live Voidy each; built the first time the panel opens.
  function buildFormChips() {
    if (formChips.children.length) return;
    for (const [id, name] of FORMS) {
      const b = document.createElement("button");
      b.className = "chip form-chip"; b.dataset.v = id; b.type = "button"; b.title = name;
      const mini = document.createElement("span");
      b.append(mini, name);
      VOIDY_MASCOT.mount(mini, { mini: true, form: id });
      b.addEventListener("click", () => { try { chrome.storage.local.set({ voidyForm: id }); } catch (_) {} });
      formChips.appendChild(b);
    }
    try { chrome.storage.local.get(DEFAULTS, markChosen); } catch (_) {}
  }
  for (const [id, name] of VOIDY_MASCOT.EYES) {
    const b = document.createElement("button");
    b.className = "chip eye-chip"; b.dataset.v = id; b.type = "button"; b.title = name + " eyes";
    b.innerHTML = VOIDY_MASCOT.eyePreview(id) + name;
    b.addEventListener("click", () => { try { chrome.storage.local.set({ voidyEyes: id }); } catch (_) {} });
    eyeChips.appendChild(b);
  }
  for (const [id, name, ico] of ACCESSORIES) {
    const b = document.createElement("button");
    b.className = "chip"; b.dataset.v = id; b.type = "button"; b.title = name;
    b.innerHTML = `<i class="acc-ico" data-ico="${ico}"></i>${name}`;
    b.addEventListener("click", () => { try { chrome.storage.local.set({ voidyAccessory: id }); } catch (_) {} });
    accChips.appendChild(b);
  }
  styleBtn.addEventListener("click", () => {
    const open = panel.hidden;
    panel.hidden = !open;
    if (open) buildFormChips();
    styleBtn.setAttribute("aria-expanded", String(open));
  });
  function markChosen(s) {
    const theme = VOIDY_THEME.themeName(s.theme);
    for (const b of themeChips.children) b.classList.toggle("on", b.dataset.v === theme);
    for (const b of accChips.children) b.classList.toggle("on", b.dataset.v === (s.voidyAccessory || "none"));
    for (const b of formChips.children) b.classList.toggle("on", b.dataset.v === (s.voidyForm || "blackhole"));
    for (const b of eyeChips.children) b.classList.toggle("on", b.dataset.v === (s.voidyEyes || "shiny"));
  }
  const DEFAULTS = { theme: "void", voidyForm: "blackhole", voidyAccessory: "none", voidyEyes: "shiny", voidyMotion: true };
  try {
    chrome.storage.local.get(DEFAULTS, s => { showMotion(s.voidyMotion !== false); markChosen(s); });
    chrome.storage.onChanged.addListener(c => {
      if (c.theme || c.voidyAccessory || c.voidyForm || c.voidyEyes) chrome.storage.local.get(DEFAULTS, markChosen);
      if ((c.theme || c.voidyForm || c.voidyEyes) && !still()) play(mood === "idle" ? "happy" : mood);   // a little flourish on a new look
    });
  } catch (_) { showMotion(true); }
  if (globalThis.VOIDY_ICONS) VOIDY_ICONS.fill();

  // Personality: idle acts, emoji bubbles, pokes, sleepiness (lib/voidy-life.js).
  const life = VOIDY_LIFE.attach(root, { mood: () => mood || "happy", eaten: () => lastTotal || 0 });
  requestAnimationFrame(() => { if (!still() && root.classList.contains("form-blackhole")) life.act("peek"); });

  globalThis.VOIDY = { feed, setMood, gulp, say, bubble: life.say, act: life.act };
})();
