# Fixing 502 Bad Gateway - Nginx Configuration

## Current Status
- ✅ Backend process is running (PM2 shows `index` is online)
- ✅ Node.js process confirmed running (`ps aux | grep node`)
- ❌ Nginx returns 502 Bad Gateway

This means **Nginx can't connect to your backend**. Let's fix it.

## Step 1: Check What Port Backend is Listening On

On your server, run:
```bash
# Check what port the backend is using
grep -r "PORT" ~/ASLI-STUD-BACK/.env
# or
cat ~/ASLI-STUD-BACK/.env | grep PORT

# Check what ports Node.js is listening on
netstat -tlnp | grep node
# or
ss -tlnp | grep node
```

**Expected:** Should show port `5000` (or whatever PORT is set in .env)

## Step 2: Test Backend Directly on Server

```bash
# Test if backend responds on localhost
curl http://localhost:5000/api/health
# Should return: {"status":"ok","env":"production",...}

# If that works, test with the server's IP
curl http://165.232.181.99:5000/api/health
```

## Step 3: Check Nginx Configuration

```bash
# View Nginx config for api.aslilearn.ai
sudo cat /etc/nginx/sites-available/api.aslilearn.ai
# or
sudo cat /etc/nginx/sites-enabled/api.aslilearn.ai
```

**Expected configuration:**
```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name api.aslilearn.ai;

    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/api.aslilearn.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.aslilearn.ai/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Redirect HTTP to HTTPS
    if ($scheme != "https") {
        return 301 https://$server_name$request_uri;
    }

    location / {
        proxy_pass http://localhost:5000;  # ← CHECK THIS PORT MATCHES YOUR BACKEND
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }
}
```

## Step 4: Common Issues and Fixes

### Issue 1: Wrong Port in Nginx Config
**Symptom:** Nginx points to wrong port (e.g., `proxy_pass http://localhost:3001` but backend runs on `5000`)

**Fix:**
```bash
sudo nano /etc/nginx/sites-available/api.aslilearn.ai
# Change proxy_pass to match your backend port
# Save and exit (Ctrl+X, Y, Enter)

# Test Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### Issue 2: Backend Not Listening on 0.0.0.0
**Symptom:** Backend only listens on `127.0.0.1` instead of `0.0.0.0`

**Fix:** In `backend/index.js`, ensure:
```javascript
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
```

Or restart with:
```bash
pm2 restart index --update-env
```

### Issue 3: Backend Crashed After Restart
**Symptom:** Process shows in PM2 but not actually running

**Fix:**
```bash
# Check PM2 logs
pm2 logs index --lines 50

# Check for errors
pm2 logs index --err --lines 50

# Restart with fresh environment
pm2 restart index --update-env
```

### Issue 4: Firewall Blocking
**Symptom:** Backend works locally but Nginx can't connect

**Fix:**
```bash
# Check if localhost connections work
curl http://127.0.0.1:5000/api/health

# If that fails, check firewall
sudo ufw status
# Should allow localhost connections (usually enabled by default)
```

### Issue 5: Backend Takes Too Long to Start
**Symptom:** Nginx times out waiting for backend

**Fix:** Increase timeout in Nginx:
```nginx
proxy_read_timeout 300s;
proxy_connect_timeout 75s;
```

## Step 5: Verify Fix

After making changes:

```bash
# 1. Test backend directly
curl http://localhost:5000/api/health

# 2. Test Nginx config
sudo nginx -t

# 3. Reload Nginx
sudo systemctl reload nginx

# 4. Test from outside
curl https://api.aslilearn.ai/api/health
```

## Quick Diagnostic Commands

Run these on your server to diagnose:

```bash
# 1. Check backend port
cat ~/ASLI-STUD-BACK/.env | grep PORT

# 2. Check if backend is listening
ss -tlnp | grep node

# 3. Test backend locally
curl http://localhost:5000/api/health

# 4. Check Nginx config
sudo cat /etc/nginx/sites-enabled/api.aslilearn.ai | grep proxy_pass

# 5. Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# 6. Check PM2 logs
pm2 logs index --lines 20
```

## Most Likely Fix

Based on your setup, the most common issue is **port mismatch**. 

1. Check your `.env` file for `PORT=5000` (or whatever port)
2. Check Nginx config has `proxy_pass http://localhost:5000` (matching the PORT)
3. Restart both:
   ```bash
   pm2 restart index --update-env
   sudo systemctl reload nginx
   ```

## After Fixing

Once `curl https://api.aslilearn.ai/api/health` works:
- ✅ CORS errors should be resolved
- ✅ Frontend should connect successfully
- ✅ All API endpoints should work


