/** Times without a time zone in a tool answer (testronde 14 Oct 2026): a date with a clock time and no Z or
 * offset after it. Every hosted suite runs its answers through recordNaiveTimes (stub-vps); one hit fails the
 * process, so a tool that starts passing a site-clock time through is red in whichever suite shows it. */
const NAIVE = /\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?![\d:.]|Z|[+-]\d{2}:?\d{2})/g;
// Redirect row snapshots (before/after of a redirect item in a change history) are the database row as
// WordPress stored it, compared byte for byte by WordPress on replay; their created_at column has no
// single known clock. Shown as stored, not as a time TamRank reports.
const ROW_SNAPSHOT = /\.items\[\d+\]\.(?:result\.redirect_result\.)?(?:before|after)\.created_at$/;
export function naiveTimes(value, path = '$', hits = []) {
  if (typeof value === 'string') { if (!ROW_SNAPSHOT.test(path)) for (const m of value.match(NAIVE) ?? []) hits.push({ path, time: m }); }
  else if (Array.isArray(value)) value.forEach((v, i) => naiveTimes(v, `${path}[${i}]`, hits));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) naiveTimes(v, `${path}.${k}`, hits);
  return hits;
}
export const naiveHits = [];
export function recordNaiveTimes(toolName, result) {
  for (const h of naiveTimes(result)) naiveHits.push({ toolName, ...h });
}
process.on('exit', () => {
  if (!naiveHits.length) return;
  for (const h of naiveHits) console.error(`Time without a time zone in ${h.toolName} at ${h.path}: ${h.time}`);
  process.exitCode = 1;
});
