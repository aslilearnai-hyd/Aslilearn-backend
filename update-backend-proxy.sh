#!/bin/bash

# Update backend proxy endpoint fix
# Run this on your DigitalOcean server

echo "Updating backend proxy endpoint..."

cd /root/asli-backend

# Pull latest code or upload the fixed index.js
# If using git:
# git pull

# Or if you need to upload manually, the fixed index.js needs to be uploaded

# Restart the application
echo "Restarting backend..."
pm2 restart asli-backend

echo "✅ Backend restarted!"
echo ""
echo "Check logs: pm2 logs asli-backend --lines 20"
