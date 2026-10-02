/*
 * Surrogate for Google Tag Manager (googletagmanager.com/gtm.js and /gtag/js).
 * Keeps window.dataLayer working as a plain array and defines gtag, so page
 * code that pushes events doesn't throw. Nothing is transmitted. Bundled.
 */
(function () {
  "use strict";
  window.dataLayer = window.dataLayer || [];
  // Keep .push as the native array push so page code reading dataLayer state
  // (e.g. consent frameworks) still sees its own entries — we just never load
  // the real GTM container that would act on them.
  if (typeof window.gtag !== "function") {
    window.gtag = function () { try { window.dataLayer.push(arguments); } catch (e) {} };
  }
})();
