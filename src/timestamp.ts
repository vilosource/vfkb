// Timestamp ordering for `created` / `updated` (vfkb#374).
//
// The engine writes `YYYY-MM-DDTHH:MM:SS.sssZ` (nowIso), and for that one shape string order
// IS time order. An imported or hand-made value without milliseconds, or with an offset, is
// not: "…10:00:00Z" sorts after "…10:00:00.500Z" ('Z' > '.'), and "…12:00:00+03:00" (09:00Z)
// sorts after "…10:00:00Z". Every comparison that decides an ordering (the pin, the retire
// check, last-write-wins in materialize, recency tiebreaks) goes through this one comparator.
//
// The stored values are never rewritten: pin staleness matches the raw `created` text
// (pin-staleness.ts), so normalising on read would break that lookup.

/** Negative if `a` is earlier than `b`, positive if later, 0 for the same instant. When either
 *  side does not parse as a date, falls back to the old string order, so nothing that sorted
 *  before can now throw or become unordered. */
export function compareTimestamps(a: string | undefined, b: string | undefined): number {
  const x = a ?? '';
  const y = b ?? '';
  const ta = Date.parse(x);
  const tb = Date.parse(y);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return x < y ? -1 : x > y ? 1 : 0;
}
