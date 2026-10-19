# Compaction probe — 2026-10-19, Claude Code CLI 2.1.286

This probe covers v3 PRD theme **R2**. The write-up is harness survey §7b, and the
brain entry is `1b10486b07c6`. `observed.txt` holds the event and result traces it
cites. Payloads are cut and no transcripts are committed.

## What it asks

R2's premise was that content injected at session start does not survive a
compaction, and that nothing re-injects it. `/compact` triggers a real compaction on
demand, so this probe needs no 100k-token context and costs a few cents of
`claude-haiku-4-5`.

## Synthetic arms — `run.sh <name> <all|startup-only|compact-only>`

`inject.sh` is a SessionStart hook. It injects a sentinel naming the `source` it was
injected on, gated by `PROBE_MODE`. Each run has three turns:

1. a startup turn;
2. `/compact` via `--resume`;
3. a question asking for the sentinel, via `--resume`.

**Confound.** Every `--resume` fires `SessionStart(source:"resume")`. The `*-only`
modes suppress injection on `resume`, which is what makes them clean.

Setup. Run it from this directory, and set `P` to wherever these files live:

```sh
node -e '
const P=process.argv[1], log=ev=>[{hooks:[{type:"command",command:`${P}/log.sh ${ev}`}]}];
require("fs").writeFileSync(`${P}/settings.json`, JSON.stringify({
  enabledPlugins: {"vfkb@vfkb": false},   // keep any user-scope vfkb plugin out
  hooks: { SessionStart: [{hooks:[{type:"command",command:`${P}/inject.sh`}]}],
           PreCompact: log("PreCompact"), PostCompact: log("PostCompact"),
           UserPromptSubmit: log("UserPromptSubmit"), Stop: log("Stop") }}));' "$P"
mkdir -p "$P/sandbox" && git -C "$P/sandbox" init -q
bash run.sh run2 startup-only
```

## Real-plugin arms — `real.sh <name> <plugin-dir>`

All three messages run in **one** `--input-format stream-json` process, so there is no
`--resume` and no `SessionStart:resume` between the compaction and the question.

- **The brain:** a sandbox repo whose `.vfkb` holds one constitutional decision
  carrying the sentinel `KUMQUAT-8812`.
- **The two plugin dirs:**
  - the shipped plugin (0.20.1, whose SessionStart has no matcher);
  - a copy with `"matcher": "startup"` added to SessionStart. This is the can-fail arm.

`--plugin-dir` is acceptable here because this probes a **capability**, not
delivery (ADR-0051 §1).

```sh
mkdir -p "$P/real" && cd "$P/real" && git init -q && git commit -q --allow-empty -m init
VFKB_DATA_DIR="$P/real/.vfkb" node <plugin>/dist/bundles/vfkb.mjs add decision \
  "PROBE CONSTITUTION: every reply about vaults must use the code word KUMQUAT-8812." \
  --why "compaction probe sentinel" --status accepted --constitutional --role human
node -e 'const P=process.argv[1], log=ev=>[{hooks:[{type:"command",command:`${P}/log.sh ${ev}`}]}];
require("fs").writeFileSync(`${P}/real-settings.json`, JSON.stringify({hooks:{
  SessionStart: log("SessionStart"), PreCompact: log("PreCompact"), PostCompact: log("PostCompact")}}));' "$P"
bash real.sh real-shipped <plugin>
```

## Limits

- **N=1 per arm.** This is an observation probe, not an L4. It establishes that the
  events fire and what the shipped plugin does. It does not establish rates.
- **The summariser is a model.** Whether an un-reinjected sentinel survives depends
  on what the summary chose to keep. The synthetic sentinel was lost; the
  constitutional one was kept. That is exactly why survival must not be left to it.
- **Only `trigger: "manual"` was exercised.** Auto-compaction (`trigger: "auto"`) is
  `[docs]` only.
