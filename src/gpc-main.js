// Global Privacy Control (https://globalprivacycontrol.org): tells the page, in
// JavaScript, that the visitor asks not to have their data sold or shared. The
// matching request header (Sec-GPC: 1) is added by a network rule in
// background.js. Runs in the page (MAIN world) at document_start, in every frame,
// and only where the setting is on and the site isn't set to Off.
(() => {
  "use strict";
  try {
    const proto = Navigator.prototype;
    if ("globalPrivacyControl" in proto) return;            // a browser that already has it keeps its own
    const getter = { get globalPrivacyControl() { return true; } };
    Object.defineProperty(proto, "globalPrivacyControl", { ...Object.getOwnPropertyDescriptor(getter, "globalPrivacyControl"), enumerable: true, configurable: true });
  } catch (_) {}
})();
