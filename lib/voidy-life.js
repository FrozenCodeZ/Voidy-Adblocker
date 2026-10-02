// Voidy's personality: little acts it does on its own (looks around, winks,
// sips coffee, puts on sunglasses…), emoji bubbles that change with its
// mood, reactions to pokes, getting sleepy when ignored, and a few easter
// eggs. Pure decoration. Needs lib/voidy.css ("act-*" classes).
//   VOIDY_LIFE.attach(voidyElement, { mood: () => "happy", eaten: () => 0 })
(() => {
  // ---- Settings you can play with ----------------------------------------
  const ACT_EVERY_MS = [5000, 11000];   // random gap between idle acts
  const SLEEPY_AFTER_MS = 30000;        // no mouse movement for this long -> sleepy
  const LONG_SHIFT_MS = 2 * 3600e3;     // happy/Full mode this long -> yawns more
  const GLITCH_CHANCE = 0.04;           // rare glitch on an idle tick
  // -------------------------------------------------------------------------
  const ACT_MS = { look: 2400, wink: 1000, shades: 3200, coffee: 3400, stretch: 1300, giggle: 900, yawn: 2200,
    dizzy: 1800, love: 1600, full: 1800, startle: 700, glitch: 1000, greet: 1650, "eye-roll": 1500, peek: 1500 };
  const IDLE = {
    happy: ["look", "wink", "shades", "coffee", "stretch", "greet", "eye-roll", "look", "bubble"],
    lite: ["look", "coffee", "greet", "stretch", "bubble"],
    stealth1: ["look", "bubble"], stealth2: ["look", "bubble"], stealth3: ["bubble"],
    off: ["bubble"], idle: ["bubble"],
  };
  const EMOJI = {
    happy: ["😋", "✨", "🍩 nom", "😎", "🌌", "💜", "🛸?", "ads? gone.", "🫧"],
    lite: ["🍃", "☺️", "🌙", "just a snack"],
    stealth1: ["😎", "🕶️", "shh…", "nothing to see"],
    stealth2: ["🫥", "👻", "can't see me"],
    stealth3: ["🥷", "🤫", "…"],
    off: ["💤", "zzz…", "😴"], idle: ["💤", "zzz…", "🌙"],
  };
  const POKE = ["hehe", "😆", "✨", "🤭", "boop!", "hi!", "💫"];
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = list => list[Math.floor(Math.random() * list.length)];
  const still = () => document.documentElement.classList.contains("still");

  function attach(root, opts = {}) {
    const mood = () => (opts.mood ? opts.mood() : "happy");
    const bubbleEl = root.querySelector(".v-bubble");
    let busy = false, actTimer = 0, bubbleTimer = 0, lastMove = Date.now(), sleepy = false, happySince = null;

    function say(text, ms = 2600) {
      if (!bubbleEl || still()) return;
      bubbleEl.textContent = text;
      bubbleEl.style.setProperty("--bubble-ms", ms + "ms");
      bubbleEl.classList.remove("show"); void bubbleEl.offsetWidth; bubbleEl.classList.add("show");
      clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => bubbleEl.classList.remove("show"), ms);
    }
    function act(name, text) {
      if (still() || !ACT_MS[name]) return false;
      if (busy && name !== "startle") return false;
      busy = true;
      root.classList.add("act-" + name);
      if (text) say(text, Math.max(1800, ACT_MS[name]));
      clearTimeout(actTimer);
      actTimer = setTimeout(() => { root.classList.remove("act-" + name); busy = false; }, ACT_MS[name]);
      return true;
    }
    // A poke is the user talking to Voidy: stop whatever it's doing.
    function interrupt() {
      for (const c of [...root.classList]) if (c.startsWith("act-")) root.classList.remove(c);
      clearTimeout(actTimer); busy = false;
    }
    // The popup's mode-switch animations ("t-*" classes) take priority.
    const transitioning = () => [...root.classList].some(c => c.startsWith("t-") || c === "charging");

    function tick() {
      setTimeout(() => {
        tick();
        if (still() || document.hidden || busy || transitioning()) return;
        const m = mood();
        if (sleepy) { say(pick(["💤", "zzz…"])); return; }
        if (Math.random() < GLITCH_CHANCE && m !== "off" && m !== "idle") { act("glitch", pick(["ERR_V0ID", "01101110?", "*bzzt*"])); return; }
        const eaten = opts.eaten ? opts.eaten() : 0;
        if (m === "happy" && eaten >= 30 && Math.random() < .25) { act("full", "so full 😮‍💨"); return; }
        if (m === "happy" && happySince && Date.now() - happySince > LONG_SHIFT_MS && Math.random() < .3) { act("yawn", "long shift… 🥱"); return; }
        const choice = pick(IDLE[m] || IDLE.happy);
        if (choice === "bubble") say(pick(EMOJI[m] || EMOJI.happy));
        else act(choice, choice === "coffee" ? "☕" : choice === "shades" ? "😎" : null);
      }, rand(...ACT_EVERY_MS));
    }
    tick();

    // Sleepy when ignored; startled awake by the mouse.
    document.addEventListener("pointermove", () => {
      lastMove = Date.now();
      if (!sleepy) return;
      sleepy = false; root.classList.remove("sleepy");
      act("startle", "❗");
    });
    setInterval(() => {
      const m = mood();
      if (!sleepy && !still() && !["off", "idle", "stealth3"].includes(m) && Date.now() - lastMove > SLEEPY_AFTER_MS) {
        if (act("yawn", "🥱")) setTimeout(() => { sleepy = true; root.classList.add("sleepy"); }, ACT_MS.yawn);
      }
    }, 3000);

    // Remember how long Voidy has been in its happy (Full/Auto) mood.
    try {
      chrome.storage.local.get({ voidyHappySince: null }, s => { happySince = s.voidyHappySince; });
      setInterval(() => {
        const happy = mood() === "happy";
        if (happy && !happySince) { happySince = Date.now(); chrome.storage.local.set({ voidyHappySince: happySince }); }
        if (!happy && happySince) { happySince = null; chrome.storage.local.set({ voidyHappySince: null }); }
      }, 4000);
    } catch (_) {}

    // Pokes: 1 = giggle, 3 fast = dizzy, 7 fast = barrel roll. Double-click = love.
    let pokes = 0, pokeTimer = 0;
    root.addEventListener("click", () => {
      pokes++; clearTimeout(pokeTimer); pokeTimer = setTimeout(() => (pokes = 0), 1400);
      if (still()) return;
      interrupt();
      if (sleepy) { sleepy = false; root.classList.remove("sleepy"); act("startle", "❗ I'm up!"); return; }
      if (pokes === 7) {
        pokes = 0;
        root.classList.remove("dizzy"); void root.offsetWidth; root.classList.add("dizzy");
        say("Wheee! 😵‍💫", 2200); return;
      }
      if (pokes === 3) { act("dizzy", "@_@"); return; }
      if (pokes === 1) act("giggle", pick(POKE));
    });
    root.addEventListener("dblclick", () => { interrupt(); act("love", "💖"); });
    root.addEventListener("animationend", e => { if (e.animationName === "v-roll") root.classList.remove("dizzy"); });
    // Type "void" anywhere: Voidy glitches.
    let typed = "";
    document.addEventListener("keydown", e => {
      typed = (typed + (e.key || "")).slice(-4).toLowerCase();
      if (typed === "void") { interrupt(); act("glitch", "V̸O̷I̶D̵"); }
    });
    return { say, act };
  }
  globalThis.VOIDY_LIFE = { attach };
})();
