#!/usr/bin/env bash
# =============================================================================
# DevBrain x Antigravity -- install.sh
# Installs session tracking hooks into ~/.gemini/config/
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
SRC_CONFIG="$SCRIPT_DIR/src/config/hooks.reference.json"

if $IS_MACOS || $IS_LINUX || $IS_WSL; then
  GEMINI_CONFIG_DIR="$HOME/.gemini/config"
  HOOK_START_CMD="$HOME/.gemini/config/scripts/session-start.sh"
  HOOK_END_CMD="$HOME/.gemini/config/scripts/session-end.sh"
elif $IS_GITBASH; then
  USERPROFILE_NORM="${USERPROFILE//\\//}"
  GEMINI_CONFIG_DIR="$USERPROFILE_NORM/.gemini/config"
  HOOK_START_CMD="$USERPROFILE_NORM/.gemini/config/scripts/session-start.sh"
  HOOK_END_CMD="$USERPROFILE_NORM/.gemini/config/scripts/session-end.sh"
fi

DEST_SCRIPTS="$GEMINI_CONFIG_DIR/scripts"
DEST_SKILLS="$GEMINI_CONFIG_DIR/skills/devbrain"
SETTINGS_FILE="$GEMINI_CONFIG_DIR/hooks.json"
SETTINGS_BACKUP="$GEMINI_CONFIG_DIR/hooks.json.devbrain-backup"

# -- Uninstall ----------------------------------------------------------------
if [[ "${1:-}" == "--uninstall" ]]; then
  header "DevBrain x Antigravity -- Uninstall"

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
    ok "Restored hooks.json from backup"
  else
    warn "No backup found. Remove the hooks block from $SETTINGS_FILE manually."
    warn "Look for the SessionStart and SessionEnd entries added by DevBrain."
  fi

  echo -e "\n${GREEN}Uninstall complete.${RESET}"
  exit 0
fi

# -- Header -------------------------------------------------------------------
echo ""
echo -e "${BOLD}DevBrain x Antigravity -- Installer${RESET}"
echo "======================================"
echo ""

ENV_LABEL="macOS / Linux"
$IS_WSL     && ENV_LABEL="WSL (Windows Subsystem for Linux)"
$IS_GITBASH && ENV_LABEL="Git Bash (Windows)"

info "Detected environment : $ENV_LABEL"
info "Gemini config dir    : $GEMINI_CONFIG_DIR"
info "Hook command path    : $HOOK_START_CMD"

if $IS_GITBASH; then
  echo ""
  warn "Running in Git Bash. Hook paths will be registered with Windows-style paths."
  warn "If hooks do not fire, try install.ps1 in PowerShell instead:"
  warn "  powershell -ExecutionPolicy Bypass -File install.ps1"
fi

# -- Preflight checks ---------------------------------------------------------
header "Checking prerequisites"

# Gemini CLI
if command -v gemini &>/dev/null; then
  ok "Gemini/Antigravity CLI found: $(gemini --version 2>/dev/null || echo 'version unknown')"
else
  err "Gemini/Antigravity CLI not found. Make sure gemini is installed"
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
  ok "jq found -- hooks.json will be merged safely"
  JQ_AVAILABLE=true
else
  warn "jq not found -- manual merge instructions will be printed instead"
  warn "Install jq:  brew install jq  |  apt install jq  |  choco install jq  |  winget install jqlang.jq"
fi

# Source hooks directory exists
if [ ! -d "$SRC_HOOKS" ]; then
  err "src/hooks/ not found. Run this script from the integrations/antigravity/ directory."
  exit 1
fi

# -- Create directory structure -----------------------------------------------
header "Setting up directories"

mkdir -p "$DEST_SCRIPTS" "$DEST_SKILLS"
ok "$GEMINI_CONFIG_DIR/scripts/ ready"
ok "$GEMINI_CONFIG_DIR/skills/devbrain/ ready"

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

# -- Merge hooks.json ------------------------------------------------------
header "Merging hooks.json"

# Build the hooks block with the resolved absolute paths for this OS
HOOKS_BLOCK=$(cat <<HOOKSEOF
{
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
HOOKSEOF
)

if $JQ_AVAILABLE; then
  if [ -f "$SETTINGS_FILE" ]; then
    # Back up before touching anything
    cp "$SETTINGS_FILE" "$SETTINGS_BACKUP"
    ok "Backed up existing hooks.json -> hooks.json.devbrain-backup"

    # Check if DevBrain hooks are already present (idempotent re-install)
    EXISTING=$(jq '.SessionStart // empty' "$SETTINGS_FILE")
    if [ -n "$EXISTING" ]; then
      warn "SessionStart hook already exists in hooks.json"
      warn "Skipping merge to avoid duplicates."
      warn "To re-install cleanly: ./install.sh --uninstall && ./install.sh"
    else
      # Merge: keep all existing keys, add our hooks block alongside them
      MERGED=$(jq -s '
        .[0] as $existing |
        .[1] as $new |
        $existing * {
          "SessionStart": $new.SessionStart,
          "SessionEnd": $new.SessionEnd
        }
      ' "$SETTINGS_FILE" - <<< "$HOOKS_BLOCK")

      echo "$MERGED" > "$SETTINGS_FILE"
      ok "DevBrain hooks merged into hooks.json"
      info "Existing hooks were preserved"
    fi

  else
    # No settings file yet -- create fresh
    echo "$HOOKS_BLOCK" > "$SETTINGS_FILE"
    ok "Created hooks.json with DevBrain hooks"
  fi

else
  # No jq -- print instructions for manual merge
  echo ""
  warn "jq not available. Add the block below to: $SETTINGS_FILE"
  warn "(Create the file if it does not exist. If it already has hooks, merge SessionStart and SessionEnd.)"
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
  HAS_HOOK=$(jq '.SessionStart // empty' "$SETTINGS_FILE")
  [ -n "$HAS_HOOK" ] \
    && ok "SessionStart hook registered in hooks.json" \
    || { err "SessionStart not found in hooks.json"; PASS=false; }
fi

# -- Done ---------------------------------------------------------------------
echo ""
if $PASS; then
  echo -e "${GREEN}${BOLD}Installation complete.${RESET}"
  echo ""
  echo "  Open any project in Gemini/Antigravity CLI to activate tracking:"
  echo "    cd your-project && gemini"
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
