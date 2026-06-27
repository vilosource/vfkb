# vtfkb L4 behavior record — harness=pi — deepseek/deepseek-v4-pro

- harness: pi
- generated: 2026-06-27T18:08:56.192Z
- vtfkb: 6883a41
- trials per scenario: N=3 (demonstrated = contrast holds on >=2/3)
- image: vtfkb-l4-pi:dev
- image digest: sha256:1c74317b08738d53e4b67981c564feaad562a00f2a83f929a227fcadbbc803a9
- scenarios recorded: 32 (32 demonstrated)

| scenario | dimension | demonstrated | trials | rows (label=verdict) |
|---|---|---|---|---|
| auto-distill-recall | distill:capture-fail->recall | YES | 3/3 | pi:distill=PASS, pi:recall:vtfkb=PASS, pi:recall:none=PASS |
| capture-recall | memory:capture->recall | YES | 3/3 | pi:capture=PASS, pi:recall:vtfkb=PASS, pi:recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| constitution-prohibition | constitution:prohibition | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| continuity-resume | continuity:resume-note | YES | 3/3 | pi:resume:vtfkb=PASS, pi:resume:none=PASS |
| corroborated-promotion | distill:corroborated-promotion | YES | 3/3 | pi:corroborated(net>=2)=PASS, pi:below-threshold(net 0)=PASS |
| decision-followed | deliver:decision | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| deprecated-excluded | exclude:status | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| distill-trust-label | distill:trust-gradient | YES | 3/3 | pi:distilled=PASS, pi:human-fact=PASS |
| gotcha-guidance | deliver:gotcha | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| kb-resume-mcp | mcp:resume-floor | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| knowledge-delivery | deliver:fact | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| link-delivery | deliver:link | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| live-capture-result | capture:live-tool-result | YES | 3/3 | pi:capture-on=PASS, pi:capture-off=PASS |
| mcp-map-navigation | mcp:map-then-search | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-pull | mcp:pull | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| no-secrets | guardrail:no-secrets | YES | 3/3 | pi:mcp kb_add(secret)=PASS |
| precedence-distractor | rerank:precedence-amid-noise | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| promotion-relabel | distill:promotion-agent-observable | YES | 2/3 | pi:promoted=fail, pi:not-promoted=PASS |
| provstale-excluded | exclude:prov-status | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| resume-reflects-correction | continuity:anti-stale | YES | 3/3 | pi:resume:vtfkb=PASS, pi:resume:naive=fail |
| role-precedence | attribution:precedence | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | 3/3 | pi:vtfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | YES | 2/3 | pi:gated=PASS, pi:ungated=PASS |
| unverified-injected | trust:unverified-delivered | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
| verified-only-filter | mcp:verified-filter | YES | 2/3 | pi:verified-filter=PASS, pi:no-filter=PASS |
| vision-format | deliver:vision-pattern | YES | 3/3 | pi:vtfkb=PASS, pi:none=fail |
