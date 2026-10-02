// Decorative space scenery behind the popup and dashboard: twinkling stars,
// drifting nebula clouds, a spinning galaxy, a tilted solar system, the Pleiades
// star cluster, shooting stars, a passing comet and a rare UFO. Pure
// decoration: nothing here reads or sends data. Respects html.still.
(() => {
  // ---- Settings you can play with ----------------------------------------
  const SPARKLES = 16;                      // twinkling 4-point stars
  const SHOOTING_EVERY_MS = [2500, 7000];   // random gap between shooting stars
  const COMET_EVERY_MS = [18000, 35000];    // random gap between slow comets
  const UFO_CHANCE = 0.25;                  // chance a UFO visits (per page open)
  const PARALLAX_PX = 10;                   // how far scenery shifts with the mouse
  // -------------------------------------------------------------------------
  const body = document.body;
  if (!body || !body.classList.contains("cosmos")) return;
  const still = () => document.documentElement.classList.contains("still");
  const rand = (a, b) => a + Math.random() * (b - a);
  const layer = document.createElement("div");
  layer.className = "cosmos-deco";
  layer.setAttribute("aria-hidden", "true");

  const STAR = "M0 -6 L1.3 -1.3 L6 0 L1.3 1.3 L0 6 L-1.3 1.3 L-6 0 L-1.3 -1.3 Z";
  let html = `<i class="cd-cloud c1"></i><i class="cd-cloud c2"></i>`;
  for (let i = 0; i < SPARKLES; i++) {
    html += `<svg class="cd-spark" viewBox="-6 -6 12 12" style="left:${rand(2, 96).toFixed(1)}%;top:${rand(2, 96).toFixed(1)}%;` +
      `--s:${rand(.5, 1.3).toFixed(2)};animation-delay:${rand(0, 5).toFixed(2)}s;animation-duration:${rand(2.2, 4.8).toFixed(2)}s"><path d="${STAR}"/></svg>`;
  }
  // spiral galaxy: two arms of dots around a glowing core
  let arms = "";
  for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 28; i++) {
    const t = i / 28, a = arm * Math.PI + t * 4.4, r = 5 + t * 42;
    arms += `<circle cx="${(50 + r * Math.cos(a)).toFixed(1)}" cy="${(50 + r * Math.sin(a)).toFixed(1)}" r="${(1.8 - t * 1.1).toFixed(2)}" ` +
      `style="animation-delay:${(t * 3).toFixed(2)}s" opacity="${(1 - t * .6).toFixed(2)}"/>`;
  }
  html += `<div class="cd-p cd-galaxy-wrap"><svg class="cd-galaxy" viewBox="0 0 100 100"><defs><radialGradient id="cd-core"><stop offset="0" stop-color="#fff"/>
    <stop offset=".35" stop-color="var(--a2)"/><stop offset="1" stop-color="var(--a1)" stop-opacity="0"/></radialGradient></defs>
    <circle cx="50" cy="50" r="46" fill="url(#cd-core)" opacity=".22"/><g class="cd-arms">${arms}</g><circle class="cd-core" cx="50" cy="50" r="8" fill="url(#cd-core)"/></svg></div>`;
  // tilted solar system: a pulsing sun, three planets, one with a moon
  html += `<div class="cd-p cd-system-wrap"><div class="cd-system"><i class="cd-sun"></i>
    <i class="cd-orbit" style="--d:22px;--t:5s"><b class="cd-planet p0"></b></i>
    <i class="cd-orbit" style="--d:38px;--t:9s"><b class="cd-planet p1"><i class="cd-moon"></i></b></i>
    <i class="cd-orbit" style="--d:56px;--t:15s"><b class="cd-planet p2"></b></i></div></div>`;
  // the Pleiades (Seven Sisters): Alcyone, Atlas, Electra, Maia, Merope, Taygeta, Pleione, Celaeno
  const SISTERS = [[44, 50, 1.3], [22, 52, 1], [64, 46, .95], [60, 32, .9], [54, 64, .85], [74, 26, .75], [18, 44, .6], [72, 38, .55]];
  const SPIKE = "M0 -7 L.8 -.8 L7 0 L.8 .8 L0 7 L-.8 .8 L-7 0 L-.8 -.8 Z";
  html += `<div class="cd-p cd-pleiades-wrap"><svg class="cd-pleiades" viewBox="0 0 100 80"><ellipse class="haze" cx="46" cy="46" rx="34" ry="22"/>
    <polyline class="line" points="22,52 44,50 64,46 60,32 74,26" pathLength="100"/><polyline class="line" points="44,50 54,64" pathLength="100"/>${
    SISTERS.map(([x, y, s], i) => `<g class="sis" style="animation-delay:${(i * .45).toFixed(2)}s"><path d="${SPIKE}" transform="translate(${x} ${y}) scale(${s})"/></g>`).join("")}</svg></div>`;
  layer.innerHTML = html;
  body.prepend(layer);

  // ---- gentle parallax: nearer things move more --------------------------
  document.addEventListener("pointermove", e => {
    if (still()) return;
    layer.style.setProperty("--mx", ((e.clientX / innerWidth) - .5).toFixed(3));
    layer.style.setProperty("--my", ((e.clientY / innerHeight) - .5).toFixed(3));
  });
  layer.style.setProperty("--pp", PARALLAX_PX + "px");

  // ---- shooting stars ----------------------------------------------------
  function shoot(delay = 0) {
    const s = document.createElement("i");
    s.className = "cd-shoot";
    s.style.left = rand(25, 105) + "%"; s.style.top = rand(-5, 50) + "%";
    s.style.setProperty("--len", rand(70, 150).toFixed(0) + "px");
    // Fly down-left along the streak's own angle: head in front, trail behind.
    const ang = rand(-42, -18), dist = rand(260, 380), rad = ang * Math.PI / 180;
    s.style.setProperty("--ang", ang.toFixed(1) + "deg");
    s.style.setProperty("--tx", (-dist * Math.cos(rad)).toFixed(0) + "px");
    s.style.setProperty("--ty", (-dist * Math.sin(rad)).toFixed(0) + "px");
    s.style.setProperty("--dur", rand(.8, 1.4).toFixed(2) + "s");
    s.style.animationDelay = delay + "ms";
    s.addEventListener("animationend", () => s.remove());
    layer.appendChild(s);
  }
  function comet() {
    const c = document.createElement("i");
    c.className = "cd-comet";
    c.style.top = rand(5, 55) + "%";
    c.addEventListener("animationend", () => c.remove());
    layer.appendChild(c);
  }
  function every([a, b], fn) {
    (function loop() { setTimeout(() => { if (!still() && !document.hidden) fn(); loop(); }, rand(a, b)); })();
  }
  every(SHOOTING_EVERY_MS, () => { shoot(); if (Math.random() < .3) shoot(rand(150, 400)); });
  every(COMET_EVERY_MS, comet);
  setTimeout(() => { if (!still()) shoot(); }, 900);          // one soon after opening

  // ---- rare UFO visitor (click it) ---------------------------------------
  if (Math.random() < UFO_CHANCE) setTimeout(() => {
    if (still()) return;
    const u = document.createElement("button");
    u.className = "cd-ufo"; u.type = "button"; u.title = "?";
    u.innerHTML = `<svg viewBox="0 0 40 30"><path class="beam" d="M14 18 L6 30 H34 L26 18 Z"/><ellipse cx="20" cy="9" rx="8" ry="7" class="dome"/>
      <ellipse cx="20" cy="14" rx="18" ry="5.5" class="hull"/><circle cx="10" cy="14.5" r="1.3" class="l"/><circle cx="20" cy="15.5" r="1.3" class="l"/><circle cx="30" cy="14.5" r="1.3" class="l"/></svg>`;
    u.addEventListener("click", () => {
      u.classList.add("zap");
      globalThis.VOIDY?.say?.("👽 Beep boop. The UFO says hi to Voidy!");
      try { chrome.storage.local.get({ ufoSightings: 0 }, s => chrome.storage.local.set({ ufoSightings: (s.ufoSightings || 0) + 1 })); } catch (_) {}
    });
    u.addEventListener("animationend", e => { if (e.animationName === "cd-ufo" || e.animationName === "cd-zap") u.remove(); });
    body.appendChild(u);
  }, rand(4000, 15000));

  // ---- Konami code: a meteor shower --------------------------------------
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let typed = 0;
  document.addEventListener("keydown", e => {
    typed = e.key === KONAMI[typed] ? typed + 1 : e.key === KONAMI[0] ? 1 : 0;
    if (typed < KONAMI.length) return;
    typed = 0;
    for (let i = 0; i < 28; i++) shoot(i * 110);
    globalThis.VOIDY?.say?.("☄️ Meteor shower! Voidy is thrilled.");
  });
  globalThis.VOIDY_COSMOS = { shoot, comet };
})();
