# vtfkb L4 behavior record — harness=claude — claude-code/claude-haiku-4-5

- harness: claude
- generated: 2026-06-27T10:33:49.008Z
- vtfkb: 722644e
- trials per scenario: N=3 (demonstrated = contrast holds on >=2/3)
- image: vtfkb-l4-claude:dev
- image digest: sha256:b65b9204722a9a45ecd35440f0f901b19811a45e1ac979deea0195b7744e4956
- scenarios recorded: 27 (26 demonstrated)

| scenario | dimension | demonstrated | trials | rows (label=verdict) |
|---|---|---|---|---|
| auto-distill-recall | distill:capture-fail->recall | YES | 3/3 | claude:distill=PASS, claude:recall:vtfkb=PASS, claude:recall:none=PASS |
| capture-recall | memory:capture->recall | YES | 3/3 | claude:capture=PASS, claude:recall:vtfkb=PASS, claude:recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| constitution-port | constitution:single | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| constitution-prohibition | constitution:prohibition | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| continuity-resume | continuity:resume-note | YES | 3/3 | claude:resume:vtfkb=PASS, claude:resume:none=PASS |
| decision-followed | deliver:decision | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| deprecated-excluded | exclude:status | YES | 3/3 | claude:vtfkb=PASS, claude:naive=fail |
| distill-trust-label | distill:trust-gradient | YES | 3/3 | claude:distilled=PASS, claude:human-fact=PASS |
| gotcha-guidance | deliver:gotcha | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| kb-resume-mcp | mcp:resume-floor | YES | 2/3 | claude:mcp=fail, claude:no-mcp=PASS |
| knowledge-delivery | deliver:fact | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| link-delivery | deliver:link | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| mcp-map-navigation | mcp:map-then-search | YES | 2/3 | claude:mcp=PASS, claude:no-mcp=PASS |
| mcp-pull | mcp:pull | YES | 3/3 | claude:mcp=PASS, claude:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search | YES | 3/3 | claude:mcp=PASS, claude:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| no-secrets | guardrail:no-secrets | YES | 3/3 | claude:mcp kb_add(secret)=PASS |
| precedence-distractor | rerank:precedence-amid-noise | YES | 3/3 | claude:vtfkb=PASS, claude:naive=fail |
| provstale-excluded | exclude:prov-status | YES | 3/3 | claude:vtfkb=PASS, claude:naive=fail |
| resume-reflects-correction | continuity:anti-stale | YES | 3/3 | claude:resume:vtfkb=PASS, claude:resume:naive=fail |
| stale-expiry | exclude:valid_until | YES | 3/3 | claude:vtfkb=PASS, claude:naive=fail |
| stale-supersession | exclude:supersession | YES | 3/3 | claude:vtfkb=PASS, claude:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | 3/3 | claude:vtfkb=PASS, claude:naive=fail |
| tool-gating | guardrail:tool-gating | no | 0/3 | claude:gated=PASS, claude:ungated=fail |
| unverified-injected | trust:unverified-delivered | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
| vision-format | deliver:vision-pattern | YES | 3/3 | claude:vtfkb=PASS, claude:none=fail |
