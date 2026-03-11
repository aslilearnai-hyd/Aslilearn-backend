#!/bin/bash

# Fix MongoDB URI in .env file on DigitalOcean server
# Run this on your server: bash fix-mongo-uri.sh

ENV_FILE="/root/asli-backend/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: .env file not found at $ENV_FILE"
    exit 1
fi

echo "Fixing MongoDB URI in .env file..."

# Backup original file
cp "$ENV_FILE" "$ENV_FILE.backup"

# Update MONGO_URI with correct connection string
sed -i 's|MONGO_URI=.*|MONGO_URI=mongodb+srv://amenityforge_db_user:Forge2025@cluster1.xvqqi5w.mongodb.net/ASLI-LEARN?retryWrites=true\&w=majority\&appName=Cluster1|' "$ENV_FILE"

echo "✅ MongoDB URI updated!"
echo ""
echo "Updated .env file:"
grep "MONGO_URI" "$ENV_FILE"
echo ""
echo "Restarting application..."
pm2 restart asli-backend

echo ""
echo "✅ Done! Check logs with: pm2 logs asli-backend --lines 20"
