/* Generic do-nothing script surrogate. Used when a watched ad script has no
 * dedicated stub: the request returns a valid 200 empty script instead of a
 * network error, which is quieter to detectors than a failed load. Bundled. */
(function () {})();
