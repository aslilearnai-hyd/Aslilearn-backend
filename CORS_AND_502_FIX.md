# CORS and 502 Bad Gateway Fix Guide

## Issues Fixed

### 1. CORS Configuration Updated
- ✅ Now allows `https://www.aslilearn.ai` and all `aslilearn.ai` subdomains
- ✅ More permissive in production mode
- ✅ Health endpoint properly handles CORS preflight

### 2. 502 Bad Gateway - Server Not Running

The 502 error means your backend server at `https://api.aslilearn.ai` is not accessible.

## Steps to Fix 502 Error

### Step 1: Check if Backend is Running on Server

SSH into your DigitalOcean droplet:
```bash
ssh root@165.232.181.99
```

Check if Node.js process is running:
```bash
ps aux | grep node
# or
pm2 list
```

### Step 2: Start Backend Server

If not running, start it:
```bash
cd /path/to/backend
npm start
# or if using PM2:
pm2 start index.js --name aslilearn-backend
pm2 save
```

### Step 3: Check Domain Configuration

Verify `api.aslilearn.ai` points to your server:

1. **Check DNS Records:**
   - `api.aslilearn.ai` should point to `165.232.181.99`
   - Type: A record
   - TTL: 300 or higher

2. **Check Nginx Configuration** (if using reverse proxy):
   ```nginx
   server {
       listen 80;
       listen 443 ssl;
       server_name api.aslilearn.ai;

       ssl_certificate /path/to/ssl/cert.pem;
       ssl_certificate_key /path/to/ssl/key.pem;

       location / {
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
   }
   ```

3. **Restart Nginx:**
   ```bash
   sudo nginx -t  # Test configuration
   sudo systemctl restart nginx
   ```

### Step 4: Test Backend Directly

Test if backend responds on the server:
```bash
curl http://localhost:5000/api/health
# Should return: {"status":"ok","env":"production",...}
```

Test from outside:
```bash
curl https://api.aslilearn.ai/api/health
# Should return: {"status":"ok","env":"production",...}
```

### Step 5: Check Firewall

Ensure port 5000 (or your backend port) is open:
```bash
sudo ufw status
sudo ufw allow 5000/tcp
```

If using Nginx, ensure ports 80 and 443 are open:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## CORS Changes Made

### Updated CORS Configuration:
- ✅ Allows all `aslilearn.ai` subdomains (www, api, etc.)
- ✅ More permissive in production
- ✅ Health endpoint handles CORS properly
- ✅ Preflight requests (OPTIONS) properly configured

### Test CORS:
```bash
curl -H "Origin: https://www.aslilearn.ai" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: Content-Type" \
     -X OPTIONS \
     https://api.aslilearn.ai/api/health -v
```

Should return headers:
- `Access-Control-Allow-Origin: https://www.aslilearn.ai`
- `Access-Control-Allow-Methods: GET, OPTIONS, POST`
- `Access-Control-Allow-Credentials: true`

## Quick Checklist

- [ ] Backend server is running (`ps aux | grep node`)
- [ ] Backend responds on localhost (`curl http://localhost:5000/api/health`)
- [ ] DNS record `api.aslilearn.ai` → `165.232.181.99`
- [ ] Nginx configured (if using reverse proxy)
- [ ] SSL certificate installed (for HTTPS)
- [ ] Firewall allows ports 80, 443, 5000
- [ ] CORS headers are being sent (check with curl -v)

## Common Issues

### Issue 1: Backend not running
**Solution:** Start with PM2 or systemd service

### Issue 2: Wrong port
**Solution:** Check `PORT` environment variable, default is 5000

### Issue 3: Nginx not configured
**Solution:** Set up reverse proxy or use direct port access

### Issue 4: SSL certificate missing
**Solution:** Install Let's Encrypt certificate for `api.aslilearn.ai`

### Issue 5: Firewall blocking
**Solution:** Open required ports with `ufw allow`

## After Fixing

Once backend is accessible:
1. Test: `curl https://api.aslilearn.ai/api/health`
2. Check frontend: Should connect without CORS errors
3. Monitor logs: `pm2 logs aslilearn-backend` or `tail -f logs/app.log`







