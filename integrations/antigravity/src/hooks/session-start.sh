#!/usr/bin/env bash
# Reads hook JSON from stdin
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id','unknown'))")
CWD=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('cwd','.'))")
PROJECT_NAME=$(basename "$CWD")
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M")
SESSION_DIR="$CWD/sessions/${TIMESTAMP}_${SESSION_ID:0:8}"
SESSION_FILE="$SESSION_DIR/SESSION.md"

# 1. Scaffold TASKS.md if missing
if [ ! -f "$CWD/TASKS.md" ]; then
cat > "$CWD/TASKS.md" << EOF
---
project: $PROJECT_NAME
created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
last_updated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
---

# TASKS

## Phase 1: Setup
- [ ] Define initial goals

## Backlog
- [ ] Add tasks here
EOF
fi

# 2. Create session folder + file
mkdir -p "$SESSION_DIR"
cat > "$SESSION_FILE" << EOF
---
session_id: ${SESSION_ID:0:8}
project: $PROJECT_NAME
started: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
status: active
---

# Session: $TIMESTAMP

## Goals
<!-- Antigravity will fill this in based on your first prompt -->

## Work Done
<!-- Appended during session -->

## Decisions
<!-- Key choices made -->

## Open Items
<!-- What's left -->
EOF

# 3. Inject context into Antigravity's view (stdout goes to Antigravity)
echo "## DevBrain Session Started"
echo "Session: $TIMESTAMP | Project: $PROJECT_NAME"
echo ""
echo "### Current Tasks"
cat "$CWD/TASKS.md" 2>/dev/null | head -40
echo ""
echo "### Last Session"
ls -t "$CWD/sessions" 2>/dev/null | head -1 | xargs -I{} cat "$CWD/sessions/{}/SESSION.md" 2>/dev/null | head -20

exit 0
