// The guided "Fix this site" search, as plain data in and out (no browser calls).
// Candidates are what Voidy did on a page: blocked host names, plus "#hiding"
// (page hiding) and "#scripts" (Voidy's page scripts). Each round lets the
// `trying` half through and asks "Works now?":
//   Yes: the cause is in `trying`; keep halving it.
//   No:  the cause is in the rest.
// The last candidate standing is only the answer once it got a Yes while tried
// alone; otherwise there is no single cause (two things needed, or something
// Voidy didn't do), and the search fails.
globalThis.VOIDY_FIXSEARCH = (() => {
  const MAX_ROUNDS = 7;
  const half = (list) => list.slice(0, Math.ceil(list.length / 2));
  const fail = (s) => ({ ...s, trying: [], done: false, culprit: null, failed: true });

  function start(candidates) {
    const pool = [...new Set(candidates)];
    const s = { pool, trying: half(pool), rounds: 1, done: false, culprit: null, failed: false };
    return pool.length ? s : fail(s);
  }
  function answer(s, works) {
    if (s.done || s.failed) return s;
    if (works && s.trying.length === 1) return { ...s, pool: s.trying.slice(), done: true, culprit: s.trying[0] };
    const pool = works ? s.trying.slice() : s.pool.filter((c) => !s.trying.includes(c));
    if (!pool.length) return fail({ ...s, pool });
    const next = { ...s, pool, trying: pool.length === 1 ? pool.slice() : half(pool), rounds: s.rounds + 1 };
    return next.rounds > MAX_ROUNDS ? fail(next) : next;
  }
  return { start, answer, MAX_ROUNDS };
})();
