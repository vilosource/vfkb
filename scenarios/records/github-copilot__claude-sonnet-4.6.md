# vtfkb L4 behavior record — github-copilot/claude-sonnet-4.6

- generated: 2026-06-03T13:25:04.222Z
- vtfkb: 678af37
- scenarios recorded: 18 (17 demonstrated)

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
| multi-fact-synthesis | synthesis:combine-2-facts | YES | pi:vtfkb=PASS, pi:none=fail |
| precedence-distractor | rerank:precedence-amid-noise | YES | pi:vtfkb=PASS, pi:naive=fail |
| provstale-excluded | exclude:prov-status | YES | pi:vtfkb=PASS, pi:naive=fail |
| stale-expiry | exclude:valid_until | YES | pi:vtfkb=PASS, pi:naive=fail |
| stale-supersession | exclude:supersession | YES | pi:vtfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | pi:vtfkb=PASS, pi:naive=fail |
| tool-gating | guardrail:tool-gating | no | pi:gated=PASS, pi:ungated(baseline)=fail |
| unverified-injected | trust:unverified-delivered | YES | pi:vtfkb=PASS, pi:none=fail |
| vision-format | deliver:vision-pattern | YES | pi:vtfkb=PASS, pi:none=fail |
