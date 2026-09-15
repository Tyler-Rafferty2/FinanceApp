#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/categories
mkdir -p dist/categories

npx esbuild src/lambdas/categories/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/categories/handler.js

rm -f dist/categories.zip
cd dist/categories

zip -r ../categories.zip . >/dev/null
cd ../..

echo "Built dist/categories.zip"
