#!/usr/bin/env bash
# 离线对账引擎与可恢复提交的确定性测试（Node + esbuild，无需浏览器）
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=tmp/.domain-test-build
mkdir -p "$OUT"
for t in offline-sync store-flow; do
  node_modules/.bin/esbuild "tmp/domain-tests/$t.test.ts" \
    --bundle --platform=node --format=esm --outfile="$OUT/$t.mjs" --log-level=warning
done
node "$OUT/offline-sync.mjs"
node "$OUT/store-flow.mjs"
