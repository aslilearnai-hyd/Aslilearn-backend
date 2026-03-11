#!/bin/bash

# Fix Nginx Configuration for DigitalOcean
# Run this on your server: bash fix-nginx.sh

set -e

echo "Fixing Nginx configuration..."

# Create Nginx configuration
cat > /etc/nginx/sites-available/asli-backend << 'EOF'
server {
    listen 80;
    server_name 139.59.44.174;

    # Increase timeouts
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check
    location /api/health {
        proxy_pass http://localhost:5000/api/health;
        access_log off;
    }

    # Proxy endpoint for content
    location /api/proxy {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

# Enable site
echo "Enabling Nginx site..."
ln -sf /etc/nginx/sites-available/asli-backend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test configuration
echo "Testing Nginx configuration..."
if nginx -t; then
    echo "✅ Nginx configuration is valid"
else
    echo "❌ Nginx configuration has errors"
    exit 1
fi

# Restart Nginx
echo "Restarting Nginx..."
systemctl restart nginx
systemctl enable nginx

# Wait a moment
sleep 2

# Test backend locally
echo ""
echo "Testing backend..."
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo "✅ Backend is running on port 5000"
else
    echo "⚠️  Backend not responding on port 5000"
    echo "   Check: pm2 status"
fi

# Test through Nginx
echo ""
echo "Testing through Nginx..."
if curl -f http://localhost/api/health > /dev/null 2>&1; then
    echo "✅ Nginx proxy is working!"
    echo ""
    echo "Your backend is now accessible at:"
    echo "  http://139.59.44.174/api"
    echo "  http://139.59.44.174/api/health"
else
    echo "⚠️  Nginx proxy test failed"
    echo "   Check Nginx logs: tail -f /var/log/nginx/error.log"
fi

echo ""
echo "Done!"
