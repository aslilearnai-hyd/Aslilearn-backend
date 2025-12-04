# Quick Nginx Setup for api.aslilearn.ai

## Problem Found
The Nginx configuration file for `api.aslilearn.ai` is **missing**. This is why you're getting 502 Bad Gateway.

## Quick Fix (Choose One Method)

### Method 1: Use the Setup Script (Recommended)

1. **Copy the script to your server:**
   ```bash
   # On your local machine, the script is at: backend/setup-nginx-api.sh
   # Upload it to your server or copy-paste the commands
   ```

2. **Run the script on your server:**
   ```bash
   cd ~/ASLI-STUD-BACK
   # If you uploaded the script:
   chmod +x setup-nginx-api.sh
   sudo ./setup-nginx-api.sh
   
   # OR copy-paste the commands from the script manually
   ```

### Method 2: Manual Setup (Step by Step)

1. **Create the Nginx configuration file:**
   ```bash
   sudo nano /etc/nginx/sites-available/api.aslilearn.ai
   ```

2. **Paste this configuration:**
   ```nginx
   server {
       listen 80;
       server_name api.aslilearn.ai;
       return 301 https://$server_name$request_uri;
   }

   server {
       listen 443 ssl http2;
       server_name api.aslilearn.ai;

       # SSL Certificate (adjust path if different)
       ssl_certificate /etc/letsencrypt/live/api.aslilearn.ai/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/api.aslilearn.ai/privkey.pem;
       
       # If SSL doesn't exist yet, comment out the above two lines temporarily

       ssl_protocols TLSv1.2 TLSv1.3;
       ssl_ciphers HIGH:!aNULL:!MD5;
       ssl_prefer_server_ciphers on;

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
           proxy_connect_timeout 75s;
           proxy_read_timeout 300s;
       }

       access_log /var/log/nginx/api.aslilearn.ai-access.log;
       error_log /var/log/nginx/api.aslilearn.ai-error.log;
   }
   ```

3. **Save and exit** (Ctrl+X, then Y, then Enter)

4. **Enable the site:**
   ```bash
   sudo ln -s /etc/nginx/sites-available/api.aslilearn.ai /etc/nginx/sites-enabled/
   ```

5. **Test the configuration:**
   ```bash
   sudo nginx -t
   ```

6. **If test passes, reload Nginx:**
   ```bash
   sudo systemctl reload nginx
   ```

### Method 3: If You Don't Have SSL Certificate Yet

If you don't have an SSL certificate, use this temporary HTTP-only config:

```bash
sudo nano /etc/nginx/sites-available/api.aslilearn.ai
```

Paste:
```nginx
server {
    listen 80;
    server_name api.aslilearn.ai;

    location / {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    access_log /var/log/nginx/api.aslilearn.ai-access.log;
    error_log /var/log/nginx/api.aslilearn.ai-error.log;
}
```

Then:
```bash
sudo ln -s /etc/nginx/sites-available/api.aslilearn.ai /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Later, install SSL:**
```bash
sudo certbot --nginx -d api.aslilearn.ai
```

## Verify Backend is Running

Before testing Nginx, make sure backend is accessible:

```bash
# Check PM2 status
pm2 list

# Test backend directly
curl http://localhost:5000/api/health

# Should return: {"status":"ok","env":"production",...}
```

## Test the Fix

After setting up Nginx:

```bash
# Test locally (if on server)
curl http://localhost/api/health

# Test from outside
curl https://api.aslilearn.ai/api/health
# OR if no SSL yet:
curl http://api.aslilearn.ai/api/health
```

## Troubleshooting

### If still getting 502:

1. **Check backend is running:**
   ```bash
   curl http://localhost:5000/api/health
   ```

2. **Check Nginx error logs:**
   ```bash
   sudo tail -f /var/log/nginx/api.aslilearn.ai-error.log
   ```

3. **Check if port matches:**
   ```bash
   # Check what port backend uses
   cat ~/ASLI-STUD-BACK/.env | grep PORT
   
   # Check what port Nginx proxies to
   sudo grep proxy_pass /etc/nginx/sites-available/api.aslilearn.ai
   ```

4. **Check backend is listening:**
   ```bash
   ss -tlnp | grep node
   # Should show: LISTEN 0 4096 0.0.0.0:5000
   ```

### If SSL certificate issues:

```bash
# Check if certificate exists
sudo ls -la /etc/letsencrypt/live/api.aslilearn.ai/

# If missing, install with certbot
sudo certbot --nginx -d api.aslilearn.ai
```

## After Success

Once `curl https://api.aslilearn.ai/api/health` works:
- ✅ 502 error is fixed
- ✅ CORS should work (backend handles it)
- ✅ Frontend can connect to API
- ✅ All endpoints should be accessible

