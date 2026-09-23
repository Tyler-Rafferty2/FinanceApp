#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/plaid-link
mkdir -p dist/plaid-link

npx esbuild src/lambdas/plaid-link/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/plaid-link/handler.js

rm -f dist/plaid-link.zip
cd dist/plaid-link

zip -r ../plaid-link.zip . >/dev/null
cd ../..

echo "Built dist/plaid-link.zip"
