#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

: "${VITE_CLERK_PUBLISHABLE_KEY:?Load the production frontend build environment first}"
: "${VITE_CLERK_PROXY_URL:?Load the production frontend build environment first}"

export NODE_ENV=production
export BASE_PATH=/
# Vite's config requires a port even when running a production build.
export PORT=22833

pnpm install --frozen-lockfile
pnpm run typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/consult-lawyer run build

echo "Ubuntu production build completed."
