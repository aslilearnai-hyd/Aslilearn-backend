# Fix Mixed Content Error - Quick Steps

## The Problem
Your frontend (`aslilearn.ai`) is HTTPS, but backend is HTTP (`http://139.59.44.174`). Browsers block this.

## Solution: Set Up HTTPS for Backend

### Step 1: Add DNS Record (5 minutes)

**In your domain DNS settings (where you manage `aslilearn.ai`):**

Add an A record:
- **Name:** `api`
- **Type:** A
- **Value:** `139.59.44.174`
- **TTL:** 3600

This creates `api.aslilearn.ai` → `139.59.44.174`

**Wait 5-10 minutes**, then verify:
```bash
nslookup api.aslilearn.ai
# Should return: 139.59.44.174
```

---

### Step 2: Open Ports on Server

**SSH into your droplet and run:**
```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload
```

---

### Step 3: Set Up SSL Certificate

**On your droplet:**

```bash
# Install Certbot
apt-get update
apt-get install -y certbot python3-certbot-nginx

# Stop Nginx (Certbot needs port 80)
systemctl stop nginx

# Get SSL certificate
certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email brahmamtalent@gmail.com \
    -d api.aslilearn.ai

# Start Nginx again
systemctl start nginx
```

---

### Step 4: Update Nginx Config

**Upload the updated Nginx config** (or use the setup-https.sh script):

The config should:
- Listen on port 443 (HTTPS)
- Use SSL certificates from `/etc/letsencrypt/live/api.aslilearn.ai/`
- Redirect HTTP (port 80) to HTTPS
- Proxy `/api` to `http://localhost:5000`

**Or run the automated script:**
```bash
# Upload setup-https.sh to server first
chmod +x /root/asli-backend/setup-https.sh
/root/asli-backend/setup-https.sh
```

---

### Step 5: Rebuild Frontend

**Frontend is already updated** to use `https://api.aslilearn.ai`

**Rebuild and redeploy:**
```bash
cd client
npm run build
# Deploy to Vercel
```

---

### Step 6: Test

1. **Test backend HTTPS:**
   ```bash
   curl https://api.aslilearn.ai/api/health
   ```

2. **Test in browser:**
   - Go to `https://aslilearn.ai/auth/login`
   - Open DevTools Console
   - Should see: `API Base URL: https://api.aslilearn.ai`
   - No Mixed Content errors!

---

## Quick Commands Summary

```bash
# 1. On server - Open ports
ufw allow 80/tcp && ufw allow 443/tcp && ufw reload

# 2. On server - Install Certbot
apt-get update && apt-get install -y certbot python3-certbot-nginx

# 3. On server - Get certificate (after DNS is set)
systemctl stop nginx
certbot certonly --standalone --non-interactive --agree-tos \
    --email brahmamtalent@gmail.com -d api.aslilearn.ai
systemctl start nginx

# 4. On server - Update Nginx (use setup-https.sh or manual config)

# 5. On Windows - Rebuild frontend
cd client
npm run build
# Deploy to Vercel
```

---

## Troubleshooting

**Certificate fails:**
- Check DNS: `nslookup api.aslilearn.ai`
- Wait longer for DNS propagation (up to 24 hours, usually 5-10 min)
- Make sure port 80 is open: `ufw status`

**Still getting Mixed Content:**
- Clear browser cache (Ctrl+Shift+Delete)
- Check frontend is rebuilt and redeployed
- Check console shows `https://api.aslilearn.ai` not `http://139.59.44.174`

**Nginx won't start:**
- Check config: `nginx -t`
- Check logs: `tail -f /var/log/nginx/error.log`
