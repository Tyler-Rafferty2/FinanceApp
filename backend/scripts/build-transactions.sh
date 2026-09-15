#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/transactions
mkdir -p dist/transactions

npx esbuild src/lambdas/transactions/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/transactions/handler.js

rm -f dist/transactions.zip
cd dist/transactions

zip -r ../transactions.zip . >/dev/null
cd ../..

echo "Built dist/transactions.zip"
