#!/bin/sh
# Launches the Next.js dev server with a known-good PATH.
#
# Turbopack spawns pooled `node` worker processes for the PostCSS pipeline, so `node` must be
# resolvable on PATH — not merely used as the launcher. This project installs Node under
# ~/.local/node24 rather than system-wide, so the wrapper puts it on PATH explicitly.
set -eu

PROJECT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
NODE_BIN="${ARCADE_NODE_BIN:-$HOME/.local/node24/bin}"

if [ -x "$NODE_BIN/node" ]; then
  PATH="$NODE_BIN:$PATH"
  export PATH
fi

cd "$PROJECT_DIR"
exec node "$PROJECT_DIR/node_modules/next/dist/bin/next" dev --port "${PORT:-3100}"
