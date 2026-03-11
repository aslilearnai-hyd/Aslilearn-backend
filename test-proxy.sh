#!/bin/bash

# Test the proxy endpoint
# Run this on your server to test if the proxy is working

echo "Testing proxy endpoint..."

# Test with a PDF URL
TEST_URL="https://ncert.nic.in/textbook/pdf/hegp1ps.pdf"
ENCODED_URL=$(echo -n "$TEST_URL" | jq -sRr @uri 2>/dev/null || python3 -c "import urllib.parse; print(urllib.parse.quote('$TEST_URL'))" 2>/dev/null || echo "$TEST_URL")

echo "Testing: http://localhost:5000/api/proxy/content?url=$ENCODED_URL"
echo ""

# Test locally
curl -I "http://localhost:5000/api/proxy/content?url=$ENCODED_URL" 2>&1 | head -20

echo ""
echo "If you see HTTP/1.1 200 OK, the proxy is working"
echo "If you see 500 or other errors, check backend logs: pm2 logs asli-backend"
