#!/usr/bin/env bash
# =============================================================================
# DevBrain x Claude Code -- install.sh
# Installs session tracking hooks into ~/.claude/
# Supports: macOS, Linux, WSL, Git Bash on Windows
# For native Windows PowerShell: use install.ps1 instead
# =============================================================================

set -euo pipefail

# -- Colours ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
RESET='\033[0m'

ok()     { echo -e "${GREEN}[OK]${RESET}   $1"; }
info()   { echo -e "${BLUE}[-->]${RESET}  $1"; }
warn()   { echo -e "${YELLOW}[WARN]${RESET} $1"; }
err()    { echo -e "${RED}[ERR]${RESET}  $1"; }
header() { echo -e "\n${BOLD}--- $1 ---${RESET}"; }

# -- Detect OS and environment ------------------------------------------------
IS_WSL=false
IS_GITBASH=false
IS_MACOS=false
IS_LINUX=false

case "$(uname -s)" in
  Darwin)
    IS_MACOS=true
    ;;
  Linux)
    IS_LINUX=true
    if grep -qi microsoft /proc/version 2>/dev/null; then
      IS_WSL=true
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    IS_GITBASH=true
    ;;
  *)
    err "Unrecognised OS: $(uname -s)"
    err "On native Windows PowerShell, run install.ps1 instead."
    exit 1
    ;;
esac

# -- Resolve paths based on environment ---------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_HOOKS="$SCRIPT_DIR/src/hooks"
SRC_SKILLS="$SCRIPT_DIR/src/skills/devbrain"
SRC_CONFIG="$SCRIPT_DIR/src/config/settings.reference.json"

if $IS_MACOS || $IS_LINUX || $IS_WSL; then
  CLAUDE_DIR="$HOME/.claude"
  HOOK_START_CMD="$HOME/.claude/scripts/session-start.sh"
  HOOK_END_CMD="$HOME/.claude/scripts/session-end.sh"
elif $IS_GITBASH; then
  # Claude on Windows uses %APPDATA%\Claude (not ~/.claude)
  APPDATA_NORM="${APPDATA//\\//}"
  CLAUDE_DIR="$APPDATA_NORM/Claude"
  USERPROFILE_NORM="${USERPROFILE//\\//}"
  # Hook commands need paths Claude Code can resolve natively on Windows
  HOOK_START_CMD="$USERPROFILE_NORM/.claude/scripts/session-start.sh"
  HOOK_END_CMD="$USERPROFILE_NORM/.claude/scripts/session-end.sh"
fi

DEST_SCRIPTS="$CLAUDE_DIR/scripts"
DEST_SKILLS="$CLAUDE_DIR/skills/devbrain"
SETTINGS_FILE="$CLAUDE_DIR/settings.json"
SETTINGS_BACKUP="$CLAUDE_DIR/settings.json.devbrain-backup"

# -- Uninstall ----------------------------------------------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
  header "DevBrain x Claude Code -- Uninstall"

  if [ -f "$DEST_SCRIPTS/session-start.sh" ]; then
    rm -f "$DEST_SCRIPTS/session-start.sh" "$DEST_SCRIPTS/session-end.sh"
    ok "Removed hook scripts from $DEST_SCRIPTS"
  fi

  if [ -d "$DEST_SKILLS" ]; then
    rm -rf "$DEST_SKILLS"
    ok "Removed devbrain skill"
  fi

  if [ -f "$SETTINGS_BACKUP" ]; then
    cp "$SETTINGS_BACKUP" "$SETTINGS_FILE"
    ok "Restored settings.json from backup"
  else
    warn "No backup found. Remove the hooks block from $SETTINGS_FILE manually."
    warn "Look for the SessionStart and SessionEnd entries added by DevBrain."
  fi

  echo -e "\n${GREEN}Uninstall complete.${RESET}"
  exit 0
fi

# -- Header -------------------------------------------------------------------
echo ""
echo -e "${BOLD}DevBrain x Claude Code -- Installer${RESET}"
echo "======================================"
echo ""

ENV_LABEL="macOS / Linux"
$IS_WSL     && ENV_LABEL="WSL (Windows Subsystem for Linux)"
$IS_GITBASH && ENV_LABEL="Git Bash (Windows)"

info "Detected environment : $ENV_LABEL"
info "Claude config dir    : $CLAUDE_DIR"
info "Hook command path    : $HOOK_START_CMD"

if $IS_GITBASH; then
  echo ""
  warn "Running in Git Bash. Hook paths will be registered with Windows-style paths."
  warn "If hooks do not fire, try install.ps1 in PowerShell instead:"
  warn "  powershell -ExecutionPolicy Bypass -File install.ps1"
fi

# -- Preflight checks ---------------------------------------------------------
header "Checking prerequisites"

# Claude Code
if command -v claude &>/dev/null; then
  ok "Claude Code found: $(claude --version 2>/dev/null || echo 'version unknown')"
else
  err "Claude Code not found. Install from https://claude.ai/code"
  exit 1
fi

# python3 (used in hook scripts)
if command -v python3 &>/dev/null; then
  ok "python3 found: $(python3 --version)"
else
  err "python3 is required for the hook scripts."
  err "Install: brew install python3  |  apt install python3  |  winget install Python.Python.3"
  exit 1
fi

# jq -- needed for safe settings merge
JQ_AVAILABLE=false
if command -v jq &>/dev/null; then
  ok "jq found -- settings.json will be merged safely"
  JQ_AVAILABLE=true
else
  warn "jq not found -- manual merge instructions will be printed instead"
  warn "Install jq:  brew install jq  |  apt install jq  |  choco install jq  |  winget install jqlang.jq"
fi

# Source hooks directory exists
if [ ! -d "$SRC_HOOKS" ]; then
  err "src/hooks/ not found. Run this script from the integrations/claude-code/ directory."
  exit 1
fi

# -- Create directory structure -----------------------------------------------
header "Setting up directories"

mkdir -p "$DEST_SCRIPTS" "$DEST_SKILLS"
ok "$CLAUDE_DIR/scripts/ ready"
ok "$CLAUDE_DIR/skills/devbrain/ ready"

# -- Copy hook scripts ---------------------------------------------------------
header "Installing hook scripts"

cp "$SRC_HOOKS/session-start.sh" "$DEST_SCRIPTS/session-start.sh"
cp "$SRC_HOOKS/session-end.sh"   "$DEST_SCRIPTS/session-end.sh"
chmod +x "$DEST_SCRIPTS/session-start.sh" "$DEST_SCRIPTS/session-end.sh"
ok "session-start.sh installed"
ok "session-end.sh   installed"

# -- Copy skill ---------------------------------------------------------------
header "Installing DevBrain skill"

cp -r "$SRC_SKILLS/." "$DEST_SKILLS/"
ok "devbrain SKILL.md installed"

# -- Merge settings.json ------------------------------------------------------
header "Merging settings.json"

# Build the hooks block with the resolved absolute paths for this OS
HOOKS_BLOCK=$(cat <<HOOKSEOF
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_START_CMD",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$HOOK_END_CMD",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
HOOKSEOF
)

if $JQ_AVAILABLE; then
  if [ -f "$SETTINGS_FILE" ]; then
    # Back up before touching anything
    cp "$SETTINGS_FILE" "$SETTINGS_BACKUP"
    ok "Backed up existing settings.json -> settings.json.devbrain-backup"

    # Check if DevBrain hooks are already present (idempotent re-install)
    EXISTING=$(jq '.hooks.SessionStart // empty' "$SETTINGS_FILE")
    if [ -n "$EXISTING" ]; then
      warn "SessionStart hook already exists in settings.json"
      warn "Skipping merge to avoid duplicates."
      warn "To re-install cleanly: ./install.sh --uninstall && ./install.sh"
    else
      # Deep merge: keep all existing keys, add our hooks block alongside them
      MERGED=$(jq -s '
        .[0] as $existing |
        .[1] as $new |
        $existing * {
          "hooks": (
            ($existing.hooks // {}) + $new.hooks
          )
        }
      ' "$SETTINGS_FILE" - <<< "$HOOKS_BLOCK")

      echo "$MERGED" > "$SETTINGS_FILE"
      ok "DevBrain hooks merged into settings.json"
      info "Existing hooks and settings were preserved"
    fi

  else
    # No settings file yet -- create fresh
    echo "$HOOKS_BLOCK" > "$SETTINGS_FILE"
    ok "Created settings.json with DevBrain hooks"
  fi

else
  # No jq -- print instructions for manual merge
  echo ""
  warn "jq not available. Add the block below to: $SETTINGS_FILE"
  warn "(Create the file if it does not exist. If it already has a 'hooks' key,"
  warn " merge SessionStart and SessionEnd into it alongside your existing hooks.)"
  echo ""
  echo "$HOOKS_BLOCK" | sed 's/^/  /'
  echo ""
  info "This block is also saved at: $SRC_CONFIG"
fi

# -- Verify -------------------------------------------------------------------
header "Verification"

PASS=true

[ -x "$DEST_SCRIPTS/session-start.sh" ] \
  && ok "session-start.sh is executable" \
  || { err "session-start.sh missing or not executable"; PASS=false; }

[ -x "$DEST_SCRIPTS/session-end.sh" ] \
  && ok "session-end.sh is executable" \
  || { err "session-end.sh missing or not executable"; PASS=false; }

[ -f "$DEST_SKILLS/SKILL.md" ] \
  && ok "devbrain SKILL.md is present" \
  || { err "SKILL.md missing from $DEST_SKILLS"; PASS=false; }

if $JQ_AVAILABLE && [ -f "$SETTINGS_FILE" ]; then
  HAS_HOOK=$(jq '.hooks.SessionStart // empty' "$SETTINGS_FILE")
  [ -n "$HAS_HOOK" ] \
    && ok "SessionStart hook registered in settings.json" \
    || { err "SessionStart not found in settings.json"; PASS=false; }
fi

# -- Done ---------------------------------------------------------------------
echo ""
if $PASS; then
  echo -e "${GREEN}${BOLD}Installation complete.${RESET}"
  echo ""
  echo "  Open any project in Claude Code to activate tracking:"
  echo "    cd your-project && claude"
  echo ""
  echo "  On first session, DevBrain will create:"
  echo "    your-project/TASKS.md"
  echo "    your-project/sessions/YYYY-MM-DD_HH-MM_<id>/SESSION.md"
  echo ""
  echo "  To uninstall:"
  echo "    ./install.sh --uninstall"
  echo ""
else
  echo -e "${RED}${BOLD}Installation finished with errors. Review output above.${RESET}"
  exit 1
fi
