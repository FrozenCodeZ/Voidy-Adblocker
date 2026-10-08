// Smarter ad hiding: list rules that plain CSS can't express, such as
// "hide the post that contains the word Sponsored". ISOLATED world, loaded
// before annoyances.js, which hands it the rules for this site.
//   A:has-text(Sponsored)     A elements whose text contains "Sponsored" (or /regex/)
//   A:has-visible-text(x)     same, but only the text shown on screen, so letters a
//                             site hides inside a label can't break the match (short
//                             elements only: labels, not whole posts)
//   A:-abp-contains(text)     same, older spelling
//   A:has(B:has-text(x))      A that contains such a B (plain :has() stays CSS)
//   A:upward(2) / A:upward(B) the element 2 levels up / the nearest B above A
// Only site-specific rules use this, so the work stays small.
globalThis.VOIDY_PROC = (() => {
  // ---- Settings ------------------------------------------------------------
  const RECHECK_MS = 600;           // at most one re-check this often while the page changes
  const MAX_RULES = 300;
  // --------------------------------------------------------------------------
  const PROC = /:(has-visible-text|has-text|-abp-contains|upward)\(/;
  const OP = /^:(has-visible-text|has-text|-abp-contains|-abp-has|has|upward)\(/;
  const LABEL_MAX = 60;             // :has-visible-text only reads elements this short (by their raw text)
  const isProcedural = (sel) => PROC.test(sel);

  function closeParen(s, open) {
    let depth = 0, quote = "";
    for (let i = open; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") { i++; continue; }
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'") quote = c;
      else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return i;
    }
    return -1;
  }
  function textTest(arg) {
    arg = arg.trim().replace(/^(["'])(.*)\1$/, "$2");
    const re = /^\/(.+)\/([imsu]*)$/.exec(arg);
    if (re) { const r = new RegExp(re[1], re[2]); return (t) => r.test(t); }
    return (t) => t.includes(arg);
  }
  // "A:has-text(x) > b" -> [{css:"A"}, {text}, {css:" > b"}]
  function parse(sel, nested) {
    const steps = [];
    let css = "";
    for (let i = 0; i < sel.length;) {
      const c = sel[i];
      if (c === "[" || c === '"' || c === "'") {
        const end = c === "[" ? sel.indexOf("]", i) : sel.indexOf(c, i + 1);
        if (end < 0) throw new Error("unclosed");
        css += sel.slice(i, end + 1); i = end + 1; continue;
      }
      const m = c === ":" && OP.exec(sel.slice(i));
      if (!m) { css += c; i++; continue; }
      const open = i + m[0].length - 1, close = closeParen(sel, open);
      if (close < 0) throw new Error("unclosed");
      const name = m[1], arg = sel.slice(open + 1, close);
      i = close + 1;
      if ((name === "has" || name === "-abp-has") && !isProcedural(arg)) { css += ":has(" + arg + ")"; continue; }
      if (css.trim()) steps.push({ css });
      css = "";
      if (name === "has-text" || name === "-abp-contains") steps.push({ text: textTest(arg) });
      else if (name === "has-visible-text") steps.push({ text: textTest(arg), visible: true });
      else if (name === "upward") steps.push({ up: /^\s*\d+\s*$/.test(arg) ? +arg : arg.trim() });
      else steps.push({ has: parse(arg.trim(), true) });
    }
    if (css.trim()) steps.push({ css });
    if (nested && steps.length && !steps[0].css) steps.unshift({ css: "*" });   // ":has(:has-text(x))" = any descendant
    if (!steps.length || !steps[0].css) throw new Error("needs a starting selector");
    return steps;
  }
  const all = (root, sel) => { try { return [...root.querySelectorAll(sel)]; } catch (_) { return []; } };
  function run(steps, ctx) {
    let els = null;
    for (const st of steps) {
      if (st.css) {
        const s = st.css.trim();
        if (els === null) els = ctx ? all(ctx, ":scope " + s) : all(document, s);
        else if (/^[>\s]/.test(st.css)) els = els.flatMap((e) => all(e, ":scope " + s));
        else if (/^[+~]/.test(s)) return [];                       // sibling steps: not supported
        else els = els.filter((e) => { try { return e.matches(s); } catch (_) { return false; } });
      } else if (st.text && st.visible) els = els.filter((e) => (e.textContent || "").length <= LABEL_MAX && st.text(e.innerText || ""));
      else if (st.text) els = els.filter((e) => st.text(e.textContent || ""));
      else if (st.has) els = els.filter((e) => run(st.has, e).length > 0);
      else if (typeof st.up === "number") els = els.map((e) => { for (let n = st.up; e && n > 0; n--) e = e.parentElement; return e; }).filter(Boolean);
      else els = els.map((e) => { try { return e.parentElement && e.parentElement.closest(st.up); } catch (_) { return null; } }).filter(Boolean);
      if (!els.length) return els;
    }
    return els || [];
  }

  const rules = [], hidden = new WeakSet(), counts = {};
  let timer = null, observer = null, onChange = () => {};
  function apply() {
    timer = null;
    let changed = false;
    for (const r of rules) for (const el of run(r.steps, null)) {
      if (hidden.has(el) || el === document.body || el === document.documentElement) continue;
      hidden.add(el);
      el.style.setProperty("display", "none", "important");
      counts[r.cat] = (counts[r.cat] || 0) + 1;
      changed = true;
    }
    if (changed) onChange();
  }
  const schedule = () => { if (!timer) timer = setTimeout(apply, RECHECK_MS); };
  function add(cat, sel) {
    if (rules.length >= MAX_RULES) return false;
    try { rules.push({ cat, steps: parse(sel) }); } catch (_) { return false; }
    if (!observer) {
      observer = new MutationObserver(schedule);
      const go = () => { observer.observe(document.documentElement, { childList: true, subtree: true }); apply(); };
      document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", go, { once: true }) : go();
    } else schedule();
    return true;
  }
  return { isProcedural, parse, run, add, counts, onChange: (fn) => { onChange = fn; } };
})();
