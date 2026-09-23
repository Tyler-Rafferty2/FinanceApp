#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/plaid-webhook
mkdir -p dist/plaid-webhook

npx esbuild src/lambdas/plaid-webhook/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/plaid-webhook/handler.js

rm -f dist/plaid-webhook.zip
cd dist/plaid-webhook

zip -r ../plaid-webhook.zip . >/dev/null
cd ../..

echo "Built dist/plaid-webhook.zip"
