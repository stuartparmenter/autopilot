#!/bin/bash
set -euo pipefail

# PostToolUse hook for EnterWorktree: reset worktree to latest default branch.
# Ensures every worktree starts from a clean, up-to-date state regardless
# of what HEAD was pointing at when the worktree was created.
#
# PostToolUse input includes tool_response (EnterWorktree result) and cwd
# (which is the worktree path after creation). We prefer tool_response
# fields but fall back to cwd.
#
# The worktree already has its own branch (created by EnterWorktree).
# We fetch and reset that branch to origin/<default>, so no checkout is needed
# (which would fail anyway — git forbids checking out a branch that's
# already checked out in another worktree).

input=$(cat)

# Try tool_response first (more explicit), fall back to cwd
worktree_path=$(echo "$input" | jq -r '.tool_response.worktreePath // .cwd // empty')

if [ -z "$worktree_path" ] || [ ! -d "$worktree_path" ]; then
  exit 0
fi

# Verify this is actually a git directory
if ! git -C "$worktree_path" rev-parse --git-dir >/dev/null 2>&1; then
  exit 0
fi

# Detect the default branch from the remote
default_branch=$(git -C "$worktree_path" remote show origin 2>/dev/null \
  | grep 'HEAD branch' | awk '{print $NF}')

if [ -z "$default_branch" ]; then
  # Fallback: try common names
  for candidate in main master; do
    if git -C "$worktree_path" rev-parse --verify "origin/$candidate" >/dev/null 2>&1; then
      default_branch="$candidate"
      break
    fi
  done
fi

if [ -z "$default_branch" ]; then
  echo '{"systemMessage": "WARNING: Could not detect default branch. Worktree may not be on the correct starting branch."}' >&2
  exit 2
fi

# Fetch latest default branch and reset the worktree's current branch to it.
# No checkout needed — the worktree already has its own branch, we just
# move it to point at origin/<default>.
git -C "$worktree_path" fetch origin "$default_branch" --quiet 2>/dev/null
git -C "$worktree_path" reset --hard "origin/$default_branch" --quiet 2>/dev/null

echo "{\"systemMessage\": \"Worktree reset to origin/$default_branch. Starting from clean, up-to-date default branch.\"}"
