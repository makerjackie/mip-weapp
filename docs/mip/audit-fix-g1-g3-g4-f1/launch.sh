#!/bin/zsh
export NVM_DIR="$HOME/.nvm"
source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
nvm use 22.23.1 >/dev/null 2>&1
cd "$(dirname "$0")/../.." || exit 1
exec claude --dangerously-skip-permissions "$(cat "$(dirname "$0")/PROMPT.md")"
