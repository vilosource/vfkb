# vtfkb L4 behavior record — harness=claude — claude-code/cli

- harness: claude
- generated: 2026-06-03T15:57:46.512Z
- vtfkb: b73a9cb
- scenarios recorded: 22 (20 demonstrated)

| scenario | dimension | demonstrated | rows (label=verdict) |
|---|---|---|---|
| capture-recall | memory:capture->recall | no | claude:capture=PASS, claude:recall:vtfkb=PASS, claude:recall:none=fail |
| constitution-multi | constitution:aggregate | YES | claude:vtfkb=PASS, claude:none=fail |
| constitution-port | constitution:single | YES | claude:vtfkb=PASS, claude:none=fail |
| constitution-prohibition | constitution:prohibition | YES | claude:vtfkb=PASS, claude:none=fail |
| decision-followed | deliver:decision | YES | claude:vtfkb=PASS, claude:none=fail |
| deprecated-excluded | exclude:status | YES | claude:vtfkb=PASS, claude:naive=fail |
| gotcha-guidance | deliver:gotcha | YES | claude:vtfkb=PASS, claude:none=fail |
| knowledge-delivery | deliver:fact | YES | claude:vtfkb=PASS, claude:none=fail |
| link-delivery | deliver:link | YES | claude:vtfkb=PASS, claude:none=fail |
| mcp-map-navigation | mcp:map-then-search | YES | claude:mcp=PASS, claude:no-mcp=PASS |
| mcp-pull | mcp:pull | YES | claude:mcp=PASS, claude:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search | YES | claude:mcp=PASS, claude:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | claude:vtfkb=PASS, claude:none=fail |
| no-secrets | guardrail:no-secrets | YES | claude:mcp kb_add(secret)=PASS |
| precedence-distractor | rerank:precedence-amid-noise | YES | claude:vtfkb=PASS, claude:naive=fail |
| provstale-excluded | exclude:prov-status | YES | claude:vtfkb=PASS, claude:naive=fail |
| stale-expiry | exclude:valid_until | YES | claude:vtfkb=PASS, claude:naive=fail |
| stale-supersession | exclude:supersession | YES | claude:vtfkb=PASS, claude:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | claude:vtfkb=PASS, claude:naive=fail |
| tool-gating | guardrail:tool-gating | no | claude:gated=PASS, claude:ungated=fail |
| unverified-injected | trust:unverified-delivered | YES | claude:vtfkb=PASS, claude:none=fail |
| vision-format | deliver:vision-pattern | YES | claude:vtfkb=PASS, claude:none=fail |
