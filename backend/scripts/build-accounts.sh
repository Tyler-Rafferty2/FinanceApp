#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/accounts
mkdir -p dist/accounts

npx esbuild src/lambdas/accounts/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/accounts/handler.js

rm -f dist/accounts.zip
cd dist/accounts

zip -r ../accounts.zip . >/dev/null
cd ../..

echo "Built dist/accounts.zip"
