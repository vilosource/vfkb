// Read the vfkb engine commit a vendored bundle was built from, off its bytes
// (vfkb#395 decide: records name `engineRev` observed, never "main tip at run time").
// Same stamp shape vfkb-claude-plugin scenarios/bundle-drift.mjs normalizes:
//   var ENGINE_COMMIT = true ? "7a9348a" : "dev";
// Returns the sha string, or null when the bundle carries no stamp (or only "dev").
export function engineRevFromBundle(text) {
  const m = /ENGINE_COMMIT\d*\s*=\s*true\s*\?\s*"([0-9a-f]{7,40})"/.exec(String(text ?? ''));
  return m ? m[1] : null;
}
