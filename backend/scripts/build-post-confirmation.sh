#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/post-confirmation
mkdir -p dist/post-confirmation

npx esbuild src/lambdas/post-confirmation/handler.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=dist/post-confirmation/handler.js

rm -f dist/post-confirmation.zip
cd dist/post-confirmation

zip -r ../post-confirmation.zip . >/dev/null
cd ../..

echo "Built dist/post-confirmation.zip"
