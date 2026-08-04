#!/usr/bin/env bash
# Raise nginx timeouts for long AI / PDF jobs on the DigitalOcean API droplet.
# Run on the server as root:
#   bash /var/www/ASLI-STUD-BACK/deploy/patch-nginx-ai-timeouts.sh
# Or copy-paste the location blocks into your active api.aslilearn.ai server {}.
#
# Symptom without these blocks: browser shows 504 after exactly 5 min
# (default proxy_read_timeout 300s), then a misleading CORS error because the
# nginx HTML 504 page has no Access-Control-Allow-Origin header.
set -euo pipefail

echo "This script only prints the blocks to add — edit your live nginx site carefully."
echo "Find the https server for api.aslilearn.ai, then ADD these BEFORE location / :"
echo ""
cat <<'EOF'
    # Long-running AI batch kickoff
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

    # Exam PDF → questions (Gemini). Multi-page papers often exceed the default
    # 300s proxy_read_timeout and return 504 Gateway Timeout at exactly 5 min.
    location ^~ /api/super-admin/exams {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;
        send_timeout 1800s;
        client_max_body_size 100M;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }

    location ^~ /api/super-admin/protected/exams {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_connect_timeout 60s;
        proxy_send_timeout 1800s;
        proxy_read_timeout 1800s;
        send_timeout 1800s;
        client_max_body_size 100M;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
EOF
echo ""
echo "Also set (inside the same https server block) if missing:"
echo "    client_max_body_size 100M;"
echo "    client_body_timeout 600s;"
echo ""
echo "Then: sudo nginx -t && sudo systemctl reload nginx"
echo "Confirm: curl -sI https://api.aslilearn.ai/api/health | head"
echo "Then retry Extract Questions from PDF — it may take >5 min on large papers."
