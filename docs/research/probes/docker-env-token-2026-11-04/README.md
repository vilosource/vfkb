# Probe: docker claude arm authenticates from an env token passed by name (vfkb#423)

**Question.** With no credentials file mounted, does `vfkb-l4-claude:dev` authenticate
from `-e CLAUDE_CODE_OAUTH_TOKEN` (name only, value in the docker child's env), and is
the token load-bearing?

**Method.** `probe.mjs` builds the scenario's own argv (`scenarios/lib/docker-claude.mjs`)
and runs two arms, N=3: `token` (docker child env from `claudeEnv()`) and `no-token`
(the same argv, the token deleted from that env). Prompt: "Reply with exactly one word:
PONG", `--model claude-haiku-4-5`, `--output-format json`. The assertion is over the
content: `PONG` in `result` and a haiku key in `modelUsage`. Exit status is not
used (ADR-0051 clause 3).

**Result (2026-11-04, image claude-code 2.1.311, `out/result.json`).**

| Arm | PONG | haiku in `modelUsage` | Output |
|---|---|---|---|
| token | 3/3 | 3/3 | `PONG` |
| no-token | 0/3 | 0/3 | `Not logged in · Please run /login` |

Verdict: DEMONSTRATED. The env token alone authenticates the container, and without it
the container is unauthenticated, so no other credential path is reaching it.

**Not observed.**
- What happens when the access token expires mid-run inside the container. The
  harness does not try to predict it. Any docker claude run with no `modelUsage`
  model (a 401 included) refuses the whole run, and that is tested with a fake 401
  (`test/docker-claude.test.ts`). No real expiry was forced.
- Whether a container-side refresh would have rotated the operator's refresh token.
  Nobody forced one, and the refresh token no longer enters the container.
