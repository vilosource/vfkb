## What

<!-- What does this change do? -->

## Why

<!-- Why is this needed? Link an issue, ADR, or RFC if one exists. -->

## Definition of Done

Is this change a **structural invariant** (proved by deterministic unit/integration tests) or a
**user-facing capability** (proved by an agent-driven L4 scenario, per ADR-0050)? If you're not
sure, say so — a maintainer will help decide.

- [ ] Structural invariant — tests included/updated
- [ ] User-facing capability — L4 scenario included, or evidence linked
- [ ] Not sure — flagged above for a maintainer

## Plugin re-vendor

Does this change touch behavior [vfkb-claude-plugin](https://github.com/vilosource/vfkb-claude-plugin)
vendors a copy of (hooks, MCP tools, the bundled engine)?

- [ ] Yes — the plugin will need a re-vendor bump on its own release
- [ ] No

## Checklist

- [ ] `npm run build && npm test` pass locally
- [ ] Commits carry no AI attribution (no `Co-Authored-By: Claude`/similar, no "Generated with…", no 🤖)
- [ ] Commit messages / PR title follow [Conventional Commits](https://www.conventionalcommits.org/)
