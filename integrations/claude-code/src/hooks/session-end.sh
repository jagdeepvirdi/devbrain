#!/usr/bin/env bash
# Runs in background — exit immediately
(
  INPUT=$(cat)
  CWD=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('cwd','.'))")
  TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")

  # Find the active session file (most recent)
  ACTIVE_SESSION=$(ls -t "$CWD/sessions" 2>/dev/null | head -1)
  SESSION_FILE="$CWD/sessions/$ACTIVE_SESSION/SESSION.md"

  if [ -f "$SESSION_FILE" ]; then
    # Mark session as completed
    sed -i "s/status: active/status: completed/" "$SESSION_FILE"
    echo "" >> "$SESSION_FILE"
    echo "## Session Ended" >> "$SESSION_FILE"
    echo "ended: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "$SESSION_FILE"
  fi

  # Update sessions index
  INDEX_FILE="$CWD/sessions/index.md"
  echo "| $TIMESTAMP | $ACTIVE_SESSION | completed |" >> "$INDEX_FILE"

  # Update TASKS.md last_updated timestamp
  if [ -f "$CWD/TASKS.md" ]; then
    sed -i "s/last_updated:.*/last_updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")/" "$CWD/TASKS.md"
  fi

) &>/dev/null &

exit 0