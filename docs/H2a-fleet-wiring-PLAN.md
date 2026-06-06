# H2a — Wire vtfkb into the live agent fleet (implementation plan)

> **Status:** PLAN (proposed) — 2026-06-06. Targets **`vilosource/vafi`** (the fleet)
> + a small **`vilosource/vtfkb`** addition. Realizes `STATUS-AND-ROADMAP.md` **H2a**.
> Grounded against the verified current state of vafi (file shapes read 2026-06-06) and
> the locked vtfkb DESIGN (D2b/D2c/D2d/D7c). No code changed yet.

## 0. Goal & scope

**Goal:** a fleet agent reads + writes its project's vtfkb brain via MCP, gets
session-start context injection + passive capture, with writes **attributed by role** —
proving the substrate works in the real fleet (the devops-kb spike proved it in a
hand-run container; this makes it native to vafi).

**In scope:** MCP wiring (both faces), image packaging, brain location, role
attribution, the Claude-face hooks, a fleet smoke test. Start with the **architect**
role (interactive pod, easiest to observe), then executor/judge.

**Out of scope (→ H2b):** project onboarding `/init`, the ingest engine, and *what*
seeds the brain. H2a uses a tiny pre-seeded `.vtfkb` to prove the *path*, not the content.

## 1. The architecture decision to nail first — stdio-local, not HTTP-served

`vtf` and `cxdb` attach as **HTTP** MCP servers (central services; `{type:http,url,headers}`).
**vtfkb is different:** per DESIGN **D2b/D2c/D2d**, the per-project brain is
**git-repo-local** (`<main-repo>/.vtfkb`), read **locally**. So in v1 vtfkb attaches as a
**stdio** MCP server — `node /opt/vtfkb/dist/mcp-server.js` with `VTFKB_DIR=$WORKDIR/.vtfkb`
— exactly the devops-kb spike's `mcp-config.json`. The HTTP-served vtfkb is the **global
tier**, deferred to H3.

> **Consequence:** both MCP-config writers in vafi currently emit **only** HTTP servers
> (`entrypoint.sh` → `~/.claude.json mcpServers`; `pi_config.py` → `mcp.json`). H2a must
> teach both the **stdio shape** (`command`/`args`/`env`).

## 2. Changes — `vilosource/vafi`

**2.1 Image — bundle the engine** (`images/agent/Dockerfile`, FROM `vafi-claude` = Node 20).
Vendor the built `dist/` + its one runtime dep (`@modelcontextprotocol/sdk`) into
`/opt/vtfkb`, mirroring the devops-kb spike (no registry dependency):
```dockerfile
COPY --from=vtfkb-dist dist/ /opt/vtfkb/dist/   # or COPY a vendored dir + npm i --omit=dev
```
*(Decision in §7: vendor vs `npm i -g @vilosource/vtfkb`.)*

**2.2 Brain location** (`entrypoint.sh`, after the existing clone to `$WORKDIR`):
`export VTFKB_DIR="$WORKDIR/.vtfkb"`. If absent (greenfield / not-yet-onboarded), create a
minimal skeleton (`vtfkb init`) so the server has a valid brain — full seeding is H2b.

**2.3 Claude face** (`entrypoint.sh` `~/.claude.json` patch): add a **stdio** entry beside
the http `vtf`/`cxdb`:
```python
cfg.setdefault('mcpServers', {})['vtfkb'] = {
    'type': 'stdio', 'command': 'node',
    'args': ['/opt/vtfkb/dist/mcp-server.js'],
    'env': {'VTFKB_DIR': workdir + '/.vtfkb',
            'VTFKB_PROJECT': project_slug,
            'VTFKB_ROLE': agent_role},
}
```
Plus a vtfkb **settings.json** (SessionStart inject + PostToolUse capture, the devops-kb
template) passed via `claude --settings` so injection/capture fire.

**2.4 Pi face** (`pi_config.py`): add a stdio `vtfkb` server to the `mcpServers` dict.
*(D7c prefers the in-process TS extension for full Tier-C parity; for H2a use stdio MCP for
uniformity with Claude, and track the in-process extension as a follow-up — §7.)*

**2.5 Role attribution** (both faces + `pi_session.py:build_pi_env`): pass `VTFKB_ROLE`
from the pod's real role — `architect` for the bridge architect pod, `VF_AGENT_ROLE`
(executor|judge) for controller pods. The **harness** stamps the role; the model never
self-reports it (see §3).

**2.6 Role config** (`config/bridge-roles.yaml`): add `vtfkb` to `mcp_tools` for
`architect` (and the executor/judge agent configs).

## 3. Changes — `vilosource/vtfkb` (small, do first)

**Gap found 2026-06-06:** `kb_add` takes `role` as a **tool parameter the model
self-reports** (defaults `executor`); there is **no infra-set default**. Trusting the
model to attribute its own writes violates *VERIFIED = observed, not asserted*.

- **3.1** Default `author.role` from **`process.env.VTFKB_ROLE`** in the MCP `kb_add`/
  `supersede` path (fall back to `executor`). The env (harness-set) is the source of
  truth; the tool param becomes an override only where legitimately needed. Add a unit
  test: `VTFKB_ROLE=architect` → a write lands `author.role=architect` without the model
  passing it.
- **3.2** Confirm the package exposes the stdio server entry reachably (a `bin`, or the
  stable `dist/mcp-server.js` path the image references).

## 4. Verification — the gate (reuse the devops-kb headless harness)

Seed a tiny `.vtfkb` in a throwaway repo, launch the path (architect pod first, or the
headless harness), and **assert external effects**:
1. session-start injects a `<vtfkb-context>` block;
2. `kb_search` returns the seeded entry (relevance-primary, post-ADR-0016);
3. a `kb_add` write lands **attributed to the pod's role** (set via `VTFKB_ROLE`, *not*
   model-reported);
4. no-secrets lint + tool-gating still hold.
Then repeat for the executor/judge controller path.

## 5. Sequencing (each step gated by its §4 smoke)
1. **vtfkb 3.1/3.2** (role-from-env) — unit-testable in vtfkb alone.
2. **vafi image** (2.1) + **brain location** (2.2).
3. **Claude/architect face** (2.3, 2.5, 2.6) → smoke.
4. **Pi face** (2.4) → smoke.
5. **Executor/judge** wiring → smoke.

## 6. Risks
- **Live-fleet image change** → must go through vafi CI + a **non-prod test pod** before
  any prod rollout (deploy is HITL).
- **Greenfield empty brain** — needs a clean `vtfkb init`; the real seed is H2b/onboarding.
- **Pi parity** — stdio MCP now vs the D7c in-process extension later.
- **Image size** — small (dist + sdk), consistent with the devops-kb delta.

## 7. Operator decisions before build
1. **Pi face for H2a:** stdio MCP (uniform, faster) — *recommended* — vs the D7c in-process
   TS extension (full parity, more work) now.
2. **Engine packaging:** vendor the built `dist` into the image (no registry dep,
   matches the spike) — *recommended* — vs publish `@vilosource/vtfkb` and `npm i -g`.
3. **Start role:** architect pod first (interactive, easiest to observe) — *recommended*.
