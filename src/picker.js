// "Hide something on this page": point at a leftover ad box, click it, and
// Voidy hides it on this site from now on. Injected by the popup only when you
// ask for it. Everything it draws lives in a closed shadow root, so the page
// can't see or restyle it. Esc cancels.
(() => {
  // ---- Settings ------------------------------------------------------------
  const ACCENT = "#9b74ff";
  const MAX_SELECTOR = 400;          // longer selectors are almost certainly too specific
  const UNDO_MS = 8000;
  // --------------------------------------------------------------------------
  if (globalThis.__voidyPicker) { globalThis.__voidyPicker.focus(); return; }

  const host = document.createElement("voidy-picker");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = `<style>
    *{box-sizing:border-box;font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif}
    .box{position:fixed;border:2px solid ${ACCENT};background:rgba(155,116,255,.18);border-radius:4px;pointer-events:none;
      box-shadow:0 0 0 9999px rgba(12,6,24,.28);transition:all .08s ease-out;display:none}
    .tag{position:fixed;background:${ACCENT};color:#fff;font-size:11px;padding:1px 6px;border-radius:4px;pointer-events:none;display:none;max-width:60vw;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .panel{position:fixed;right:16px;bottom:16px;width:min(340px,calc(100vw - 32px));background:#1b1230;color:#f4efff;border:1px solid #4b3a78;
      border-radius:14px;padding:12px 14px;pointer-events:auto;box-shadow:0 18px 40px -12px rgba(0,0,0,.6)}
    .panel b{font-weight:700}
    .hint{color:#c9bde6;margin:4px 0 8px}
    code{display:block;font:11px/1.4 ui-monospace,Consolas,monospace;background:#0f0a1e;border:1px solid #3a2d60;border-radius:8px;padding:6px 8px;
      word-break:break-all;max-height:64px;overflow:auto;color:#e6dcff}
    .row{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap;align-items:center}
    button{border:1px solid #4b3a78;background:#2a1d48;color:#f4efff;border-radius:9px;padding:6px 10px;cursor:pointer}
    button:hover{border-color:${ACCENT}}
    button.go{background:linear-gradient(135deg,${ACCENT},#ec6eb4);border:0;font-weight:700}
    button:disabled{opacity:.45;cursor:default}
    .n{color:#c9bde6;font-size:12px;margin-left:auto}
    .toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:#1b1230;color:#f4efff;border:1px solid #4b3a78;border-radius:12px;
      padding:9px 12px;pointer-events:auto;display:flex;gap:10px;align-items:center;box-shadow:0 12px 30px -10px rgba(0,0,0,.6)}
  </style>
  <div class="box"></div><div class="tag"></div>
  <div class="panel" role="dialog" aria-label="Hide an element">
    <b>Hide something on this page</b>
    <div class="hint" data-hint>Point at an ad or box and click it. Press Esc to cancel.</div>
    <div data-chosen hidden>
      <code data-sel></code>
      <div class="row">
        <button data-bigger title="Select the box around it">Bigger</button>
        <button data-smaller title="Select a smaller part">Smaller</button>
        <span class="n" data-count></span>
      </div>
    </div>
    <div class="row">
      <button class="go" data-hide disabled>Hide it</button>
      <button data-again hidden>Pick again</button>
      <button data-cancel>Cancel</button>
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const box = $(".box"), tag = $(".tag"), panel = $(".panel");
  let picking = true, chosen = null, chain = [], depth = 0;

  // A selector that finds this element again after a reload: an id if it looks
  // hand-written, otherwise tag + meaningful classes, anchored to the nearest
  // named ancestor when that alone is too vague.
  const generated = (name) => /\d{3,}|^[a-z]{1,2}\d|[A-Z0-9]{6,}|^(css|sc|jsx|svelte|emotion)-/i.test(name) || name.length > 32;
  const esc = (s) => CSS.escape(s);
  function part(el) {
    const tagName = el.localName;
    if (el.id && !generated(el.id)) return "#" + esc(el.id);
    const classes = [...el.classList].filter((c) => !generated(c)).slice(0, 3);
    let s = tagName + classes.map((c) => "." + esc(c)).join("");
    if (!classes.length) {
      const same = el.parentElement ? [...el.parentElement.children].filter((c) => c.localName === tagName) : [];
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return s;
  }
  function selectorFor(el) {
    const parts = [];
    for (let cur = el; cur && cur !== document.documentElement && parts.length < 5; cur = cur.parentElement) {
      parts.unshift(part(cur));
      const sel = parts.join(" > ");
      let n = 0; try { n = document.querySelectorAll(sel).length; } catch (_) { break; }
      if (parts[0].startsWith("#") || (n >= 1 && n <= 12 && /[.#]/.test(sel))) return sel;
    }
    return parts.join(" > ");
  }
  const matches = (sel) => { try { return document.querySelectorAll(sel).length; } catch (_) { return 0; } };

  function outline(el) {
    if (!el || !el.getBoundingClientRect) { box.style.display = tag.style.display = "none"; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    tag.textContent = part(el) + `  ${Math.round(r.width)}×${Math.round(r.height)}`;
    Object.assign(tag.style, { display: "block", left: Math.max(4, r.left) + "px", top: Math.max(4, r.top - 20) + "px" });
  }
  const pageElement = (e) => {
    const el = e.composedPath ? e.composedPath().find((n) => n instanceof Element && n !== host) : e.target;
    return el && el !== document.documentElement && el !== document.body ? el : null;
  };
  function onMove(e) { if (picking && !e.composedPath().includes(host)) outline(pageElement(e)); }
  function onClick(e) {
    if (e.composedPath().includes(host)) return;          // our own panel
    e.preventDefault(); e.stopImmediatePropagation();
    if (!picking) return;
    const el = pageElement(e);
    if (!el) return;
    chain = []; for (let c = el; c && c !== document.body && c !== document.documentElement; c = c.parentElement) chain.push(c);
    depth = 0; choose();
  }
  function choose() {
    picking = false; chosen = chain[depth];
    const sel = selectorFor(chosen);
    $("[data-sel]").textContent = sel;
    const n = matches(sel);
    $("[data-count]").textContent = n === 1 ? "1 match" : n + " matches";
    $("[data-chosen]").hidden = false; $("[data-again]").hidden = false;
    $("[data-hint]").textContent = "Use Bigger or Smaller until the whole ad is outlined.";
    $("[data-hide]").disabled = !n || sel.length > MAX_SELECTOR;
    $("[data-bigger]").disabled = depth >= chain.length - 1;
    $("[data-smaller]").disabled = depth === 0;
    outline(chosen);
  }
  function stop() {
    removeEventListener("mousemove", onMove, true); removeEventListener("click", onClick, true);
    removeEventListener("mousedown", swallow, true); removeEventListener("mouseup", swallow, true);
    removeEventListener("keydown", onKey, true);
    host.remove(); delete globalThis.__voidyPicker;
  }
  function swallow(e) { if (!e.composedPath().includes(host)) { e.preventDefault(); e.stopImmediatePropagation(); } }
  function onKey(e) { if (e.key === "Escape") { e.preventDefault(); stop(); } }

  function hide() {
    const sel = $("[data-sel]").textContent, site = location.hostname;
    const style = document.createElement("style");
    style.textContent = sel + "{display:none!important}";
    (document.head || document.documentElement).appendChild(style);
    chrome.runtime.sendMessage({ type: "addMyHide", host: site, selector: sel }, () => void chrome.runtime.lastError);
    panel.remove(); box.remove(); tag.remove();
    removeEventListener("mousemove", onMove, true); removeEventListener("click", onClick, true);
    removeEventListener("mousedown", swallow, true); removeEventListener("mouseup", swallow, true);
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span>Voidy ate it. It stays hidden on <b></b>.</span><button>Undo</button>`;
    toast.querySelector("b").textContent = site;
    toast.querySelector("button").addEventListener("click", () => {
      style.remove();
      chrome.runtime.sendMessage({ type: "removeMyHide", host: site, selector: sel }, () => void chrome.runtime.lastError);
      stop();
    });
    root.appendChild(toast);
    setTimeout(stop, UNDO_MS);
  }

  $("[data-hide]").addEventListener("click", hide);
  $("[data-cancel]").addEventListener("click", stop);
  $("[data-again]").addEventListener("click", () => { picking = true; $("[data-chosen]").hidden = true; $("[data-again]").hidden = true;
    $("[data-hide]").disabled = true; $("[data-hint]").textContent = "Point at an ad or box and click it. Press Esc to cancel."; });
  $("[data-bigger]").addEventListener("click", () => { if (depth < chain.length - 1) { depth++; choose(); } });
  $("[data-smaller]").addEventListener("click", () => { if (depth > 0) { depth--; choose(); } });
  addEventListener("mousemove", onMove, true);
  addEventListener("click", onClick, true);
  addEventListener("mousedown", swallow, true);
  addEventListener("mouseup", swallow, true);
  addEventListener("keydown", onKey, true);
  (document.body || document.documentElement).appendChild(host);
  // Opened from the right-click menu: start with the clicked element chosen.
  const pre = globalThis.__voidyPreselect;
  delete globalThis.__voidyPreselect;
  if (pre instanceof Element && pre.isConnected && pre !== document.body && pre !== document.documentElement) {
    chain = []; for (let c = pre; c && c !== document.body && c !== document.documentElement; c = c.parentElement) chain.push(c);
    depth = 0; choose();
  }
  globalThis.__voidyPicker = { focus: () => panel.scrollIntoView && panel.querySelector("button").focus() };
})();
