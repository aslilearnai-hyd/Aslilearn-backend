# Fix Nginx 404 Error

## Quick Fix

**On your DigitalOcean server**, run:

```bash
cd /root/asli-backend
bash fix-nginx.sh
```

Or if the file isn't uploaded yet, copy and paste this entire command:

```bash
cat > /tmp/fix-nginx.sh << 'SCRIPT'
#!/bin/bash
cat > /etc/nginx/sites-available/asli-backend << 'EOF'
server {
    listen 80;
    server_name 139.59.44.174;
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;
    location /api {
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
    location /api/health {
        proxy_pass http://localhost:5000/api/health;
        access_log off;
    }
    location /api/proxy {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
ln -sf /etc/nginx/sites-available/asli-backend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx && echo "✅ Fixed! Test: curl http://localhost/api/health"
SCRIPT
bash /tmp/fix-nginx.sh
```

---

## Verify It Works

After running the fix:

```bash
# Test locally
curl http://localhost/api/health

# Should return JSON response
```

Then test from your browser:
- `http://139.59.44.174/api/health`

---

## If Still Not Working

Check these:

```bash
# Check if backend is running
pm2 status

# Check if backend responds directly
curl http://localhost:5000/api/health

# Check Nginx error logs
tail -f /var/log/nginx/error.log

# Check Nginx status
systemctl status nginx
```
