/*
 * Surrogate for Google Analytics (google-analytics.com/analytics.js and ga.js).
 * Provides window.ga as a no-op that still runs the ready callback, so page
 * code that does ga(function(){...}) doesn't hang. No hits are ever sent.
 * Project-maintained compatibility stub. Bundled; it sends no analytics hits.
 */
(function () {
  "use strict";
  const noopfn = function () {};

  function ga() {
    const len = arguments.length;
    if (len === 0) return;
    const last = arguments[len - 1];
    let fn;
    if (typeof last === "object" && last !== null && typeof last.hitCallback === "function") {
      fn = last.hitCallback;
    } else if (typeof last === "function") {
      // ga(function(tracker){...}) — call with a stub tracker
      fn = function () { last(Tracker()); };
    }
    try { if (fn) fn(); } catch (e) {}
  }
  ga.create = function () { return Tracker(); };
  ga.getByName = function () { return Tracker(); };
  ga.getAll = function () { return []; };
  ga.remove = noopfn;
  ga.loaded = true;
  ga.q = [];

  function Tracker() {
    return {
      get: noopfn, set: noopfn, send: noopfn,
      requireSync: noopfn, require: noopfn, provide: noopfn,
    };
  }

  const name = window.GoogleAnalyticsObject || "ga";
  window[name] = ga;
  window.ga = ga;

  // gtag.js path
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== "function") {
    window.gtag = function () { try { window.dataLayer.push(arguments); } catch (e) {} };
  }
})();
