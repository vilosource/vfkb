# vtfkb L4 behavior record — harness=pi — deepseek/deepseek-v4-pro

- harness: pi
- generated: 2026-06-27T08:57:00.116Z
- vtfkb: 93c4abc
- trials per scenario: N=3 (demonstrated = contrast holds on >=2/3)
- image: vtfkb-l4-pi:dev
- image digest: sha256:bdd2dfd2e00ff4d14a0dfc4eebdd3b80f62f3c6daf16066e7c910ae60fad62f2
- scenarios recorded: 23 (23 demonstrated)

| scenario | dimension | demonstrated | trials | rows (label=verdict) |
|---|---|---|---|---|
| capture-recall | memory:capture->recall | YES | 3/3 | pi:capture=PASS, pi:recall:vtfkb=PASS, pi:recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| constitution-prohibition | constitution:prohibition | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| continuity-resume | continuity:resume-note | YES | 3/3 | pi:resume:vtfkb=PASS, pi:resume:none=PASS |
| decision-followed | deliver:decision | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| deprecated-excluded | exclude:status | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| gotcha-guidance | deliver:gotcha | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| knowledge-delivery | deliver:fact | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| link-delivery | deliver:link | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| mcp-map-navigation | mcp:map-then-search | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-pull | mcp:pull | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| no-secrets | guardrail:no-secrets | YES | 3/3 | pi:mcp kb_add(secret)=PASS |
| precedence-distractor | rerank:precedence-amid-noise | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| provstale-excluded | exclude:prov-status | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | YES | 2/3 | pi:gated=PASS, pi:ungated=PASS |
| unverified-injected | trust:unverified-delivered | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| vision-format | deliver:vision-pattern | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
