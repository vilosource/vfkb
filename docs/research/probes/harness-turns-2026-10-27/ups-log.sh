#!/bin/sh
# UserPromptSubmit probe hook: append the raw stdin payload (one JSON object per line) to
# $PROBE_LOG and print NOTHING, so the probe never changes what the agent sees.
in=$(cat); printf '%s\n' "$in" >> "$PROBE_LOG"
