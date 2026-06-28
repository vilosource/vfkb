# vfkb L4 behavior record — deepseek/deepseek-v4-pro

- generated: 2026-06-03T14:10:45.294Z
- vfkb: b3c7eee
- scenarios recorded: 24 (24 demonstrated)

| scenario | dimension | demonstrated | rows (label=verdict) |
|---|---|---|---|
| capture-recall | memory:capture->recall | YES | phase1:capture=PASS, recall:vfkb=PASS, recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | pi:vfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | pi:vfkb=PASS, pi:none=fail |
| constitution-prohibition | constitution:prohibition | YES | pi:vfkb=PASS, pi:none=fail |
| decision-followed | deliver:decision | YES | pi:vfkb=PASS, pi:none=fail |
| deprecated-excluded | exclude:status | YES | pi:vfkb=PASS, pi:naive=fail |
| gotcha-guidance | deliver:gotcha | YES | pi:vfkb=PASS, pi:none=fail |
| knowledge-delivery | deliver:fact | YES | pi:vfkb=PASS, pi:none=fail |
| link-delivery | deliver:link | YES | pi:vfkb=PASS, pi:none=fail |
| mcp-map-navigation | mcp:map-then-search (pi bridge) | YES | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-pull | mcp:pull (pi bridge) | YES | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search (pi bridge) | YES | pi:mcp=PASS, pi:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | pi:vfkb=PASS, pi:none=fail |
| no-secrets | guardrail:no-secrets | YES | pi:mcp kb_add(secret)=PASS |
| parity-claude-constitution | parity:claude constitution | YES | claude:vfkb=PASS, claude:none=fail |
| parity-claude-stale | parity:claude exclusion | YES | claude:vfkb=PASS, claude:naive=fail |
| precedence-distractor | rerank:precedence-amid-noise | YES | pi:vfkb=PASS, pi:naive=fail |
| provstale-excluded | exclude:prov-status | YES | pi:vfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | pi:vfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | pi:vfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | pi:vfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | YES | pi:gated=PASS, pi:ungated(baseline)=PASS |
| unverified-injected | trust:unverified-delivered | YES | pi:vfkb=PASS, pi:none=fail |
| vision-format | deliver:vision-pattern | YES | pi:vfkb=PASS, pi:none=fail |
