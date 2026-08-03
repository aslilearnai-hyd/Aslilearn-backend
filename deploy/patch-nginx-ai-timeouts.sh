#!/usr/bin/env bash
# Raise nginx timeouts for long AI / PDF jobs on the DigitalOcean API droplet.
# Run on the server as root:
#   bash /var/www/ASLI-STUD-BACK/deploy/patch-nginx-ai-timeouts.sh
# Or copy-paste the location blocks into your active api.aslilearn.ai server {}.
set -euo pipefail

echo "This script only prints the blocks to add — edit your live nginx site carefully."
echo "Find the https server for api.aslilearn.ai, then ADD these BEFORE location / :"
echo ""
cat <<'EOF'
    location ^~ /api/book-generator/generate-batch {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;
        send_timeout 1800s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    location ^~ /api/ai-generator/generate-batch {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;
        send_timeout 1800s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
EOF
echo ""
echo "Then: sudo nginx -t && sudo systemctl reload nginx"
echo "Frontend: redeploy so hardened job polling is live."
