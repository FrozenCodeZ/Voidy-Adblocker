// Global Privacy Control (https://globalprivacycontrol.org): tells the page, in
// JavaScript, that the visitor asks not to have their data sold or shared. The
// matching request header (Sec-GPC: 1) is added by a network rule in
// background.js. Runs in the page (MAIN world) at document_start, in every frame,
// and only where the setting is on and the site isn't set to Off.
(() => {
  "use strict";
  try {
    const proto = Navigator.prototype;
    // A browser that already sends GPC keeps its own. Firefox has the property but leaves it
    // false unless its own setting is on, while Voidy's rule sends the header: make them agree.
    if ("globalPrivacyControl" in proto && navigator.globalPrivacyControl === true) return;
    const getter = { get globalPrivacyControl() { return true; } };
    Object.defineProperty(proto, "globalPrivacyControl", { ...Object.getOwnPropertyDescriptor(getter, "globalPrivacyControl"), enumerable: true, configurable: true });
  } catch (_) {}
})();
