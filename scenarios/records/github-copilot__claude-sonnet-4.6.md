# vfkb L4 behavior record — harness=pi — github-copilot/claude-sonnet-4.6

- harness: pi
- generated: 2026-06-03T16:44:20.585Z
- vfkb: 743657c
- scenarios recorded: 22 (21 demonstrated)

| scenario | dimension | demonstrated | rows (label=verdict) |
|---|---|---|---|
| capture-recall | memory:capture->recall | YES | pi:capture=PASS, pi:recall:vfkb=PASS, pi:recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | pi:vfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | pi:vfkb=PASS, pi:none=fail |
| constitution-prohibition | constitution:prohibition | YES | pi:vfkb=PASS, pi:none=fail |
| decision-followed | deliver:decision | YES | pi:vfkb=PASS, pi:none=fail |
| deprecated-excluded | exclude:status | YES | pi:vfkb=PASS, pi:naive=fail |
| gotcha-guidance | deliver:gotcha | YES | pi:vfkb=PASS, pi:none=fail |
| knowledge-delivery | deliver:fact | YES | pi:vfkb=PASS, pi:none=fail |
| link-delivery | deliver:link | YES | pi:vfkb=PASS, pi:none=fail |
| mcp-map-navigation | mcp:map-then-search | YES | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-pull | mcp:pull | YES | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search | YES | pi:mcp=PASS, pi:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | pi:vfkb=PASS, pi:none=fail |
| no-secrets | guardrail:no-secrets | YES | pi:mcp kb_add(secret)=PASS |
| precedence-distractor | rerank:precedence-amid-noise | YES | pi:vfkb=PASS, pi:naive=fail |
| provstale-excluded | exclude:prov-status | YES | pi:vfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | pi:vfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | pi:vfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | pi:vfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | no | pi:gated=PASS, pi:ungated=fail |
| unverified-injected | trust:unverified-delivered | YES | pi:vfkb=PASS, pi:none=fail |
| vision-format | deliver:vision-pattern | YES | pi:vfkb=PASS, pi:none=fail |
