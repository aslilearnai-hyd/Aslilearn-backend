#!/bin/bash

# DigitalOcean Deployment Script
# Run this script on your DigitalOcean droplet after uploading your code
# Usage: bash deploy-to-digitalocean.sh

set -e

echo "🚀 Starting ASLI Backend Deployment..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root${NC}"
    exit 1
fi

# Step 1: Update system
echo -e "${YELLOW}📦 Step 1: Updating system...${NC}"
apt update && apt upgrade -y
apt install -y curl wget git build-essential

# Step 2: Install Node.js
echo -e "${YELLOW}📦 Step 2: Installing Node.js 18.x...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt install -y nodejs
else
    echo -e "${GREEN}✅ Node.js already installed: $(node --version)${NC}"
fi

# Verify Node.js
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
echo -e "${GREEN}✅ Node.js: $NODE_VERSION${NC}"
echo -e "${GREEN}✅ npm: $NPM_VERSION${NC}"

# Step 3: Install PM2
echo -e "${YELLOW}📦 Step 3: Installing PM2...${NC}"
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
else
    echo -e "${GREEN}✅ PM2 already installed${NC}"
fi

# Step 4: Navigate to backend directory
echo -e "${YELLOW}📦 Step 4: Setting up application...${NC}"
if [ ! -d "/root/asli-backend" ]; then
    echo -e "${RED}❌ Backend directory not found at /root/asli-backend${NC}"
    echo "Please upload your backend code first using SCP or Git"
    exit 1
fi

cd /root/asli-backend

# Step 5: Install dependencies
echo -e "${YELLOW}📦 Step 5: Installing npm dependencies...${NC}"
npm install

# Step 6: Check .env file
echo -e "${YELLOW}📦 Step 6: Checking .env file...${NC}"
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating template...${NC}"
    cat > .env << 'EOF'
# Server Configuration
PORT=5000
NODE_ENV=production

# Database - UPDATE THIS WITH YOUR MONGO_URI
MONGO_URI=your_mongodb_connection_string_here

# JWT Secret - CHANGE THIS TO A RANDOM STRING
JWT_SECRET=change_this_to_a_strong_random_secret_key

# Frontend URL
FRONTEND_URL=http://YOUR_SERVER_IP

# CORS
CORS_ORIGIN=http://YOUR_SERVER_IP

# Super Admin
SUPER_ADMIN_EMAIL=sealucknow2017@gmail.com
SUPER_ADMIN_PASSWORD=Asli123
EOF
    echo -e "${RED}❌ Please edit .env file with your configuration:${NC}"
    echo "   nano /root/asli-backend/.env"
    echo ""
    echo "Press Enter after you've updated .env file..."
    read
fi

# Step 7: Install Nginx
echo -e "${YELLOW}📦 Step 7: Installing Nginx...${NC}"
if ! command -v nginx &> /dev/null; then
    apt install -y nginx
else
    echo -e "${GREEN}✅ Nginx already installed${NC}"
fi

# Step 8: Configure Nginx
echo -e "${YELLOW}📦 Step 8: Configuring Nginx...${NC}"
SERVER_IP=$(curl -s ifconfig.me || hostname -I | awk '{print $1}')

cat > /etc/nginx/sites-available/asli-backend << EOF
server {
    listen 80;
    server_name $SERVER_IP;

    # Increase timeouts
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    # Backend API
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
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/asli-backend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration
nginx -t

# Step 9: Setup Firewall
echo -e "${YELLOW}📦 Step 9: Configuring firewall...${NC}"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# Step 10: Start application with PM2
echo -e "${YELLOW}📦 Step 10: Starting application...${NC}"
pm2 delete asli-backend 2>/dev/null || true
pm2 start index.js --name "asli-backend"
pm2 save

# Setup PM2 startup
echo -e "${YELLOW}📦 Setting up PM2 startup...${NC}"
STARTUP_CMD=$(pm2 startup | grep -o 'sudo.*')
if [ ! -z "$STARTUP_CMD" ]; then
    eval $STARTUP_CMD
fi

# Step 11: Restart Nginx
echo -e "${YELLOW}📦 Step 11: Restarting Nginx...${NC}"
systemctl restart nginx
systemctl enable nginx

# Step 12: Test deployment
echo -e "${YELLOW}📦 Step 12: Testing deployment...${NC}"
sleep 3

# Test backend
if curl -f http://localhost:5000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running!${NC}"
else
    echo -e "${RED}⚠️  Backend health check failed. Check logs: pm2 logs asli-backend${NC}"
fi

# Test Nginx
if curl -f http://localhost/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Nginx proxy is working!${NC}"
else
    echo -e "${RED}⚠️  Nginx proxy test failed${NC}"
fi

echo ""
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo ""
echo "Your backend should be accessible at:"
echo "  http://$SERVER_IP/api"
echo "  http://$SERVER_IP/api/health"
echo ""
echo "Useful commands:"
echo "  pm2 status              # Check app status"
echo "  pm2 logs asli-backend   # View logs"
echo "  pm2 restart asli-backend # Restart app"
echo "  systemctl status nginx  # Check Nginx"
echo ""
