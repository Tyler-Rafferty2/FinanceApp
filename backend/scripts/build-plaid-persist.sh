#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/plaid-persist
mkdir -p dist/plaid-persist

npx esbuild src/lambdas/plaid-persist/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/plaid-persist/handler.js

rm -f dist/plaid-persist.zip
cd dist/plaid-persist

zip -r ../plaid-persist.zip . >/dev/null
cd ../..

echo "Built dist/plaid-persist.zip"
