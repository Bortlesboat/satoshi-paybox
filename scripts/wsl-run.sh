#!/usr/bin/env bash
# Windows helper: run the Node 24 toolchain inside WSL2.
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/<path-to-repo>/scripts/wsl-run.sh <setup|install|unit|test|build|call ...>
set -e
export PATH="$HOME/.local/node24/bin:$PATH"
cd "$(dirname "$(readlink -f "$0")")/.."
cmd="${1:-test}"; shift || true
case "$cmd" in
  setup) bash scripts/wsl-setup.sh ;;
  install) pnpm install ;;
  unit) pnpm unit ;;
  test) pnpm test ;;
  build) pnpm build ;;
  call) node scripts/call.mjs "$@" ;;
  sh) bash -c "$*" ;;
esac
