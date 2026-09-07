#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/migrate
mkdir -p dist/migrate

npx esbuild src/lambdas/migrate/handler.ts \
  --bundle \
  --platform=node \
  --target=node20 \
  --outfile=dist/migrate/handler.js

cp -r drizzle dist/migrate/drizzle

cd dist/migrate
zip -r ../migrate.zip . >/dev/null
cd ../..

echo "Built dist/migrate.zip"
