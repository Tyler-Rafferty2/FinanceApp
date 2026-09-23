#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

rm -rf dist/notifications
mkdir -p dist/notifications

npx esbuild src/lambdas/notifications/handler.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --outfile=dist/notifications/handler.js

rm -f dist/notifications.zip
cd dist/notifications

zip -r ../notifications.zip . >/dev/null
cd ../..

echo "Built dist/notifications.zip"
