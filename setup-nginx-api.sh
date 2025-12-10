#!/bin/bash

# Nginx Configuration Setup for api.aslilearn.ai
# Run this script on your server as root or with sudo

echo "🔧 Setting up Nginx configuration for api.aslilearn.ai..."

# Configuration variables
DOMAIN="api.aslilearn.ai"
BACKEND_PORT="5000"
NGINX_SITES_AVAILABLE="/etc/nginx/sites-available"
NGINX_SITES_ENABLED="/etc/nginx/sites-enabled"

# Create Nginx configuration file
cat > "$NGINX_SITES_AVAILABLE/$DOMAIN" <<EOF
# Nginx configuration for api.aslilearn.ai
server {
    listen 80;
    server_name $DOMAIN;

    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL Configuration (adjust paths if using different certificate location)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    
    # If SSL certificate doesn't exist yet, comment out the above two lines
    # and uncomment these for self-signed (development only):
    # ssl_certificate /etc/ssl/certs/nginx-selfsigned.crt;
    # ssl_certificate_key /etc/ssl/private/nginx-selfsigned.key;

    # SSL Security Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # CORS Headers (handled by backend, but can add here if needed)
    # add_header Access-Control-Allow-Origin "*" always;
    # add_header Access-Control-Allow-Methods "GET, POST, PUT, DELETE, OPTIONS" always;
    # add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;

    # Proxy Settings
    location / {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        
        # WebSocket support (if needed)
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        
        # Standard proxy headers
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Timeouts
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        
        # Cache control
        proxy_cache_bypass \$http_upgrade;
        
        # Buffer settings
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # Health check endpoint (optional, for monitoring)
    location /health {
        proxy_pass http://localhost:$BACKEND_PORT/api/health;
        access_log off;
    }

    # Logging
    access_log /var/log/nginx/$DOMAIN-access.log;
    error_log /var/log/nginx/$DOMAIN-error.log;
}
EOF

echo "✅ Configuration file created: $NGINX_SITES_AVAILABLE/$DOMAIN"

# Create symbolic link to enable the site
if [ ! -L "$NGINX_SITES_ENABLED/$DOMAIN" ]; then
    ln -s "$NGINX_SITES_AVAILABLE/$DOMAIN" "$NGINX_SITES_ENABLED/$DOMAIN"
    echo "✅ Symbolic link created in sites-enabled"
else
    echo "⚠️  Symbolic link already exists"
fi

# Test Nginx configuration
echo ""
echo "🧪 Testing Nginx configuration..."
if nginx -t; then
    echo "✅ Nginx configuration is valid"
    
    # Reload Nginx
    echo ""
    echo "🔄 Reloading Nginx..."
    systemctl reload nginx
    echo "✅ Nginx reloaded"
    
    echo ""
    echo "🎉 Setup complete!"
    echo ""
    echo "Next steps:"
    echo "1. If SSL certificate doesn't exist, install it:"
    echo "   sudo certbot --nginx -d $DOMAIN"
    echo ""
    echo "2. Test the backend locally:"
    echo "   curl http://localhost:$BACKEND_PORT/api/health"
    echo ""
    echo "3. Test the public endpoint:"
    echo "   curl https://$DOMAIN/api/health"
else
    echo "❌ Nginx configuration has errors. Please fix them before reloading."
    exit 1
fi






