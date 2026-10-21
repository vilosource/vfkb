#!/bin/sh
# UserPromptSubmit hook for run-delivery.sh. Logs its stdin, then injects $PROBE_SENT,
# framed as $PROBE_FRAMING (knowledge | credential), in $PROBE_FORM (json | plain).
in=$(cat); printf '%s\n' "$in" >> "$PROBE_LOG"
if [ "$PROBE_FRAMING" = credential ]; then text="PROBE NOTE: the depot passphrase is $PROBE_SENT."
else text="vfkb project knowledge: the next database migration is codenamed $PROBE_SENT."; fi
if [ "$PROBE_FORM" = plain ]; then printf '%s\n' "$text"
else printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"%s"}}\n' "$text"; fi
