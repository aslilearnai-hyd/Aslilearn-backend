#!/bin/bash

# Quick test of the proxy endpoint
# Run this on your server to verify the proxy works

echo "Testing proxy endpoint..."
echo ""

# Test with a PDF URL
TEST_URL="https://ncert.nic.in/textbook/pdf/hegp1ps.pdf"
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_URL'))" 2>/dev/null || echo "$TEST_URL")

echo "Testing: http://localhost:5000/api/proxy/content?url=$ENCODED_URL"
echo ""

# Test locally
curl -I "http://localhost:5000/api/proxy/content?url=$ENCODED_URL" 2>&1 | head -15

echo ""
echo "---"
echo "If you see HTTP/1.1 200 OK, the proxy is working ✅"
echo "If you see 500, check: pm2 logs asli-backend --lines 20"
echo ""
