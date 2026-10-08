// "Fix this site": the small panel Voidy shows in a corner of the page while it
// tests what broke the site (see src/fix-search.js and background.js). It asks
// "Does the site work now?" each round, then shows what it found. Everything is
// written with textContent; nothing from the page or the network is used.
//
// Clickjacking: the page can fade this frame, cover it or slide it under the
// person's clicks. So the answers that let something through (Yes, No, Allow
// just this, Ease off) only count once the panel has been on screen, uncovered
// and unchanged by the page, for ARM_MS, using Chrome's visibility tracking
// (where that doesn't exist, the pause alone applies), like the Redirect Guard.
(() => {
  const $ = (id) => document.getElementById(id);
  const send = (m) => new Promise((r) => { try { chrome.runtime.sendMessage(m, r); } catch (e) { r(null); } });
  const tell = (msg) => { try { parent.postMessage({ voidyFixPanel: msg, height: $("box").offsetHeight }, "*"); } catch (e) {} };   // the frame takes the panel's own height
  const browser = () => ((navigator.userAgent.match(/Firefox\/[\d.]+|Edg\/[\d.]+|OPR\/[\d.]+|Chrome\/[\d.]+/) || ["unknown"])[0]);
  function button(label, onClick, cls) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    return b;
  }
  function show(title, text, buttons, tone) {
    $("box").dataset.tone = tone || "";
    $("title").textContent = title; $("text").textContent = text;
    $("buttons").replaceChildren(...buttons);
    tell("height");
  }
  const busy = (label) => { for (const b of document.querySelectorAll("button")) b.disabled = true; $("text").textContent = label; };

  const ARM_MS = 600;
  let shownAt = 0, visibleSince = 0, tracked = false;
  try {
    new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!("isVisible" in en)) continue;
        tracked = true;
        visibleSince = en.isVisible ? (visibleSince || performance.now()) : 0;
      }
    }, { trackVisibility: true, delay: 100, threshold: [0, 1] }).observe($("box"));
  } catch (e) {}
  const seen = () => { const now = performance.now(); return shownAt > 0 && now - shownAt >= ARM_MS && (!tracked || (visibleSince > 0 && now - visibleSince >= ARM_MS)); };
  // Wraps a handler that lets something through: only real clicks on a panel the person can see.
  const guarded = (fn) => (e) => {
    if (e && e.isTrusted && seen()) return fn(e);
    $("note").hidden = false;
    $("note").textContent = "Voidy ignored that click: the panel had only just appeared, or something on the page was covering it.";
    tell("height");
  };

  function asking(st) {
    const answer = (works) => guarded(() => { busy("Reloading the page…"); send({ type: "fixAnswer", works }); });
    show("Voidy is testing this site", `Step ${st.round} of about ${st.of}. Does the site work now?`, [
      button("Yes", answer(true), "main"), button("No", answer(false)),
      button("Stop", async () => { busy("Stopping…"); await send({ type: "fixStop" }); tell("close"); }),
      button("Details", () => { $("details").hidden = !$("details").hidden; tell("height"); }, "link"),
    ]);
    const rows = st.pool.map((item) => {
      const row = document.createElement("div"), name = document.createElement("span");
      row.dataset.item = item; name.textContent = st.labels[item] || item;
      row.append(name, button("Allow just this", guarded(() => { busy("Saving…"); send({ type: "fixPick", item }); })));
      return row;
    });
    $("details").replaceChildren(...rows);
  }
  function found(st) {
    show(`Found it: ${st.label}.`, "Voidy keeps allowing it on this site. Everything else stays blocked.", [
      button("Share this fix", async () => {
        const note = `Fix for ${st.host}: allow ${st.label} (Voidy ${chrome.runtime.getManifest().version}, ${browser()})`;
        let copied = false;
        try { await navigator.clipboard.writeText(note); copied = true; } catch (e) {}
        if (VOIDY_LINKS.feedback) chrome.tabs.create({ url: VOIDY_LINKS.feedback });
        $("note").hidden = false;
        $("note").textContent = (copied ? "Copied: " : "Copy this: ") + note + ". Paste it into the form that opened. Nothing is sent unless you submit it.";
        tell("height");
      }, "main"),
      button("Done", async () => { await send({ type: "fixDismiss" }); tell("close"); }),
    ], "good");
  }
  function failed(st) {
    show("Voidy couldn't find one single cause.", "Two things may be needed together, or the problem isn't from Voidy.", [
      button("Ease off on this site", guarded(async () => { busy("Easing off…"); await send({ type: "easeOff", host: st.host, tabId: st.tabId }); tell("close"); }), "main"),
      button("Close", async () => { await send({ type: "fixDismiss" }); tell("close"); }),
    ], "warn");
  }
  send({ type: "getFixTest" }).then((st) => {
    if (!st) return tell("close");
    shownAt = performance.now();
    if (st.state === "asking") asking(st); else if (st.state === "found") found(st); else failed(st);
  });
})();
