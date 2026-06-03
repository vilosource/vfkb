# vtfkb L4 behavior record — deepseek/deepseek-v4-pro

- generated: 2026-06-03T12:26:17.393Z
- vtfkb: 8252b4e
- scenarios recorded: 24 (24 demonstrated)

| scenario | dimension | demonstrated | rows (label=verdict) |
|---|---|---|---|
| capture-recall | memory:capture->recall | YES | phase1:capture=PASS, recall:vtfkb=PASS, recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | pi:vtfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | pi:vtfkb=PASS, pi:none=fail |
| constitution-prohibition | constitution:prohibition | YES | pi:vtfkb=PASS, pi:none=fail |
| decision-followed | deliver:decision | YES | pi:vtfkb=PASS, pi:none=fail |
| deprecated-excluded | exclude:status | YES | pi:vtfkb=PASS, pi:naive=fail |
| gotcha-guidance | deliver:gotcha | YES | pi:vtfkb=PASS, pi:none=fail |
| knowledge-delivery | deliver:fact | YES | pi:vtfkb=PASS, pi:none=fail |
| link-delivery | deliver:link | YES | pi:vtfkb=PASS, pi:none=fail |
| mcp-map-navigation | mcp:map-then-search (claude) | YES | claude:mcp=PASS, claude:no-mcp=PASS |
| mcp-pull | mcp:pull (claude) | YES | claude:mcp=PASS, claude:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search (claude) | YES | claude:mcp=PASS, claude:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | pi:vtfkb=PASS, pi:none=fail |
| no-secrets | guardrail:no-secrets | YES | claude:mcp kb_add(secret)=PASS |
| parity-claude-constitution | parity:claude constitution | YES | claude:vtfkb=PASS, claude:none=fail |
| parity-claude-stale | parity:claude exclusion | YES | claude:vtfkb=PASS, claude:naive=fail |
| precedence-distractor | rerank:precedence-amid-noise | YES | pi:vtfkb=PASS, pi:naive=fail |
| provstale-excluded | exclude:prov-status | YES | pi:vtfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | pi:vtfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | pi:vtfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | pi:vtfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | YES | pi:gated=PASS, pi:ungated(baseline)=PASS |
| unverified-injected | trust:unverified-delivered | YES | pi:vtfkb=PASS, pi:none=fail |
| vision-format | deliver:vision-pattern | YES | pi:vtfkb=PASS, pi:none=fail |
