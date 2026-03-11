#!/bin/bash

# Setup HTTPS for DigitalOcean Backend
# This script sets up SSL certificate using Let's Encrypt (Certbot)
# 
# Prerequisites:
# 1. Point a subdomain (e.g., api.aslilearn.ai) to your droplet IP (139.59.44.174)
# 2. Make sure port 80 and 443 are open in your firewall

set -e

DOMAIN="api.aslilearn.ai"  # Change this to your subdomain
EMAIL="brahmamtalent@gmail.com"  # Change to your email for Let's Encrypt

echo "🔒 Setting up HTTPS for $DOMAIN"
echo ""

# Check if domain is set
if [ "$DOMAIN" = "api.aslilearn.ai" ]; then
    echo "⚠️  Please update DOMAIN variable in this script to your actual subdomain"
    echo "   Example: api.aslilearn.ai"
    read -p "Press Enter to continue with $DOMAIN or Ctrl+C to cancel..."
fi

# Update system
echo "📦 Updating system packages..."
apt-get update -qq

# Install Certbot
echo "📦 Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx

# Stop Nginx temporarily (Certbot will start it)
echo "🛑 Stopping Nginx temporarily..."
systemctl stop nginx

# Get SSL certificate
echo "🔐 Obtaining SSL certificate from Let's Encrypt..."
certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN"

# Create Nginx SSL configuration
echo "📝 Creating Nginx SSL configuration..."
cat > /etc/nginx/sites-available/asli-backend <<EOF
# HTTP - Redirect to HTTPS
server {
    listen 80;
    server_name $DOMAIN;
    
    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    
    # Redirect all other HTTP to HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS - Backend API
server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL Certificate
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Increase body size for file uploads
    client_max_body_size 50M;

    # API endpoints
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Health check
    location /api/health {
        proxy_pass http://localhost:5000/api/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Proxy endpoint
    location /api/proxy {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
EOF

# Enable site
echo "🔗 Enabling Nginx site..."
ln -sf /etc/nginx/sites-available/asli-backend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
echo "🧪 Testing Nginx configuration..."
nginx -t

# Start Nginx
echo "🚀 Starting Nginx..."
systemctl start nginx
systemctl enable nginx

# Setup auto-renewal
echo "🔄 Setting up certificate auto-renewal..."
systemctl enable certbot.timer
systemctl start certbot.timer

# Test renewal
echo "🧪 Testing certificate renewal..."
certbot renew --dry-run

echo ""
echo "✅ HTTPS setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update your frontend API URL to: https://$DOMAIN"
echo "2. Test the backend: curl https://$DOMAIN/api/health"
echo "3. Certificate will auto-renew every 90 days"
echo ""
echo "🔗 Your backend API is now available at:"
echo "   https://$DOMAIN/api"
