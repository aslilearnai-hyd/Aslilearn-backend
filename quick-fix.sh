#!/bin/bash

# Quick Fix Script for Port Mismatch and MONGO_URI Issue
# Run this on your server: sudo bash quick-fix.sh

echo "🔧 Fixing Port Mismatch and MONGO_URI Issue..."
echo ""

# Step 1: Update Nginx to use port 3001
echo "1️⃣  Updating Nginx configuration to use port 3001..."
if [ -f /etc/nginx/sites-available/api.aslilearn.ai ]; then
    sudo sed -i 's/localhost:5000/localhost:3001/g' /etc/nginx/sites-available/api.aslilearn.ai
    echo "✅ Updated Nginx config"
else
    echo "⚠️  Nginx config file not found. Please create it first."
fi

# Step 2: Test and reload Nginx
echo ""
echo "2️⃣  Testing Nginx configuration..."
if sudo nginx -t; then
    echo "✅ Nginx config is valid"
    sudo systemctl reload nginx
    echo "✅ Nginx reloaded"
else
    echo "❌ Nginx config has errors. Please fix manually."
    exit 1
fi

# Step 3: Check if .env exists
echo ""
echo "3️⃣  Checking .env file..."
cd ~/ASLI-STUD-BACK || exit 1

if [ ! -f .env ]; then
    echo "⚠️  .env file not found. Creating it..."
    cat > .env << 'ENVEOF'
# Server Configuration
PORT=3001
NODE_ENV=production

# Database Configuration - REQUIRED
MONGO_URI=mongodb+srv://amenityforge_db_user:qcTX55G2K6ct36Ij@cluster0.ibp4qe2.mongodb.net/ASLI-LEARN?appName=Cluster0

# JWT Configuration - REQUIRED
JWT_SECRET=33e5d04de5698b678209074e1c412adc39f792cd1f81d8dfacbd89f38601cf38

# Frontend URL
FRONTEND_URL=https://www.aslilearn.ai

# Super Admin Credentials (Optional - for initial setup only)
SUPER_ADMIN_EMAIL=Amenity@gmail.com
SUPER_ADMIN_PASSWORD=Amenity

# Gemini AI Configuration
# GEMINI_API_KEY=your_gemini_api_key_here
ENVEOF
    echo "✅ Created .env file"
    echo "⚠️  Please edit .env and add your GEMINI_API_KEY if needed"
else
    echo "✅ .env file exists"
    
    # Check if MONGO_URI is set
    if grep -q "MONGO_URI=" .env && ! grep -q "^#.*MONGO_URI" .env; then
        echo "✅ MONGO_URI is set in .env"
    else
        echo "❌ MONGO_URI is missing or commented out in .env"
        echo "   Please add: MONGO_URI=your_mongodb_connection_string"
        exit 1
    fi
    
    # Check if PORT is set to 3001
    if grep -q "^PORT=3001" .env; then
        echo "✅ PORT is set to 3001"
    else
        echo "⚠️  PORT is not set to 3001. Updating..."
        if grep -q "^PORT=" .env; then
            sed -i 's/^PORT=.*/PORT=3001/' .env
        else
            echo "PORT=3001" >> .env
        fi
        echo "✅ Updated PORT to 3001"
    fi
fi

# Step 4: Restart PM2
echo ""
echo "4️⃣  Restarting PM2 with updated environment..."
pm2 delete index 2>/dev/null
pm2 start index.js --name index --update-env
pm2 save
echo "✅ PM2 restarted"

# Step 5: Wait a moment and check status
echo ""
echo "5️⃣  Waiting for backend to start..."
sleep 3

# Step 6: Verify
echo ""
echo "6️⃣  Verifying setup..."
echo ""
echo "PM2 Status:"
pm2 list

echo ""
echo "Checking if backend is listening on port 3001:"
if ss -tlnp | grep -q ":3001"; then
    echo "✅ Backend is listening on port 3001"
else
    echo "❌ Backend is NOT listening on port 3001"
    echo "   Check PM2 logs: pm2 logs index --err"
fi

echo ""
echo "Testing backend health endpoint:"
if curl -s http://localhost:3001/api/health > /dev/null; then
    echo "✅ Backend health check passed"
    curl -s http://localhost:3001/api/health | head -c 100
    echo ""
else
    echo "❌ Backend health check failed"
    echo "   Check PM2 logs: pm2 logs index --err --lines 50"
fi

echo ""
echo "Testing via Nginx:"
if curl -s https://api.aslilearn.ai/api/health > /dev/null 2>&1; then
    echo "✅ Nginx proxy is working"
    curl -s https://api.aslilearn.ai/api/health | head -c 100
    echo ""
else
    echo "⚠️  Nginx proxy test failed (might be SSL or DNS issue)"
    echo "   Try: curl http://api.aslilearn.ai/api/health"
fi

echo ""
echo "🎉 Fix complete!"
echo ""
echo "If backend is still not working, check logs:"
echo "  pm2 logs index --err --lines 50"

