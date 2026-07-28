---
description: Bootstrap a new GitHub project — create repo, clone under ~/VFKB, set repo-local git identity, wire vfkb (plugin), scaffold, verify, and push
---

Bootstrap a new project end-to-end. Argument (optional): `<name>` and/or a short free-text
description of what the project is, e.g. `/vfkb-new-project viloforge-wiki mediawiki with docker
compose customizations`. Ask for whatever wasn't given.

## 1. Nail down the basics

Ask (via clarifying questions, not assumptions) whatever isn't already clear from the argument:
- **Project name** (also the repo name and the local dir name under `~/VFKB/<name>`).
- **What it is** — enough to decide a scaffold shape. If there's a genuine fork-in-the-road on
  *how* to build it (e.g. "vendor/fork the upstream thing" vs "compose/deploy the upstream image
  vs a from-scratch build"), ask — don't silently pick.
- **Visibility** — default **private**, confirm if unstated.
- **License** — confirm (default Apache-2.0 for infra/CNCF-adjacent).
- **GitHub account** — default **vilosource**, only ask if the project might belong elsewhere.

Check `~/VFKB/<name>` doesn't already exist before doing anything else; stop and ask if it does.

## 2. vfkb wiring model — PLUGIN is the default (ADR-0045)

New projects wire vfkb via its **Claude Code plugin**, the current canonical mechanism — **not** the
legacy `$VFKB_BUNDLE_DIR` bootstrap (RFC-010/ADR-0030, now a fallback only, e.g. viloforge-wiki).
The plugin **vendors its own engine bundles**, so *there is no `$VFKB_BUNDLE_DIR` refresh to do* for a
plugin-wired repo. The wiring is two committed files:

- `.claude/settings.json` — sourced from **`docs/templates/consumer-settings.json` in vfkb** (NOT
  vfkb's own `.claude/settings.json` — that file also carries vfkb's own dogfooding hooks, which
  reference scripts that don't exist outside vfkb's repo; copying it verbatim breaks a consumer's
  first `Bash`/`Write`/`Edit` call — ADR-0071). It carries `extraKnownMarketplaces.vfkb` (→
  `vilosource/vfkb-claude-plugin`) + `enabledPlugins["vfkb@vfkb"]` + a `SessionStart` hook running
  the guard, and nothing else, ever (Brake-tested by vfkb's `test/consumer-settings-template.test.ts`).
- `.claude/vfkb-guard.mjs` — copied byte-for-byte from vfkb's own `main` (the dogfooded reference,
  kept current) — the ADR-0059 "vfkb INACTIVE" guard (engine-free, fails open). It is what makes the
  enabled-but-not-installed state loud instead of silent; it MUST be committed because a plugin that
  didn't load can't warn about itself.

Fetch both from vfkb `main` at wire time (step 5) so they never drift:
`gh api repos/vilosource/vfkb/contents/docs/templates/consumer-settings.json?ref=main --jq .content | base64 -d`
for `settings.json`, and the equivalent `.claude/vfkb-guard.mjs?ref=main` for the guard.

*(Only use the legacy bootstrap path if the operator explicitly asks for a non-plugin repo — then
refresh `$VFKB_BUNDLE_DIR` from `main` via a scratch `git worktree` of `~/VFKB/vfkb` and
`node "$VFKB_BUNDLE_DIR/vfkb.mjs" init <name>`. Never touch `~/VFKB/vfkb`'s live working dir.)*

## 3. Create the repo and clone it

1. `gh repo create <account>/<name> --private|--public --description "..."`.
2. `git clone git@github.com:<account>/<name>.git` into `~/VFKB/<name>`.
3. Look up the account's GitHub noreply email — its numeric id is stable:
   `gh api users/<account> --jq .id` → email is `<id>+<account>@users.noreply.github.com`
   (cross-check against an existing repo's `git log` author, e.g. vfkb, to be sure of the form).
4. Set **repo-local** identity only — `git config user.name "<account>"` and
   `git config user.email "<id>+<account>@users.noreply.github.com"` inside the new repo.
   **Never** touch `--global` config.

## 4. Scaffold the project

Build whatever the project actually needs based on step 1's answers. Apply the same judgment as any
other build task: no speculative abstractions, no unverified copy-pasted config presented as fact
(verification-first). For an early-stage / "architecture-blueprinting" project, prefer a
**docs-first** scaffold (README, `docs/` with any source spec/PRD, `docs/adr/ADR-0001`, LICENSE,
`AGENTS.md`/`CLAUDE.md`) over inventing an undecided tech stack — decisions before code.

**Verify it actually works before moving on** — don't just eyeball the files. If it's a running
service (e.g. Docker Compose), bring it up (mind host port conflicts — `ss -ltn`, pick a free port),
exercise the golden path, tear it down. If it's a build/library, run its build/test. State plainly
if some part couldn't be verified in this environment.

## 5. Wire vfkb (plugin)

```sh
cd ~/VFKB/<name>
mkdir -p .claude .vfkb
# canonical wiring — the consumer TEMPLATE for settings.json, vfkb's own guard file verbatim:
gh api repos/vilosource/vfkb/contents/docs/templates/consumer-settings.json?ref=main --jq .content | base64 -d > .claude/settings.json
gh api repos/vilosource/vfkb/contents/.claude/vfkb-guard.mjs?ref=main               --jq .content | base64 -d > .claude/vfkb-guard.mjs
python3 -c 'import json;json.load(open(".claude/settings.json"))'   # settings.json is valid JSON
# seed the brain (the engine CLI writes to any brain dir; an empty .vfkb/entries.jsonl is also valid):
VFKB_DATA_DIR=.vfkb VFKB_PROJECT=<name> node ~/VFKB/vfkb/dist/cli.js add fact "GENESIS <date>: <name> created …" --role human --tag genesis,status
```

**Verify (observed, not asserted):**
1. **Guard fires** — `CLAUDE_PROJECT_DIR=$PWD node .claude/vfkb-guard.mjs` prints the `vfkb INACTIVE`
   banner (correct: the plugin is *declared* but not yet *installed* for this new repo — this is the
   guard's can-fail proof that it works, and it exits 0 / fail-open).
2. **Brain round-trips** — `VFKB_DATA_DIR=.vfkb node ~/VFKB/vfkb/dist/cli.js list` shows the seeded
   entries; only `.vfkb/entries.jsonl` is committed (the rest is gitignored/derived).

**Do NOT claim vfkb is "live" — it is not yet.** `enabledPlugins` in `settings.json` only *declares*
the plugin; it does not install it, and a headless step can't (gotcha `8e76f8f72b64`: settings-wired
≠ loaded). The plugin becomes live only after the one-time interactive install in step 6.

## 6. Commit, push, report

- Add `.gitignore` first (ignore `node_modules`, `dist`, secrets/`.env`, and the derived vfkb bits:
  `.vfkb/.sessions/ .vfkb/.signals/ .vfkb/index-meta.json`). Stage the scaffold + wiring
  (`.claude .vfkb/entries.jsonl AGENTS.md CLAUDE.md` + project files); **double-check nothing secret
  is staged** (`git diff --cached --name-only | grep -iE '\.env|\.pem|\.key|secret|kubeconfig'`).
- This is a brand-new empty repo, so the initial commit goes straight to `main` (nothing to PR
  against yet). Every commit *after* this one follows the normal branch → PR discipline.
- Verify the commit author is the repo-local `<account>` noreply identity and carries **no AI
  attribution**, then push.
- Report **clickable URLs**: the repo, the commit, and a `blob` link for each key file (README, the
  spec/PRD, `CLAUDE.md`, `.claude/settings.json`) — unprompted, every time.
- **Remind the operator of the one manual step:** in an interactive `claude` session inside the new
  repo, run `claude plugin install vfkb@vfkb --scope project` (or approve the plugin's MCP server +
  hooks when prompted) and restart. Until then the guard will banner `vfkb INACTIVE` every session —
  which is the intended, honest signal, not a bug.
