# vtfkb L4 behavior record — deepseek/deepseek-v4-flash

- generated: 2026-06-03T12:29:56.181Z
- vtfkb: 8252b4e
- scenarios recorded: 8 (8 demonstrated)

| scenario | dimension | demonstrated | rows (label=verdict) |
|---|---|---|---|
| constitution-multi | constitution:aggregate | YES | pi:vtfkb=PASS, pi:none=fail |
| constitution-port | constitution:single | YES | pi:vtfkb=PASS, pi:none=fail |
| gotcha-guidance | deliver:gotcha | YES | pi:vtfkb=PASS, pi:none=fail |
| knowledge-delivery | deliver:fact | YES | pi:vtfkb=PASS, pi:none=fail |
| multi-fact-synthesis | synthesis:combine-2-facts | YES | pi:vtfkb=PASS, pi:none=fail |
| stale-supersession | exclude:supersession | YES | pi:vtfkb=PASS, pi:naive=fail |
| supersession-chain | exclude:supersession-chain | YES | pi:vtfkb=PASS, pi:naive=fail |
| vision-format | deliver:vision-pattern | YES | pi:vtfkb=PASS, pi:none=fail |
