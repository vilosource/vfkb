# Stop-nudge probe kit (2026-10-19)

Reproduces the transcript measurements behind [RFC-043](../../../rfc/RFC-043-stop-nudge-observer.md)
(brain `a91f82e76700` and `4f5077d1b89b`). Both scripts read Claude Code transcripts locally;
no transcript data is committed here.

- `nudge-fires.py <glob>...` counts each Stop-hook nudge's fires (from
  `hook_additional_context` attachments only), whether the agent wrote a handoff before the
  next user prompt, and whether the fire was on the session's final turn.

  ```
  python3 nudge-fires.py "$HOME/.claude-cldp/projects/-Users-jasonviloria-GitHub-vfkb" "$HOME/.claude/projects/-Users-jasonviloria-GitHub-vfkb"
  ```

  Point it at the repo's own session directory. A `*vfkb*` glob also matches L4 sandbox and
  probe directories. On 2026-10-19 that inflated the session count to 104, when there were
  19 real sessions; the fires all come from real ones.

- `turn-corpus.py <out.jsonl> <glob>...` writes one record per turn: the prompt, the final
  assistant text, brain writes and issue creation, and background mechanisms started. That
  file was the input to the hand labelling in `4f5077d1b89b`.

Caveats:
- Claude Code keeps transcripts for about 30 days, so a re-run covers a different window.
- Older transcripts without `promptSource` are skipped by `nudge-fires.py`.
- Before 2026-10-20 the scripts matched only `--tags` for CLI writes; the CLI flag is
  `--tag`. The first run therefore reported 14 acted and 10 declined, against 18 and 6 after
  the fix.
- "Acted" means a handoff was written before the next user prompt, not that it was a good
  handoff.
- The figures in RFC-043 are the 2026-10-19 run: 104 sessions, 23 B3 fires. A re-run the
  next day counted 108 sessions and 24 fires, because the session that wrote RFC-043 itself
  received one B3 nudge on its first turn.
