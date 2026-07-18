# Changelog

## [0.4.1](https://github.com/vilosource/vfkb/compare/v0.4.0...v0.4.1) (2026-07-18)


### Bug Fixes

* **doctor:** P10-a trust cluster — four false positives ([#186](https://github.com/vilosource/vfkb/issues/186), [#188](https://github.com/vilosource/vfkb/issues/188), [#206](https://github.com/vilosource/vfkb/issues/206), [#212](https://github.com/vilosource/vfkb/issues/212)) ([#216](https://github.com/vilosource/vfkb/issues/216)) ([372bab1](https://github.com/vilosource/vfkb/commit/372bab1569a156421987cc336fc8000fe20adbb8))


### Documentation

* **claude:** release PRs ride the autonomous grant — merge-and-publish chain, no approval hold ([#210](https://github.com/vilosource/vfkb/issues/210)) ([db94ec6](https://github.com/vilosource/vfkb/commit/db94ec65885495c1c8136bf6a9568d04b42b57aa))
* **roadmap:** re-ratify — P10 trust-and-cadence phase (2026-07-18) ([#215](https://github.com/vilosource/vfkb/issues/215)) ([de11c68](https://github.com/vilosource/vfkb/commit/de11c6802e4914b76af84cf141bd46d97aa6efb8))

## [0.4.0](https://github.com/vilosource/vfkb/compare/v0.3.0...v0.4.0) (2026-07-18)


### Features

* **journal:** durable capture — untracked write-ahead journal + session-start recovery (ADR-0064, fixes [#175](https://github.com/vilosource/vfkb/issues/175)) ([a1cbc63](https://github.com/vilosource/vfkb/commit/a1cbc634f6ea3b352b6c9c24106085f3d0283cfc))
* **journal:** durable capture — write-ahead journal + recovery (ADR-0064, fixes [#175](https://github.com/vilosource/vfkb/issues/175)) ([c803c81](https://github.com/vilosource/vfkb/commit/c803c81e98aa4894a85b8b39035aa74420ff5a39))


### Bug Fixes

* **journal:** mirror only on the jsonl-fs backend — a non-fs backend's pseudo-location must never materialize on disk ([f865a91](https://github.com/vilosource/vfkb/commit/f865a913d42299ad346086a6ebd3030924411291))
* **journal:** mirror only on the jsonl-fs backend (stray memory:/ dir defect) ([f9181ee](https://github.com/vilosource/vfkb/commit/f9181eeb9820e0f94534124e1afc72eeef072e14))
* review-gate round-1 findings — torn-tail guard, source de-NUL, gitignore migration, atomic wal rewrite, kill-switch symmetry ([15a9cb3](https://github.com/vilosource/vfkb/commit/15a9cb39860daa039ccf273c7f32420f1faf5836))


### Documentation

* **adr:** ADR-0064 + ADR-0065 — operator ratification of RFC-034 (durable-capture journal) and RFC-035 (write-health loudness) ([1868921](https://github.com/vilosource/vfkb/commit/1868921622e2acd9e78ceb114f442edbba76bc76))
* **adr:** ADR-0064 + ADR-0065 — ratify RFC-034/RFC-035 (operator, 2026-07-18) ([b71491e](https://github.com/vilosource/vfkb/commit/b71491e928792a8a0dd60c5724ad63ace2a66df0))
* **review:** ADR-0052 record for 15a9cb3 — 2 rounds, 3 majors + minors all fixed or tracked, verdict MERGE ([f662822](https://github.com/vilosource/vfkb/commit/f662822f55b743124c95d841835574a08faf0482))
* **review:** ADR-0052 record for f865a91 — 1 round, verdict MERGE, capability-flag follow-up filed ([#208](https://github.com/vilosource/vfkb/issues/208)) ([adfc108](https://github.com/vilosource/vfkb/commit/adfc1089a4630b2afe6ffcd66adf88bf0c1527a0))
* **review:** fix governing-doc path in the f865a91 record (ADR-0044 actual filename) ([48c1815](https://github.com/vilosource/vfkb/commit/48c18158529f817f8ef87ace03bc9ae2618a935d))

## [0.3.0](https://github.com/vilosource/vfkb/compare/v0.2.3...v0.3.0) (2026-07-18)


### Features

* cross-repo operations pin + vfkb broadcast (ADR-0063 §2/§3), scenario-first ([9aa13dc](https://github.com/vilosource/vfkb/commit/9aa13dc36eb80b44f66893c3ed958501f2146330))
* cross-repo operations pin + vfkb broadcast (ADR-0063 §2/§3), scenario-first ([52cda30](https://github.com/vilosource/vfkb/commit/52cda30ed951d8be793d9629836bcdde98d190e4))
* engine-delivery signal — auto re-vendor PR on normalized bundle drift (ADR-0062) ([#182](https://github.com/vilosource/vfkb/issues/182)) ([cb27745](https://github.com/vilosource/vfkb/commit/cb2774572d4f08f1ec1583ed259edc3b23f03a70))


### Bug Fixes

* **broadcast:** heal wired-but-manifest-less brains instead of refusing; dedupe the auto cross-repo tag ([46319b9](https://github.com/vilosource/vfkb/commit/46319b9847fe8f748d7a2ee4cad5f65e4f58e318))
* **broadcast:** heal wired-but-manifest-less brains; dedupe auto cross-repo tag ([bd11887](https://github.com/vilosource/vfkb/commit/bd11887339895b77e9ad3f00d734cdd1c4993f52))
* **render:** budget-drop omission note always present + actionable ([#177](https://github.com/vilosource/vfkb/issues/177)) ([a710bc7](https://github.com/vilosource/vfkb/commit/a710bc726967798c8e9d4c18d15d469ee473ebdf))
* **render:** the budget-drop omission note is always present and actionable ([#177](https://github.com/vilosource/vfkb/issues/177)) ([359b9b1](https://github.com/vilosource/vfkb/commit/359b9b1df84c25438a158121b463294bb1dda131))
* review round-1 major — restore evicted lines when the note cannot fit even after full eviction ([814d07a](https://github.com/vilosource/vfkb/commit/814d07a7540cc1051d24456c5f061c30ab1cee04))
* review-gate findings — marker-shape prestamp guard, target dedup, dual-capability scenario gate, broadcast-seeded delivery arm ([bb254d0](https://github.com/vilosource/vfkb/commit/bb254d0ba9ab5ee527b9458b5c6799148c587308))
* review-gate findings — per-target heal failure (no thrown abort), healed reported on failed writes, refusal reason names entries.jsonl ([4f10701](https://github.com/vilosource/vfkb/commit/4f10701cc82dda97a8272cb82c6f7d8a0c19894e))


### Documentation

* ADR-0060 — tag every plugin release vfkb--v{version} (Phase 0 of install-path L4) ([#172](https://github.com/vilosource/vfkb/issues/172)) ([695ca68](https://github.com/vilosource/vfkb/commit/695ca68d0016b811d382c80a96114a84df51837c))
* ADR-0061 — enforce plugin bump-and-tag mechanically (version Brake + tag-on-merge; release-please rejected) ([#174](https://github.com/vilosource/vfkb/issues/174)) ([6f1b7d1](https://github.com/vilosource/vfkb/commit/6f1b7d1cef8d1dcf4c3900c2b1da3183adadfc17))
* **adr:** ADR-0063 — cross-repo brain write (accepts RFC-033, operator ratification 2026-07-17) ([b1120ce](https://github.com/vilosource/vfkb/commit/b1120ce7669b93ddc113808af812bc6c1565c3b4))
* **adr:** ADR-0063 — cross-repo brain write (accepts RFC-033) ([c69f564](https://github.com/vilosource/vfkb/commit/c69f5643fbfb3fe6f4e57e32f5071739c4ac2a9c))
* **adr:** ADR-0063 fidelity nits — v1 no-brain prohibition explicit, pin/broadcast coupling wording; session handoff in brain ([b690315](https://github.com/vilosource/vfkb/commit/b6903150e819ebab78eda208b0be50415e03b9b4))
* make the autonomous-PR workflow the standing default (Commit rules) ([#164](https://github.com/vilosource/vfkb/issues/164)) ([8bafa51](https://github.com/vilosource/vfkb/commit/8bafa516b59adc16ece14b840d2f2ce17eb90794))
* plan for the install-path delivery-proof L4 ([#171](https://github.com/vilosource/vfkb/issues/171)) ([9571cd5](https://github.com/vilosource/vfkb/commit/9571cd55a0546213e712ce890a3bf9efbeccbc8d))
* plugin-era consumer onboarding (ADR-0059 guard), bootstrap as fallback ([#168](https://github.com/vilosource/vfkb/issues/168)) ([d9752ed](https://github.com/vilosource/vfkb/commit/d9752edb0e2763917474d4bcbb1f132b6bc15c62))
* **review:** ADR-0052 record for 4f10701 — 2 rounds, 1 major + 2 minor all fixed, verdict MERGE ([f66cd53](https://github.com/vilosource/vfkb/commit/f66cd53e04579f57127a1d774fb2359bbf0b0517))
* **review:** ADR-0052 record for 814d07a — 2 rounds, 1 major + 2 minor, verdict MERGE ([f4d78aa](https://github.com/vilosource/vfkb/commit/f4d78aa45fa8932684703c47c8ef31879a192f56))
* **review:** ADR-0052 record for bb254d0 — 2 rounds, 1 major + 6 minor all fixed/accepted, verdict MERGE ([e9a099b](https://github.com/vilosource/vfkb/commit/e9a099bcb67e51b527a3d37cff218016d7ec1964))
* **rfc:** RFC-033 — cross-repo brain write (operation handoff broadcast) ([7ea540a](https://github.com/vilosource/vfkb/commit/7ea540ab21f21e477b0c4f1fb402da92d645f31b))
* **rfc:** RFC-033 — cross-repo brain write (operation handoff broadcast) ([7582bf0](https://github.com/vilosource/vfkb/commit/7582bf00c04ec645209620028ede3ba8c95186a8))
* **rfc:** RFC-033 amendments — ADR-0049 delivery channel decided, L4 contract hardened ([ef23908](https://github.com/vilosource/vfkb/commit/ef2390846aff491feb21712438c8d170e04f45cd))
* **rfc:** RFC-033 amendments — ADR-0049 delivery channel decided, L4 contract hardened (independent review) ([62d7f7b](https://github.com/vilosource/vfkb/commit/62d7f7ba2c1045d1f21d3c24469cd3f0aced7cc5))
* **rfc:** RFC-033 review fixes — compat-rule claim corrected, no-brain targets scoped out, ADR-0040 append safety cited ([df022ab](https://github.com/vilosource/vfkb/commit/df022abb6ab0c2c5a6c347afb7e4c267542ff5a7))
* **rfc:** RFC-033 verification-round fixes — §6 split into per-capability arms, stale delivery claim annotated, scenario renamed ([8ee020e](https://github.com/vilosource/vfkb/commit/8ee020ee9966e70cf68fa8c8858e8f2bc055d7df))
* **rfc:** RFC-034 durable capture (journal) + RFC-035 write-health loudness ([#175](https://github.com/vilosource/vfkb/issues/175)/[#176](https://github.com/vilosource/vfkb/issues/176)) ([51f294c](https://github.com/vilosource/vfkb/commit/51f294c44e0d997477f38515352eba6efce45c7e))
* **rfc:** RFC-034 durable-capture journal + RFC-035 write-health loudness — the [#175](https://github.com/vilosource/vfkb/issues/175)/[#176](https://github.com/vilosource/vfkb/issues/176) brain-loss cluster ([2a9d0ea](https://github.com/vilosource/vfkb/commit/2a9d0ea232c48c770794ca97476276d50ca6eebb))
* **rfc:** round-1 review fixes — engine facts corrected (LWW log, lock-free appends), (id,updated) prune key, redaction escape hatch, probe shape, index rows ([801210c](https://github.com/vilosource/vfkb/commit/801210c71f066c3de98235c9318d0ca3070cb5e9))
* **rfc:** round-2 phrase fixes — the last two union-by-id survivors now say (id, updated)-pair (frontmatter description + DoD invariant list) ([3c4f593](https://github.com/vilosource/vfkb/commit/3c4f593a5d555f892260846f50cdc3ee030c8abe))

## [0.2.3](https://github.com/vilosource/vfkb/compare/v0.2.2...v0.2.3) (2026-07-14)


### Bug Fixes

* **l4:** tool-gating false-red + bash-bypass (closes [#150](https://github.com/vilosource/vfkb/issues/150), [#151](https://github.com/vilosource/vfkb/issues/151)) ([#157](https://github.com/vilosource/vfkb/issues/157)) ([16c9bba](https://github.com/vilosource/vfkb/commit/16c9bbaad7b912820d01074cd2b259c1869a67b5))


### Documentation

* **adr:** ADR-0059 accepts RFC-032 — restore the vfkb INACTIVE signal (maintainer ratification) ([#155](https://github.com/vilosource/vfkb/issues/155)) ([a9fbbc1](https://github.com/vilosource/vfkb/commit/a9fbbc1dd5f299356ba5c120b7bef004d154cb3b))
* **ci:** record the OIDC path as VERIFIED (v0.2.2) ([#153](https://github.com/vilosource/vfkb/issues/153)) ([7c6248f](https://github.com/vilosource/vfkb/commit/7c6248f798759564ce329acf73ffc8d021591c10))

## [0.2.2](https://github.com/vilosource/vfkb/compare/v0.2.1...v0.2.2) (2026-07-13)


### Bug Fixes

* **ci:** idempotent publish + assert-with-retry — registry propagation broke the 0.2.1 run ([#135](https://github.com/vilosource/vfkb/issues/135)) ([122b9eb](https://github.com/vilosource/vfkb/commit/122b9ebfe71a19d69133442526ef3fd091708bd7))
* **ci:** quote publish step name — unquoted colon broke publish.yml YAML parse ([#133](https://github.com/vilosource/vfkb/issues/133)) ([c928bfc](https://github.com/vilosource/vfkb/commit/c928bfcd0fd9bd2f17178ec60a6ecfe08b3714ee))
* **ci:** set pipefail in the provenance-attestation check ([#148](https://github.com/vilosource/vfkb/issues/148)) ([306636f](https://github.com/vilosource/vfkb/commit/306636f9455a5e35b29ae94f5f0d9103080257b8))
* **cli:** --version crashed in every bundle deployment ([#143](https://github.com/vilosource/vfkb/issues/143)) ([c73cf8e](https://github.com/vilosource/vfkb/commit/c73cf8e88727a77e50b265eb19c409c8e00f9291))
* **mcp:** tags survive harness string-serialization; kb_supersede accepts tags ([#141](https://github.com/vilosource/vfkb/issues/141)) ([a4587da](https://github.com/vilosource/vfkb/commit/a4587dae572a39d7320e677fe3ac829c3f5df78e))


### Documentation

* **consumer:** the update process — one plugin update + one bundle refresh per machine, drift caveat ([#145](https://github.com/vilosource/vfkb/issues/145)) ([aa13f23](https://github.com/vilosource/vfkb/commit/aa13f237c870ce277ea89058b7bcece72744e11e))
* **readme:** npm install section — @viloforge/vfkb with provenance, citing the v0.2.1 delivery-proof canary run ([#136](https://github.com/vilosource/vfkb/issues/136)) ([ebafbd2](https://github.com/vilosource/vfkb/commit/ebafbd2df0a3ec3699d1e3bec44ac7950f0dbdb6))
* **rfc:** RFC-032 — restore the vfkb INACTIVE signal under plugin wiring ([#149](https://github.com/vilosource/vfkb/issues/149)) ([f30e44e](https://github.com/vilosource/vfkb/commit/f30e44efaf99aae5e5232fcd44c12b94cd31a054))

## [0.2.1](https://github.com/vilosource/vfkb/compare/v0.2.0...v0.2.1) (2026-07-11)


### Bug Fixes

* **pkg:** npm scope → @viloforge/vfkb + first-publish token bootstrap (ADR-0057) ([5cd46b6](https://github.com/vilosource/vfkb/commit/5cd46b6298c3daa4cb25723af96b3b4c1277886d))
* **pkg:** rename npm package to @viloforge/vfkb; one-time token bootstrap for first publish ([fc507ce](https://github.com/vilosource/vfkb/commit/fc507ce326acbb08f58813bc093714b9e1050a6f))


### Documentation

* runbook registry claim — npmjs, first publish pending (review minor-2, corrected) ([dd2bb0d](https://github.com/vilosource/vfkb/commit/dd2bb0d748eaa8f35dfcc1c03b8b62133fc903e5))

## [0.2.0](https://github.com/vilosource/vfkb/compare/v0.1.0...v0.2.0) (2026-07-11)


### Features

* ADR-0032 — rename env vars for clarity (VFKB_DATA_DIR + VFKB_BUNDLE_DIR) ([c5c6542](https://github.com/vilosource/vfkb/commit/c5c6542ebfe39bfbc3c632a7809b66bf252cd80c))
* ADR-0047 — brain export projections (vfkb export agents-md + okf), RED-first, both L4s DEMONSTRATED ([3f4daa8](https://github.com/vilosource/vfkb/commit/3f4daa8e1c3a433d5088411f68deaf3b23d758b0))
* **cli:** FR-1 — vfkb init (idempotent consumer scaffold) (ADR-0030) ([9927592](https://github.com/vilosource/vfkb/commit/9927592264838a775c86bbd39e748509a26e4a79))
* **cli:** FR-3 — vfkb import (mykb / adr / markdown) (ADR-0030) ([2c30db4](https://github.com/vilosource/vfkb/commit/2c30db4eeda8d0ddf06da6d7a34196a395e97d9e))
* **cli:** FR-4 — brain&lt;-&gt;engine version stamp + vfkb doctor (ADR-0030) ([a637669](https://github.com/vilosource/vfkb/commit/a6376692131ca68b9160bfb6bf7385261233728a))
* **cli:** vfkb --version — package version from the package's own manifest (ADR-0057 step 1) ([8907d51](https://github.com/vilosource/vfkb/commit/8907d5112cdbc5eefe93338bf69f37b3027d9c4e))
* **curator:** M2a — ACE curator safety foundation (RFC-006 -&gt; ADR-0021) ([69e5769](https://github.com/vilosource/vfkb/commit/69e57698a13685ed9e5fa735c846c29d494a26f1))
* **dist:** FR-2 — portable single-file engine bundles (ADR-0030) ([3ead82f](https://github.com/vilosource/vfkb/commit/3ead82f4a6ea3f610e1a48668bb71896df731c4e))
* **distiller:** M2b — auto-distill write-side + counters + corroborated promotion (ADR-0021) ([33a1e15](https://github.com/vilosource/vfkb/commit/33a1e15ecb636fb9a7303ad34cf9040dbd019ce4))
* **doctor:** detect a stale marketplace clone — RFC-024 §1, DEMONSTRATED 3/3 vs 0/3 ([2a84dfa](https://github.com/vilosource/vfkb/commit/2a84dfae362f9fe65e9da798a998a64b02494ce6))
* **doctor:** detect a stale marketplace clone (RFC-024 §1) ([00217ec](https://github.com/vilosource/vfkb/commit/00217eca17c9db54cf55a9bf56e63295ec285bed))
* **doctor:** opt-in npm currency check — --check-remote (ADR-0058) ([1c87eb8](https://github.com/vilosource/vfkb/commit/1c87eb8a24199c6a8ac8c314cdc4e2a943363a71))
* **doctor:** opt-in npm currency check — --check-remote (ADR-0058) ([a171d57](https://github.com/vilosource/vfkb/commit/a171d573af3105e8dc96dcb53ef38753c04c14e4))
* **engine:** ADR-0049 last-handoff pin — GREEN 3/3 vs 0/3 (claude-haiku-4-5) ([ab10b26](https://github.com/vilosource/vfkb/commit/ab10b26736991d4e23cbdb94bc6dd062f0ccd3e5))
* **export:** ADR-0047 — vfkb export agents-md + okf, RED-first, both L4s DEMONSTRATED ([31e2a2a](https://github.com/vilosource/vfkb/commit/31e2a2aad5f91d68e0f6aefe3d0b38b70be41718))
* **hook:** conditional Stop-hook decision-capture reminder (ADR-0027, accepts RFC-008) ([701879d](https://github.com/vilosource/vfkb/commit/701879d59174ea12a62b7caf551690ce3dffb1ff))
* **init:** ADR-0031 — committed bootstrap guards engine resolution / informs on unset VFKB_HOME ([27c0092](https://github.com/vilosource/vfkb/commit/27c0092614941c192cf26c54ebec9bf3b1bc28c5))
* **init:** emit the ADR-0041 merge=union attribute for consumer brains ([e96bd16](https://github.com/vilosource/vfkb/commit/e96bd16db1b7c63222e1aaee5d1d7464108f2764))
* **init:** emit the ADR-0041 merge=union attribute for consumer brains ([c35d475](https://github.com/vilosource/vfkb/commit/c35d4754c786372e67c750a2e7a9de0fe7a77075))
* **l4:** D-i — kb_search `verified` trust filter (scenario-first, ADR-0023) ([8876ca0](https://github.com/vilosource/vfkb/commit/8876ca03e660046ef570d8d572d756c70d907816))
* **l4:** D-ii — project context doc + kb_context (ADR-0025 ← RFC-007) ([00dbe2f](https://github.com/vilosource/vfkb/commit/00dbe2fbf0af45d1090c5891d74b6d524fab7cbc))
* **l4:** D-iii — corroborated promotion is agent-observable (relabel trust, ADR-0024) ([75574f6](https://github.com/vilosource/vfkb/commit/75574f6ea42f8740b0b610e2826e8e87ca7e3914))
* **l4:** D-iv — pi captures tool RESULTS live (auto-distill real failures) ([278a751](https://github.com/vilosource/vfkb/commit/278a751f5ba2d2c0354b9e27aaad90ce9301d313))
* **l4:** T5a — dockerized pi-coding L4 substrate + N=3 multi-trial (ADR-0022) ([d97511a](https://github.com/vilosource/vfkb/commit/d97511a16310a5ff170bc3843b5bd2726c222b5b))
* **l4:** T5b — dockerized claude-code L4 substrate via Max-subscription OAuth (ADR-0022) ([e8636b2](https://github.com/vilosource/vfkb/commit/e8636b206d5187ac09bfed47c2363b61215afb6b))
* **l4:** Track 4 — auto-distill-recall scenario (ADR-0021 §1 + M3, headline loop) ([5173fc1](https://github.com/vilosource/vfkb/commit/5173fc132a6266f5c71b573387f95055aebdd0c4))
* **l4:** Track 4 — continuity-resume scenario + fix pi resume-delivery gap (ADR-0020) ([9f31cd7](https://github.com/vilosource/vfkb/commit/9f31cd7bb4b73de7fe08072c1eefbba0f39ea8e4))
* **l4:** Track 4 — corroborated-promotion + Track-4 core complete (6/6, ADR-0021 §4) ([01a497d](https://github.com/vilosource/vfkb/commit/01a497d9d1561add889a3f8a3ad158da4dd525a3))
* **l4:** Track 4 — distill-trust-label scenario (ADR-0021 §1 containment) ([5a009a7](https://github.com/vilosource/vfkb/commit/5a009a79404532772dbdf023eb802787260486d2))
* **l4:** Track 4 — kb-resume-mcp scenario (ADR-0020 §5 MCP-pull floor) ([6161389](https://github.com/vilosource/vfkb/commit/6161389b6b9bd4591b348b7c8a898764adca4ce8))
* **l4:** Track 4 — resume-reflects-correction scenario (ADR-0020 anti-stale) ([6ec88f1](https://github.com/vilosource/vfkb/commit/6ec88f18edf9a7f3f546530e0ae0450bc1013927))
* **l4:** Track 4b scenario-first — role-precedence ✅ + 2 partials found unbuilt (ADR-0023) ([b9299ee](https://github.com/vilosource/vfkb/commit/b9299ee3118bb30ce135fa5fda52ebdda3dc1c81))
* **process:** /v2-review — adversarial pre-merge review gate for v2 initiatives ([#52](https://github.com/vilosource/vfkb/issues/52)) ([81c0544](https://github.com/vilosource/vfkb/commit/81c0544288b4ecb7f57f22996ba11150697f2ddc))
* **resume:** M3 — fold auto-distilled lessons into the resume digest (ADR-0020 Phase B) ([24dda78](https://github.com/vilosource/vfkb/commit/24dda788d69ddbba07f6aeda3ad122f5fe813539))
* **review:** the review rule gets a Brake (ADR-0052) ([87ba90a](https://github.com/vilosource/vfkb/commit/87ba90a495830e63926a869c855b779d9a077fbe))
* **review:** the review rule gets a Brake (ADR-0052) ([db8c06d](https://github.com/vilosource/vfkb/commit/db8c06d92fca0df468eb89fdc7efde7f63059c3c))
* **session-continuity:** M1 — derived, append-only resume record (ADR-0020) ([775fdac](https://github.com/vilosource/vfkb/commit/775fdacf229b81f712afee7d11321c9c719421f6))
* **session-end:** GAP-1 B1 agent-authored handoff nudge (settles RFC-011 §B → ADR-0034) ([c6b0d61](https://github.com/vilosource/vfkb/commit/c6b0d6110147bfc08ab07532655f13ecd15d77bd))
* **session-end:** GAP-1 B1 agent-authored handoff nudge (settles RFC-011 §B → ADR-0034) ([382487c](https://github.com/vilosource/vfkb/commit/382487ce88d3a7686bc8aa0d29112d882429b1d1))
* **session-end:** GAP-1 B2 deterministic handoff floor (ADR-0033) ([29ddace](https://github.com/vilosource/vfkb/commit/29ddace086282cabb6ddf9f37a7253b32fc8afd9))
* **session-end:** GAP-2 brain auto-commit (RFC-011 → ADR-0033) ([a420241](https://github.com/vilosource/vfkb/commit/a420241815ee738da99ca0027bc544db3b156e00))
* Track 9 Q0 hygiene — supersede rationale, MCP staleness (+ load-cap Brake found delivered) ([#27](https://github.com/vilosource/vfkb/issues/27)) ([c298525](https://github.com/vilosource/vfkb/commit/c29852565bf70598efc9e50ffdf83c370dbb03f5))
* **v2:** brain lock for read-decide-append critical sections (ADR-0040) ([#55](https://github.com/vilosource/vfkb/issues/55)) ([53099b8](https://github.com/vilosource/vfkb/commit/53099b816be1e03c272b6bc7ea8746e98f7d2183))
* **v2:** entries.jsonl merges by union (ADR-0041) — GitHub server-side answered ([#58](https://github.com/vilosource/vfkb/issues/58)) ([fc6e33b](https://github.com/vilosource/vfkb/commit/fc6e33b27b0f06b312e3e3287af7234d0637bd7d))
* **v2:** schema honesty — structural why, read-boundary validation, contradicts (ADR-0042) ([#61](https://github.com/vilosource/vfkb/issues/61)) ([c069d21](https://github.com/vilosource/vfkb/commit/c069d21b378688ee5188b8e301d8f28d570f45d2))
* **v2:** session backbone — real session identity from hook stdin (ADR-0039) ([#49](https://github.com/vilosource/vfkb/issues/49)) ([c9bc830](https://github.com/vilosource/vfkb/commit/c9bc830caaa6a7b7e083e7b15cec8e504c86851c))
* **v2:** storage-backend seam — the engine calls through an interface (ADR-0044) ([#64](https://github.com/vilosource/vfkb/issues/64)) ([822b176](https://github.com/vilosource/vfkb/commit/822b176fb72c598f1929c54c4d261eb164d9f129))
* vfkb --version + npm install-path proof, RED-first (ADR-0057 steps 1-2) ([6047100](https://github.com/vilosource/vfkb/commit/6047100941f2bebcc574564d8ef1b503ac2d497e))
* wire vfkb as the Claude Code native auto-layer in-repo (.mcp.json + .claude/settings.json) ([18ee49d](https://github.com/vilosource/vfkb/commit/18ee49d9ff78dc24c0959916293763c81adf3042))
* **wiring:** migrate this repo's auto-layer to the bootstrap/$VFKB_BUNDLE_DIR form (ADR-0030/0031/0032) ([1158314](https://github.com/vilosource/vfkb/commit/115831410e75db7bb846adbdc76e27a4f9dc510e))
* **wiring:** sandbox-validate auto-layer wiring before live promotion (ADR-0028) + wire Stop hook ([320d7b1](https://github.com/vilosource/vfkb/commit/320d7b1cbb59db8d498bc95a32ef9c11a7ec7472))


### Bug Fixes

* **cli,mcp:** close review round-1 minors — empty-value edges ([2162ed6](https://github.com/vilosource/vfkb/commit/2162ed6f9302469af4669cea5357fdad934e16b4))
* **cli:** error on unknown/repeated flags on every verb; list gains filters ([#95](https://github.com/vilosource/vfkb/issues/95)) ([412dd85](https://github.com/vilosource/vfkb/commit/412dd857bbacfeb3875119e123a04837e21b5b39))
* **cli:** silent-flag family — unknown/repeated flags error on every verb, list gains filters ([#95](https://github.com/vilosource/vfkb/issues/95)) ([ae15876](https://github.com/vilosource/vfkb/commit/ae15876812c54f16b49c0515959d457673d8c31e))
* derive default project name from brain dir / CLAUDE_PROJECT_DIR / cwd ([#76](https://github.com/vilosource/vfkb/issues/76)) ([95d719b](https://github.com/vilosource/vfkb/commit/95d719ba86556ba6d7b6627887e78e7f7696d121))
* **doctor:** harden plugin detection per adversarial review (round 2) ([af84d6f](https://github.com/vilosource/vfkb/commit/af84d6fe2ec494a9a316b4d4579d28a07987627f))
* **doctor:** honest axis-(a) currency wording + a robust L4 predicate ([6703b13](https://github.com/vilosource/vfkb/commit/6703b13b576eb2bfb2d4b7f359165f82c7fdf205))
* **doctor:** recognize plugin wiring (ADR-0045) — stop advising vfkb init on plugin-wired repos ([dd26813](https://github.com/vilosource/vfkb/commit/dd26813891fe07743932814d02e5be79f184af17))
* **doctor:** recognize plugin wiring (ADR-0045) — stop advising vfkb init on plugin-wired repos ([#77](https://github.com/vilosource/vfkb/issues/77)) ([391d318](https://github.com/vilosource/vfkb/commit/391d318a0662e0ec1e18ed3d0c7006795e4e73cd))
* **doctor:** review round 1 — cache under .signals/, drop detail self-prefix (PR [#125](https://github.com/vilosource/vfkb/issues/125)) ([31f76ae](https://github.com/vilosource/vfkb/commit/31f76aea3f45c72d261986fa04ec1d3058b6e5be))
* **doctor:** say the answer, not the mechanism, when the plugin is current ([b4dc0c0](https://github.com/vilosource/vfkb/commit/b4dc0c0ba21bd71a6b254d5305df20dd49a25494))
* **doctor:** the install line contradicted the currency line beside it ([0eb30de](https://github.com/vilosource/vfkb/commit/0eb30de524978a675b81c172ff5571da13ff80c6))
* **doctor:** the wording that passed the L4 asserted what the check never verified ([21c296e](https://github.com/vilosource/vfkb/commit/21c296ea9bd7f677903e0e5677786f5212c07393))
* **engine:** harden ADR-0049 pin per adversarial review (opus, round 1) ([c4966c5](https://github.com/vilosource/vfkb/commit/c4966c53a423f64d292bcdf6f538fd51c8a1e84f))
* **init:** anchor Claude Code hooks to $CLAUDE_PROJECT_DIR (closes [#22](https://github.com/vilosource/vfkb/issues/22)) ([2c0a9c7](https://github.com/vilosource/vfkb/commit/2c0a9c7e82c9d8118596c81a93a64b813bf0872e))
* **init:** anchor Claude Code hooks to $CLAUDE_PROJECT_DIR (closes [#22](https://github.com/vilosource/vfkb/issues/22)) ([1d291fc](https://github.com/vilosource/vfkb/commit/1d291fca9287eea7a33b3c9fe845ff5b822adb9a))
* **l4:** doctor-staleness — anchor the answer shape, verify EVIDENCE is a real quote ([abd2630](https://github.com/vilosource/vfkb/commit/abd2630c1e52a1682f6e135a9ec9f03cfe94bbcb))
* **l4:** doctor-staleness predicate/question fixes from the review gate ([44400cc](https://github.com/vilosource/vfkb/commit/44400cc238a9789833e37d9ffa9b25fbf66fd8de))
* make decision `--why` persist + normalize session-end git path ([6a9c6d2](https://github.com/vilosource/vfkb/commit/6a9c6d267aa6e806601288f790aaf779ab8e55fc))
* **pack:** prepack builds dist on npm pack — closes the stale-dist false GREEN (PR [#122](https://github.com/vilosource/vfkb/issues/122) review F1) ([a9e3a4e](https://github.com/vilosource/vfkb/commit/a9e3a4e9e852dd90a7ead839e4c24c248bd5518c))
* persist decision --why + normalize session-end git path ([f318fb1](https://github.com/vilosource/vfkb/commit/f318fb1eb03ac870e8f4cd0cbbc68a0ccfc39fbb))
* **review:** a merge commit is never stripped; only an operator may waive ([4d7e829](https://github.com/vilosource/vfkb/commit/4d7e829429919c9fb22016c66a7ef246eb8fb73f))
* **review:** the exempt list was dead code that read as protection ([d0b1e40](https://github.com/vilosource/vfkb/commit/d0b1e40295e1fed65bbd5817691f9f4d4f6aa8a3))
* **review:** the fixtures must not commit into a repo they do not own ([6c932f3](https://github.com/vilosource/vfkb/commit/6c932f37a1656c6f5d1e7e2f1e8b83e2c3fc0b38))
* **review:** the selftest's git fixtures need no ambient identity ([3167b2c](https://github.com/vilosource/vfkb/commit/3167b2c7f0fa28f25efe7b05bd111e4964d4f5e5))
* **version:** ENGINE_VERSION falls back to the package's own manifest (PR [#122](https://github.com/vilosource/vfkb/issues/122) review F4) ([b40508e](https://github.com/vilosource/vfkb/commit/b40508ea5440bca81b743987411c1206fc5a3e01))


### Documentation

* add CLAUDE.md (dogfooding dev guide) + seed .vfkb continuity for ~/VFKB/vfkb ([6d897b3](https://github.com/vilosource/vfkb/commit/6d897b38fad1d5014d4c9aadc0f5fdac1550568e))
* add consumer-onboarding hand-off prompt + session handoff (Track 7 complete) ([9501bbc](https://github.com/vilosource/vfkb/commit/9501bbc03d60d0661bcbd8867630fe1472e74c49))
* add STATUS-AND-ROADMAP (the missing post-v1 north-star) ([4113469](https://github.com/vilosource/vfkb/commit/411346930e9f92ea31f6c3355bc0aba9253e4d91))
* ADR-0048 — retire the wiring smoke gate (supersedes ADR-0028, closes [#82](https://github.com/vilosource/vfkb/issues/82)) ([27566e6](https://github.com/vilosource/vfkb/commit/27566e6843677110ce3b0ec4125d0adc2c863284))
* ADR-0048 — retire the wiring smoke gate (supersedes ADR-0028) ([1c85812](https://github.com/vilosource/vfkb/commit/1c85812cbdd0c6507fd2a9cc0b1356be6e681bb7))
* **adr:** accept RFC-010 -&gt; ADR-0030 (consumer integration & distribution); roadmap Track 7 ([ba19ab8](https://github.com/vilosource/vfkb/commit/ba19ab8911d38f7a51cde0321b65dd9e388e86a3))
* **adr:** accept RFC-012/013/014-019 as ADR-0037..0044 ([#43](https://github.com/vilosource/vfkb/issues/43)) ([44fef7f](https://github.com/vilosource/vfkb/commit/44fef7f95f55e37e2b92c586407fd85a1ca48e42))
* **adr:** ADR-0023 — agent-observable features are scenario-contract-first ([4eb42f6](https://github.com/vilosource/vfkb/commit/4eb42f6b462849eaf342d21dd76897b15e4e3bc4))
* **adr:** ADR-0029 — DoD = capability proven by an agent-driven sandboxed e2e use-case simulation ([45a7b51](https://github.com/vilosource/vfkb/commit/45a7b5158fc0280534f978cd25742775e0b172c8))
* **adr:** ADR-0036 — v2 uses a dedicated long-lived v2 branch, main stays release-only ([#32](https://github.com/vilosource/vfkb/issues/32)) ([9a5695b](https://github.com/vilosource/vfkb/commit/9a5695beab1988f2fc9b32d69b80c588e30a324a))
* **adr:** ADR-0045 — ratify RFC-021 (vfkb Claude Code plugin) ([#74](https://github.com/vilosource/vfkb/issues/74)) ([fc75848](https://github.com/vilosource/vfkb/commit/fc75848b59f8226499f7c37fdd09c728cb2356cf))
* **adr:** ADR-0050 — the L4 DoD gate is constitutional + mechanically enforced ([148a046](https://github.com/vilosource/vfkb/commit/148a046db42feb1f0609285ce0190bac3efb5bb4))
* **adr:** ADR-0051 — delivery is a capability, it is unproven, and saying so is a Brake ([51d09be](https://github.com/vilosource/vfkb/commit/51d09be2eccf9292fd945dd07dee086048e6bc39))
* **adr:** ADR-0051 — delivery is a capability, it is unproven, and saying so is a Brake ([9a650e4](https://github.com/vilosource/vfkb/commit/9a650e41823c04a67ffc91c3b099b5d757933562))
* **adr:** ADR-0052 asserted a branch-protection setting it never read ([26e26a2](https://github.com/vilosource/vfkb/commit/26e26a2a929ae3d77bbf62d949c4087edeaccf25))
* **adr:** ADR-0052 asserted a branch-protection setting it never read ([7484ca1](https://github.com/vilosource/vfkb/commit/7484ca1c69feba64389ea21209894116ca0ffc51))
* **adr:** ratify RFC-023 → ADR-0049 session-start handoff pinning ([5708ba9](https://github.com/vilosource/vfkb/commit/5708ba9abdb3cf16dea91182b63ecbe1ffe8462b))
* **adr:** ratify RFC-025..030 as ADR-0053..0058; sync statuses, indexes, brain ([d7f3045](https://github.com/vilosource/vfkb/commit/d7f30453d2abf9f1eed31c03b1983e82766df723))
* **adr:** review round-1 minors — ADR-0053 build-order phrasing; brain links for ADR-0053..0058 ([7842b6c](https://github.com/vilosource/vfkb/commit/7842b6cf9bc6292cccb7865778361e8c63bc362e))
* **CLAUDE.md:** add explicit standing rule for capturing decisions ([6f96621](https://github.com/vilosource/vfkb/commit/6f96621d86ba88489f6d485b0091bd42e0f6f495))
* **claude:** branch + PR-first workflow — never commit to main ([3e659e8](https://github.com/vilosource/vfkb/commit/3e659e8675c45c48db5ec105d034a8da64a646d0))
* community hygiene — CONTRIBUTING, SECURITY, CoC, templates, CODEOWNERS (ADR-0055) ([7eb13af](https://github.com/vilosource/vfkb/commit/7eb13af0188dc681aa683feccf0475995861e199))
* community hygiene files + test badge (ADR-0055) ([233ed2f](https://github.com/vilosource/vfkb/commit/233ed2f2ce42f5c15b4047f240987a1ecfbacb5d))
* complete the ADR-0048 sweep — CLAUDE.md DoD bullet + FEATURES.md proof list (review findings 2/5) ([e1e8e0d](https://github.com/vilosource/vfkb/commit/e1e8e0d50e8dcd27aabc307f6fd717c1bd4ea38d))
* consumer-onboarding hand-off prompt + Track 7 handoff ([5c92ce1](https://github.com/vilosource/vfkb/commit/5c92ce175319a54def2f65c1ef6e7a8b8b4c794b))
* FEATURES.md verified rewrite + agent-memory landscape survey (July 2026) ([#25](https://github.com/vilosource/vfkb/issues/25)) ([2d7ab4a](https://github.com/vilosource/vfkb/commit/2d7ab4a7b5632808c76477b170f1f18c05b64088))
* FR-5 — CONSUMER-ONBOARDING.md; roadmap Track 7 build COMPLETE (ADR-0030) ([86f8a9f](https://github.com/vilosource/vfkb/commit/86f8a9fcb420cf2883cf2146c742091fdef515c2))
* full alignment audit — sync all docs to the shipped state (@ ab8d6bd) ([398322e](https://github.com/vilosource/vfkb/commit/398322e1b367ae51d49e47955a56b955b613954f))
* H2a fleet-wiring implementation plan (grounded in real vafi shapes) ([1d3d8b5](https://github.com/vilosource/vfkb/commit/1d3d8b54211f85636d64ef8230e7dbed30fbf2e9))
* multi-agent dev-concurrency corner cases (discussion notes) ([#30](https://github.com/vilosource/vfkb/issues/30)) ([d6242d0](https://github.com/vilosource/vfkb/commit/d6242d022fc3e7491cc00e91ad319c4111c719c1))
* **onboarding:** fix VFKB_DATA_DIR footgun + mykb workspace-journal caveat ([a42dbd6](https://github.com/vilosource/vfkb/commit/a42dbd6f6e4b69385aae079175e9dcb6ea34bb24))
* **onboarding:** fix VFKB_DATA_DIR footgun + mykb workspace-journal caveat ([04d3dc3](https://github.com/vilosource/vfkb/commit/04d3dc3887b059ce7a8eba78aa8773fd709a76de))
* **onboarding:** soften 'live session is fine' — hooks are CWD-relative too (vfkb[#22](https://github.com/vilosource/vfkb/issues/22)) ([88d96e9](https://github.com/vilosource/vfkb/commit/88d96e9182f9edd0331c399aacf400ec1b6be636))
* ratify RFC-020 → ADR-0046 + ship Phase 0 (OKF frontmatter retrofit, validated strict) ([bf2797e](https://github.com/vilosource/vfkb/commit/bf2797efe6cdd28f8123c80c6762b8bde41baa4c))
* **readme:** public-facing README — positioning, comparison, lineage; add MIT LICENSE ([7c8fa0e](https://github.com/vilosource/vfkb/commit/7c8fa0ea1d4bea5d29f4781d6465c53ef190eaec))
* **readme:** public-facing README + MIT LICENSE ([15c4b21](https://github.com/vilosource/vfkb/commit/15c4b21bb82a274a56f32f70ff16ef3a062eb8c1))
* refresh STATUS-AND-ROADMAP to current overall state (2026-06-25) ([fcc773d](https://github.com/vilosource/vfkb/commit/fcc773d861a9924e5e717026a2e0bbc117da5b55))
* **rfc-020:** gap-review revision — scope the ratchet, name its Brakes, reconcile with shipped ADR-0045/okf-skill ([a9f9f07](https://github.com/vilosource/vfkb/commit/a9f9f07f5208c532a14ff8905de9fd337a7861a5))
* **rfc-020:** replace ASCII box diagram with a Mermaid flowchart ([660af33](https://github.com/vilosource/vfkb/commit/660af338b070a2ec304b1fef95e98c24d14610c1))
* **rfc-021:** resolve review findings + record Phase 0 results ([#73](https://github.com/vilosource/vfkb/issues/73)) ([0eeb38b](https://github.com/vilosource/vfkb/commit/0eeb38bed92c4fd802f77aa2598c768287ff32e9))
* RFC-022 → ADR-0047 — brain export projections (Track 9 Q3), adversarially reviewed twice ([59c73be](https://github.com/vilosource/vfkb/commit/59c73bece51fb990af011f76ea30def48aaaf5b9))
* **rfc:** add RFC-010 — consumer integration & distribution contract ([ba268fe](https://github.com/vilosource/vfkb/commit/ba268fe9e9ee8478d9c466fdfb7f260ec6b0bc7f))
* **rfc:** add RFC-011 — session-end continuity (safe-by-default /exit) ([4277ac0](https://github.com/vilosource/vfkb/commit/4277ac0bd210b3755fb572f36c4941920a1e2c0a))
* **rfc:** decompose RFC-025 into per-workstream RFCs 026-030 (ASDLC) ([8e76a85](https://github.com/vilosource/vfkb/commit/8e76a859bc68ef1fc43f3d5481b73da0048631d4))
* **rfc:** RFC-007 — project context doc + kb_context (D-ii, Proposed) ([9e6ec1e](https://github.com/vilosource/vfkb/commit/9e6ec1eb3f2a9897efd518c775db6dc15ddf239f))
* **rfc:** RFC-008 (WIP) decision-capture reminder via a conditional Stop-hook + handoff ([5758609](https://github.com/vilosource/vfkb/commit/5758609d2bafd45f464059efcf5f613ff4a2ee5a))
* **rfc:** RFC-008 Stop-hook contract empirically verified; split L4 work into RFC-009 ([cfa568f](https://github.com/vilosource/vfkb/commit/cfa568fe953f5a25723d07c78ba7d99c39ee2032))
* **rfc:** RFC-010 Open Item [#1](https://github.com/vilosource/vfkb/issues/1) resolved — MCP single-file bundle proven ([bffc933](https://github.com/vilosource/vfkb/commit/bffc9332b7fb612884e5923dddae1f58e09c28e0))
* **rfc:** RFC-011 self-review revisions (commit-scope fix + GAP-1 reframe) ([9b45603](https://github.com/vilosource/vfkb/commit/9b456039ae4405390719d458a665373c8dd604c3))
* **rfc:** RFC-012 — deterministic contradiction surfacing at write time (Track 9 Q1) ([#28](https://github.com/vilosource/vfkb/issues/28)) ([47a8765](https://github.com/vilosource/vfkb/commit/47a876505a30abca5d1d95031d3ec70ae820a06d))
* **rfc:** RFC-013 — cross-project brain query (read-only recall from a sibling .vfkb) ([#29](https://github.com/vilosource/vfkb/issues/29)) ([0f0fceb](https://github.com/vilosource/vfkb/commit/0f0fceb99ff9371e52a77f92813042d9e54598d1))
* **rfc:** RFC-014..019 — the first slice-up of v2 (all Proposed) ([#35](https://github.com/vilosource/vfkb/issues/35)) ([03c44c8](https://github.com/vilosource/vfkb/commit/03c44c8561aa24e1f0498a1f966201dab384584c))
* **rfc:** RFC-020 — layered knowledge management (vfkb/graphify/OKF) ([d4779f1](https://github.com/vilosource/vfkb/commit/d4779f196e0384fde3bb3699d81d40d3c0872a5e))
* **rfc:** RFC-021 — vfkb as a Claude Code plugin ([#72](https://github.com/vilosource/vfkb/issues/72)) ([76acde8](https://github.com/vilosource/vfkb/commit/76acde8c6ec3cc09b7dd6615b631a7f239c80e17))
* **rfc:** RFC-023 session-start briefing — deterministic handoff pinning + Haiku-pinned brief skill ([c81b560](https://github.com/vilosource/vfkb/commit/c81b560baf3d9557accb75fbf2484f373f14dc75))
* **rfc:** RFC-024 — the delivery surface is part of the surface ([e2edcfa](https://github.com/vilosource/vfkb/commit/e2edcfad20dba12e4ab21a053bdb7f1910a7472d))
* **rfc:** RFC-024 v2 — rewrite after adversarial review ([adf92e6](https://github.com/vilosource/vfkb/commit/adf92e6b48263f5e5ee2a5836cdcb6910dec2446))
* **rfc:** RFC-024 v3 — fix two verification-first failures found in round 2 ([a5eebdb](https://github.com/vilosource/vfkb/commit/a5eebdbd2f1a3ad8fe3a22dcac378c09481a39e6))
* **rfc:** RFC-024 v4 — the L4 would have gone green; restructure around a detector ([5cf7ba9](https://github.com/vilosource/vfkb/commit/5cf7ba9164931d0738eff03c24314d4a198ed209))
* **rfc:** RFC-024 v5 — fix a false [probe], comply with the gate, rename ([db424cc](https://github.com/vilosource/vfkb/commit/db424ccc06e44dac05904d125d95d156392f0735))
* **rfc:** RFC-024 v6 — stop deciding the operator's question; drop axis (b) ([02b2038](https://github.com/vilosource/vfkb/commit/02b2038138bd964cf6424cd9f2b7255121905ebb))
* **rfc:** RFC-024 v7 — fix the `fail` regression left by dropping axis (b) ([242d235](https://github.com/vilosource/vfkb/commit/242d2356e7935911e7aea367acf733be4d2f2204))
* **rfc:** RFC-024 v8 — fix the docker miscount; clear round-7 minors ([ebb828e](https://github.com/vilosource/vfkb/commit/ebb828e847c63269ea40442ab7eced5804d78d64))
* **rfc:** RFC-024 v9 — operator ratifies Reading B; the disclosure gets a Brake ([1e694b5](https://github.com/vilosource/vfkb/commit/1e694b51d7ec526312eff73e912ce9e2ab7391fe))
* **rfc:** RFC-025 — going public: release engineering, versioning, update awareness ([5e6eb17](https://github.com/vilosource/vfkb/commit/5e6eb17a5863ffa3569441f4a29d296cfa284444))
* **rfc:** RFC-025..030 — going public, decomposed per ASDLC ([e4b52a3](https://github.com/vilosource/vfkb/commit/e4b52a3ee9d5d63d99385d2aa55bca2dd27ad404))
* **rfc:** RFC-031 — branch-aware brain visibility ([02ebd1d](https://github.com/vilosource/vfkb/commit/02ebd1d30152df4f8884ccc55112eca8ed1725b8))
* roadmap gap-audit — pre-decide D-iii/D-iv, mark D-ii autonomy ceiling, fix drift ([ee019fa](https://github.com/vilosource/vfkb/commit/ee019fa9b8ecafecf83e15b07d3ee6c3f70992fb))
* **roadmap:** correct H1 — the ingest design is already ratified ([e0a4055](https://github.com/vilosource/vfkb/commit/e0a40552d2e1bd532ebc3925c03e1eeeb899cf14))
* **roadmap:** full L4 re-pin done (pi 32/33, claude 31/32) — only the bundle rebuild + re-vendor gates the ship PR ([59fd742](https://github.com/vilosource/vfkb/commit/59fd7426f23e9f832fba1783d1bd2eabefe2f478))
* **roadmap:** pre-ship checklist closed out (PRs 79-81 merged, pi arm green, 199/199 on v2) ([baf56bb](https://github.com/vilosource/vfkb/commit/baf56bb7e618bf84a3b9522bcba0cfa7ef7e898c))
* **roadmap:** re-ratify — Track 6 decision-capture fork COMPLETE + capture generalizes ([f1c8afb](https://github.com/vilosource/vfkb/commit/f1c8afb5e7a83bc1656e3acc704fdcc8caf3f8b4))
* **roadmap:** re-ratify H4 — Track 5 dockerized L4 substrate + Track 4 Track-1 coverage (ADR-0022) ([332e709](https://github.com/vilosource/vfkb/commit/332e70994f8afc3e61e962c3dc3526b1825166e0))
* **roadmap:** re-ratify Track 4b order — encode the operator's D-i decision (roadmap-as-authority) ([4f19226](https://github.com/vilosource/vfkb/commit/4f192261040a2d1c268054e0b3865d3e399218cb))
* **roadmap:** record H0 outcome — v1 cleanly closed (in-repo) ([ab149ce](https://github.com/vilosource/vfkb/commit/ab149ce17578927f8acdb4bc9a251ba5c7acc7ed))
* **roadmap:** refresh §1 snapshot — date 2026-06-28, 95/95, Track 4/4b/5 all complete ([ab8d6bd](https://github.com/vilosource/vfkb/commit/ab8d6bdc892d1086a8bc3331a48ee1c8daabc030))
* **roadmap:** Track 9 re-ratified reconciled with the v2 fork (supersedes unmerged [#26](https://github.com/vilosource/vfkb/issues/26)) ([#41](https://github.com/vilosource/vfkb/issues/41)) ([2463ddb](https://github.com/vilosource/vfkb/commit/2463ddb7d98c8c9dd9861c9e2852b12335c277f2))
* **roadmap:** v2 pre-ship checklist closed out — only the re-pin decision gates the ship PR ([656e391](https://github.com/vilosource/vfkb/commit/656e3918c7ac4d547e320a3a9be1b265395ca8b6))
* **roadmap:** v2 targeted L4 regression ALL GREEN ([#69](https://github.com/vilosource/vfkb/issues/69)) ([d5051b7](https://github.com/vilosource/vfkb/commit/d5051b72b1ea2369be78f89d8e5f6a447f548bb6))
* **roadmap:** V2-1 session backbone DONE (DoD observed); V2-2 next ([#50](https://github.com/vilosource/vfkb/issues/50)) ([66dbd4f](https://github.com/vilosource/vfkb/commit/66dbd4f087964edc412cd7c15eb0d8e3a5eed841))
* **roadmap:** V2-2 lock DONE (review gate run); V2-3 next ([#56](https://github.com/vilosource/vfkb/issues/56)) ([10274bf](https://github.com/vilosource/vfkb/commit/10274bfa5dbfac9f7a58d13b84ffb14514c145ea))
* **roadmap:** V2-3 merge=union DONE (GitHub answer recorded); V2-4 next ([#59](https://github.com/vilosource/vfkb/issues/59)) ([a869e6f](https://github.com/vilosource/vfkb/commit/a869e6ff9117661965ff1d3bea070f34244ffe72))
* **roadmap:** V2-4 schema honesty DONE; V2-6 next ([#62](https://github.com/vilosource/vfkb/issues/62)) ([8287738](https://github.com/vilosource/vfkb/commit/8287738463047f861a26c2dcd0ba571d1a97d927))
* **roadmap:** V2-6 DONE — all non-gated v2 initiatives complete ([#65](https://github.com/vilosource/vfkb/issues/65)) ([f1aa236](https://github.com/vilosource/vfkb/commit/f1aa2364c46d253ba749d346e2320e2417f1700a))
* **roadmap:** V2-ROADMAP.md — per-initiative v2 execution tracker ([#47](https://github.com/vilosource/vfkb/issues/47)) ([7e53014](https://github.com/vilosource/vfkb/commit/7e53014c3fc67afd379dd655f098ef6d7a62d5fb))
* **runbook:** operator runbook for installing & configuring vfkb in Claude Code ([0187e55](https://github.com/vilosource/vfkb/commit/0187e55ba20347c716a267551006f79e699117fb))
* scope — vafi/vtaskforge integration is out of scope for vtfkb dev now ([1447879](https://github.com/vilosource/vfkb/commit/1447879e33df762b4ddd40e96d815ecb85e86009))
* **status:** stamp M2b commit sha (33a1e15) ([fe4e30d](https://github.com/vilosource/vfkb/commit/fe4e30dd96f7a2635b20aadd0b7b38bba378382d))
* **status:** stamp M3 commit sha (24dda78) ([b950d8c](https://github.com/vilosource/vfkb/commit/b950d8c090066927a639568200fcb7c28e5e0487))
* v2 shipped — roadmap 🚢 close-out + CLAUDE.md current-state refresh ([94db9a9](https://github.com/vilosource/vfkb/commit/94db9a9479aabfef384dfdc888e67d162f68fee7))
* v2 shipped — roadmap close-out + CLAUDE.md current-state refresh ([9880080](https://github.com/vilosource/vfkb/commit/98800800acb761fcf10fb064b26f6e58e1ac0093))
* vendor vtfkb design + ADRs into the repo (self-contained) ([217d28c](https://github.com/vilosource/vfkb/commit/217d28c3ba3235f9e2ba4f212f9ee22be483f490))
* vfkb v2 vision — session backbone + consolidated brainstorm ([#31](https://github.com/vilosource/vfkb/issues/31)) ([efd259b](https://github.com/vilosource/vfkb/commit/efd259bd4a0a3c1d8d764f596f4b3e8132a165d0))
