#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="$ROOT/packages/openclaw/src/cli.ts"

echo "=== openclaw Local Test ==="
echo ""

# Step 1: Generate wallet (won't overwrite if exists)
echo "1. Ensuring wallet exists..."
bun "$CLI" wallet generate 2>/dev/null || true
echo ""

# Step 2: Show wallet
echo "2. Wallet info:"
bun "$CLI" wallet info
echo ""

# Step 3: Start proxy in background
echo "3. Starting proxy (verbose)..."
bun "$CLI" start -v &
PROXY_PID=$!
sleep 2

# Step 4: Health check
echo ""
echo "4. Health check:"
curl -s http://localhost:8403/health | python3 -m json.tool 2>/dev/null || echo "(failed)"
echo ""

# Step 5: List models
echo "5. Models (first 5):"
curl -s http://localhost:8403/v1/models | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in d.get('data', [])[:5]:
    print(f\"   {m['id']} ({m['owned_by']})\")
print(f\"   ... {len(d.get('data', []))} models total\")
" 2>/dev/null || echo "(failed)"
echo ""

# Step 6: Test completion
echo "6. Testing completion (expect 402 if unfunded):"
HTTP_CODE=$(curl -s -o /tmp/ottorouter-test-resp.json -w "%{http_code}" \
  -X POST http://localhost:8403/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-sonnet-4-6","messages":[{"role":"user","content":"Say hello in one word"}],"max_tokens":10}')
echo "   HTTP $HTTP_CODE"
cat /tmp/ottorouter-test-resp.json | python3 -m json.tool 2>/dev/null | head -20 || true
echo ""

# Cleanup
echo "7. Stopping proxy (PID $PROXY_PID)..."
kill $PROXY_PID 2>/dev/null || true
wait $PROXY_PID 2>/dev/null || true

echo ""
echo "=== Done ==="
