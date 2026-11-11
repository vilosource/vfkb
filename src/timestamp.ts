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
//
// Only ISO 8601 values are read as instants. `Date.parse` alone is not enough: it reads a
// zone-less date-time as LOCAL time, so two clones in different timezones would order the
// same brain differently (#460 review M-1), and it accepts non-dates such as "1" or
// "hello 2026". A zone-less date-time is read as UTC; anything that is not ISO keeps the old
// string order.
const ISO = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?)?$/i;

/** The instant an ISO 8601 value names, read as UTC when it carries no zone; NaN otherwise. */
export function timestampMs(s: string): number {
  const m = ISO.exec(s);
  if (!m) return NaN;
  const [, date, time, zone] = m;
  if (!time) return Date.parse(`${date}T00:00:00Z`);
  const z = zone === undefined ? 'Z' : /^[+-]\d{4}$/.test(zone) ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone;
  return Date.parse(`${date}T${time}${z}`);
}

/** Negative if `a` is earlier than `b`, positive if later, 0 for the same instant. When either
 *  side is not an ISO timestamp, falls back to the old string order, so nothing that sorted
 *  before can now throw or become unordered. */
export function compareTimestamps(a: string | undefined, b: string | undefined): number {
  const x = a ?? '';
  const y = b ?? '';
  const ta = timestampMs(x);
  const tb = timestampMs(y);
  if (Number.isFinite(ta) && Number.isFinite(tb)) return ta - tb;
  return x < y ? -1 : x > y ? 1 : 0;
}
