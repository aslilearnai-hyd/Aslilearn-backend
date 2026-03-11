# Setup HTTPS for Backend (Fix Mixed Content Error)

## Problem
Your frontend is on HTTPS (`aslilearn.ai`) but your backend is on HTTP (`http://139.59.44.174`). Browsers block HTTP requests from HTTPS pages (Mixed Content Error).

## Solution
Set up HTTPS for your backend using Let's Encrypt SSL certificate.

---

## Step 1: Point a Subdomain to Your Droplet

**In your domain DNS settings (wherever you manage `aslilearn.ai`):**

Add an A record:
- **Type:** A
- **Name:** `api` (or `backend`)
- **Value:** `139.59.44.174`
- **TTL:** 3600 (or default)

This will create `api.aslilearn.ai` pointing to your droplet.

**Wait 5-10 minutes** for DNS to propagate (check with: `nslookup api.aslilearn.ai`)

---

## Step 2: Open Ports 80 and 443

**On your DigitalOcean droplet:**

```bash
# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp
ufw reload
```

---

## Step 3: Run the HTTPS Setup Script

**On your droplet:**

```bash
# Upload the script
# (From Windows, use SCP or copy-paste the script)

# Make it executable
chmod +x /root/asli-backend/setup-https.sh

# Edit the script first to set your domain and email
nano /root/asli-backend/setup-https.sh
# Change: DOMAIN="api.aslilearn.ai"
# Change: EMAIL="brahmamtalent@gmail.com"

# Run the script
/root/asli-backend/setup-https.sh
```

**Or run commands manually:**

```bash
# Install Certbot
apt-get update
apt-get install -y certbot python3-certbot-nginx

# Get certificate (replace api.aslilearn.ai with your subdomain)
certbot certonly --standalone \
    --non-interactive \
    --agree-tos \
    --email brahmamtalent@gmail.com \
    -d api.aslilearn.ai

# Then update Nginx config (see setup-https.sh for full config)
```

---

## Step 4: Update Frontend API URL

**In `client/src/lib/api-config.ts`:**

Change:
```typescript
const PRODUCTION_URL = 'http://139.59.44.174';
```

To:
```typescript
const PRODUCTION_URL = 'https://api.aslilearn.ai';
```

**Then rebuild and redeploy frontend:**
```bash
cd client
npm run build
# Deploy to Vercel (or your hosting)
```

---

## Step 5: Test

1. **Test backend HTTPS:**
   ```bash
   curl https://api.aslilearn.ai/api/health
   ```

2. **Test in browser:**
   - Go to `https://aslilearn.ai/auth/login`
   - Check console - should see requests to `https://api.aslilearn.ai`
   - No more Mixed Content errors!

---

## Alternative: Quick Test with Self-Signed Certificate

If you want to test quickly (but browsers will show a warning):

```bash
# Generate self-signed cert
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/nginx-selfsigned.key \
    -out /etc/nginx/ssl/nginx-selfsigned.crt \
    -subj "/CN=api.aslilearn.ai"

# Update Nginx to use it
# (But Let's Encrypt is better - no browser warnings)
```

---

## Troubleshooting

### Certificate fails to obtain
- Check DNS: `nslookup api.aslilearn.ai` should return `139.59.44.174`
- Check ports: `ufw status` should show 80/tcp and 443/tcp open
- Make sure Nginx is stopped when running `certbot certonly --standalone`

### Nginx won't start
- Check config: `nginx -t`
- Check logs: `tail -f /var/log/nginx/error.log`

### Still getting Mixed Content
- Clear browser cache
- Check frontend is using HTTPS URL
- Check browser console for exact error

---

## Auto-Renewal

Certbot sets up auto-renewal automatically. Certificates expire every 90 days and renew automatically.

To test renewal:
```bash
certbot renew --dry-run
```
