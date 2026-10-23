# Background-curation probe (RFC-046), 2026-10-23

Read-only. Both scripts load the real engine (`dist/engine.js`: `readAll`, `latestHandoff`,
`isInjectable`, `isPinCandidate`) and take a directory holding `.vfkb/` and `dist/`.

The brain measured is `main` at the commit in `brain-commit.txt` (`97e796e`, pin
`e622618cba19`). To reproduce: put `git show 97e796e:.vfkb/entries.jsonl` in `<dir>/.vfkb/`,
link a built `dist/` into `<dir>`, then run `node probe.mjs <dir>` and `node stream.mjs <dir>`.

- `probe.mjs` → `output.txt`: the split of the 122 live handoff/next facts, the id mentions
  with their surrounding wording, and the age-and-count rule (72).
- `stream.mjs` → `output-stream.txt`: the same rule plus the same-stream tag guard (61, with
  the 11 it holds back).

Re-running on a later brain gives different numbers. For example, this PR's own handoff
`33b4b1aa0a34` becomes the pin, which makes `e622618cba19` a candidate.
