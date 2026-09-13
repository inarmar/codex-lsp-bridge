#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-v0.5.0}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
TMP_DIR="$(mktemp -d)"
WORKTREE="$TMP_DIR/worktree"

cleanup() {
  if [[ -d "$WORKTREE" ]]; then
    git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "==> Fetching tags"
git -C "$REPO_ROOT" fetch --tags origin

echo "==> Checking out $VERSION"
git -C "$REPO_ROOT" worktree add --detach "$WORKTREE" "$VERSION"

cd "$WORKTREE"

echo "==> Installing dependencies"
npm ci

echo "==> Verifying release"
npm run ci:verify

echo "==> Packing"
PACKAGE="$(npm pack --ignore-scripts --silent)"
PACKAGE_PATH="$WORKTREE/$PACKAGE"

echo "==> Installing $PACKAGE globally"
sudo npm install -g "$PACKAGE_PATH"

echo
echo "Installed:"
codex-lsp-bridge --help >/dev/null
command -v codex-lsp-bridge
npm list -g codex-lsp-bridge --depth=0