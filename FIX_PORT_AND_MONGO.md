# Fix Port Mismatch and MONGO_URI Issue

## Problems Found

1. **PORT Mismatch**: `.env` file has `PORT=3001`, but Nginx is configured for `localhost:5000`
2. **MONGO_URI Missing**: Backend can't find `MONGO_URI` environment variable

## Solution

### Step 1: Update Nginx to Use Port 3001

On your server, run:

```bash
sudo nano /etc/nginx/sites-available/api.aslilearn.ai
```

Find this line:
```nginx
proxy_pass http://localhost:5000;
```

Change it to:
```nginx
proxy_pass http://localhost:3001;
```

Save and exit (Ctrl+X, Y, Enter)

Then test and reload:
```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 2: Ensure .env File Exists on Server

The `.env` file needs to be on your server (not just on GitHub).

```bash
# Check if .env exists
ls -la ~/ASLI-STUD-BACK/.env

# If it doesn't exist, create it:
cd ~/ASLI-STUD-BACK
nano .env
```

Paste this content (use your actual values):
```env
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
GEMINI_API_KEY=your_gemini_api_key_here
```

**Important**: Replace `your_gemini_api_key_here` with your actual Gemini API key if you have one.

Save and exit (Ctrl+X, Y, Enter)

### Step 3: Make Sure .env is NOT in .gitignore

Check if `.env` is being ignored by Git:

```bash
cd ~/ASLI-STUD-BACK
cat .gitignore | grep .env
```

If `.env` is in `.gitignore`, that's fine - it means you need to manually create it on the server (which we did in Step 2).

### Step 4: Restart PM2 with Environment Variables

```bash
# Delete the current PM2 process
pm2 delete index

# Start with environment variables loaded
cd ~/ASLI-STUD-BACK
pm2 start index.js --name index --update-env

# Save PM2 configuration
pm2 save

# Check logs to verify it started correctly
pm2 logs index --lines 20
```

### Step 5: Verify Everything Works

```bash
# Check PM2 status
pm2 list

# Check if backend is listening on port 3001
ss -tlnp | grep node
# Should show: LISTEN 0 4096 0.0.0.0:3001

# Test backend directly
curl http://localhost:3001/api/health
# Should return: {"status":"ok","env":"production",...}

# Test via Nginx
curl https://api.aslilearn.ai/api/health
# Should return: {"status":"ok","env":"production",...}
```

## Alternative: Use PM2 Ecosystem File (Recommended)

Create a PM2 ecosystem file to ensure environment variables are loaded:

```bash
cd ~/ASLI-STUD-BACK
nano ecosystem.config.js
```

Paste:
```javascript
module.exports = {
  apps: [{
    name: 'index',
    script: './index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    env_file: '.env',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G'
  }]
};
```

Then start with:
```bash
pm2 delete index
pm2 start ecosystem.config.js
pm2 save
```

## Quick Fix Commands (Copy-Paste All at Once)

```bash
# 1. Update Nginx port
sudo sed -i 's/localhost:5000/localhost:3001/g' /etc/nginx/sites-available/api.aslilearn.ai
sudo nginx -t && sudo systemctl reload nginx

# 2. Verify .env exists and has MONGO_URI
cd ~/ASLI-STUD-BACK
if [ ! -f .env ]; then
  echo "Creating .env file..."
  # You'll need to manually create it with the content above
else
  echo ".env file exists"
  grep MONGO_URI .env || echo "WARNING: MONGO_URI not found in .env"
fi

# 3. Restart PM2
pm2 delete index
pm2 start index.js --name index --update-env
pm2 save

# 4. Check status
pm2 list
pm2 logs index --lines 10

# 5. Test
curl http://localhost:3001/api/health
```

## After Fixing

Once both issues are resolved:
- ✅ Backend will start successfully
- ✅ Backend will listen on port 3001
- ✅ Nginx will proxy correctly to port 3001
- ✅ API will be accessible at https://api.aslilearn.ai
- ✅ CORS will work properly
- ✅ Frontend can connect to backend




