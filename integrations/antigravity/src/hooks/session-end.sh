#!/usr/bin/env bash
# Runs in background – exit immediately
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

  # Calculate session metrics and notify DevBrain
  PROJECT_NAME=$(basename "$CWD")
  DURATION="unknown"
  FILES_COUNT=0

  if [ -f "$SESSION_FILE" ]; then
    DURATION=$(python3 -c "
import datetime, sys
try:
    with open('$SESSION_FILE', 'r') as f:
        for line in f:
            if line.startswith('started:'):
                s = line.split('started:')[1].strip().replace('Z', '')
                diff = datetime.datetime.utcnow() - datetime.datetime.fromisoformat(s)
                print(max(1, round(diff.total_seconds() / 60.0)))
                sys.exit(0)
except Exception:
    pass
print('unknown')
" 2>/dev/null)
  fi

  if [ -d "$CWD/.git" ]; then
    FILES_COUNT=$(git -C "$CWD" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  fi

  # Send notification to DevBrain
  curl -s -X POST http://localhost:3001/api/notify \
    -H "Content-Type: application/json" \
    -d "{\"project\":\"$PROJECT_NAME\",\"title\":\"Session complete — $PROJECT_NAME\",\"body\":\"Duration: ${DURATION}m, Files changed: $FILES_COUNT\",\"level\":\"info\"}" \
    --max-time 3 >/dev/null 2>&1

) &>/dev/null &

exit 0
