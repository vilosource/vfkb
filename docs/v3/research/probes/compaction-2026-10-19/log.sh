#!/bin/sh
# append stdin JSON, tagged with the event name given as $1
printf '{"_ev":"%s","payload":%s}\n' "$1" "$(cat)" >> "$PROBE_LOG"
