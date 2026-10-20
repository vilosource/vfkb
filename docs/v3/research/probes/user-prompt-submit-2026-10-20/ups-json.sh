#!/bin/sh
in=$(cat); printf '%s\n' "$in" >> "$PROBE_LOG"
printf '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"vfkb project knowledge: the next database migration is codenamed %s."}}\n' "$PROBE_SENT"
