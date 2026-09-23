#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/digest
mkdir -p dist/digest

npx esbuild src/lambdas/digest/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/digest/handler.js

rm -f dist/digest.zip
cd dist/digest

zip -r ../digest.zip . >/dev/null
cd ../..

echo "Built dist/digest.zip"
