# vfkb L4 behavior record — harness=pi — deepseek/deepseek-v4-pro

- harness: pi
- generated: 2026-07-08T06:47:44.567Z
- vfkb: f3ac08c
- trials per scenario: N=3 (demonstrated = contrast holds on >=2/3)
- image: vfkb-l4-pi:v2
- image digest: sha256:042c82be4d54cac3a365dc314103eb1838eccf5d43a8ef5938cea4e4d4d9c5c4
- scenarios recorded: 33 (32 demonstrated)

| scenario | dimension | demonstrated | trials | rows (label=verdict) |
|---|---|---|---|---|
| auto-distill-recall | distill:capture-fail->recall | YES | 3/3 | pi:distill=PASS, pi:recall:vfkb=PASS, pi:recall:none=PASS |
| capture-recall | memory:capture->recall | YES | 3/3 | pi:capture=PASS, pi:recall:vfkb=PASS, pi:recall:none=PASS |
| constitution-multi | constitution:aggregate | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| constitution-prohibition | constitution:prohibition | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| continuity-resume | continuity:resume-note | YES | 3/3 | pi:resume:vfkb=PASS, pi:resume:none=PASS |
| corroborated-promotion | distill:corroborated-promotion | YES | 3/3 | pi:corroborated(net>=2)=PASS, pi:below-threshold(net 0)=PASS |
| decision-followed | deliver:decision | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| deprecated-excluded | exclude:status | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| distill-trust-label | distill:trust-gradient | YES | 3/3 | pi:distilled=PASS, pi:human-fact=PASS |
| gotcha-guidance | deliver:gotcha | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| kb-context-first-read | mcp:context-doc-orientation | YES | 3/3 | pi:kb_context=PASS, pi:no-mem=PASS |
| kb-resume-mcp | mcp:resume-floor | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| knowledge-delivery | deliver:fact | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| link-delivery | deliver:link | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| live-capture-result | capture:live-tool-result | YES | 3/3 | pi:capture-on=PASS, pi:capture-off=PASS |
| mcp-map-navigation | mcp:map-then-search | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-pull | mcp:pull | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| mcp-search-filter | mcp:filtered-search | YES | 3/3 | pi:mcp=PASS, pi:no-mcp=PASS |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| no-secrets | guardrail:no-secrets | YES | 3/3 | pi:mcp kb_add(secret)=PASS |
| precedence-distractor | rerank:precedence-amid-noise | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| promotion-relabel | distill:promotion-agent-observable | YES | 3/3 | pi:promoted=PASS, pi:not-promoted=PASS |
| provstale-excluded | exclude:prov-status | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| resume-reflects-correction | continuity:anti-stale | YES | 3/3 | pi:resume:vfkb=PASS, pi:resume:naive=fail |
| role-precedence | attribution:precedence | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | 3/3 | pi:vfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | no | 0/3 | pi:gated=fail, pi:ungated=PASS |
| unverified-injected | trust:unverified-delivered | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
| verified-only-filter | mcp:verified-filter | YES | 3/3 | pi:verified-filter=PASS, pi:no-filter=PASS |
| vision-format | deliver:vision-pattern | YES | 3/3 | pi:vfkb=PASS, pi:none=fail |
