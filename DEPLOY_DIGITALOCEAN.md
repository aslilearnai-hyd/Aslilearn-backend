# Deploy Backend to DigitalOcean Droplet - Quick Guide

This is a streamlined guide to deploy your ASLI Learn backend to DigitalOcean.

## Prerequisites

- DigitalOcean account
- Your backend code ready
- MongoDB connection string (already configured)
- Domain name (optional)

---

## Step 1: Create DigitalOcean Droplet

1. **Login**: https://cloud.digitalocean.com
2. **Create → Droplets**
3. **Configuration**:
   - **Image**: Ubuntu 22.04 (LTS)
   - **Plan**: 
     - **Basic**: 2 CPU / 4GB RAM ($24/month) - Minimum
     - **Recommended**: 4 CPU / 8GB RAM ($48/month) - Better performance
   - **Datacenter**: Choose closest to your users
   - **Authentication**: SSH keys (recommended) or Password
   - **Hostname**: `asli-backend`
4. **Create Droplet**

**Note your IP address**: `YOUR_SERVER_IP`

---

## Step 2: Connect to Your Server

```bash
# Using SSH
ssh root@YOUR_SERVER_IP

# Or if using password, enter when prompted
```

---

## Step 3: Run Automated Setup Script

```bash
# Update system
apt update && apt upgrade -y

# Install git
apt install -y git

# Clone your repository (or upload your code)
# Option 1: If you have a Git repository
git clone YOUR_REPO_URL
cd YOUR_REPO_NAME/backend

# Option 2: Upload code using SCP from your local machine
# From your local machine, run:
# scp -r "F:\Asli learn\backend" root@YOUR_SERVER_IP:/root/asli-backend
```

---

## Step 4: Install Node.js and PM2

```bash
# Install Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Verify
node --version  # Should show v18.x.x
npm --version

# Install PM2 (Process Manager)
npm install -g pm2
```

---

## Step 5: Setup Your Application

```bash
# Navigate to backend directory
cd /root/asli-backend  # or wherever you cloned/uploaded your code

# Install dependencies
npm install

# Create .env file
nano .env
```

**Add this to `.env` file**:

```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Database (use your existing MongoDB URI)
MONGO_URI=mongodb+srv://amenityforge_db_user:Forge2025@cluster1.xvqqi5w.mongodb.net/ASLI-LEARN?retryWrites=true&w=majority&appName=Cluster1

# JWT Secret (generate a strong random string)
JWT_SECRET=your_very_strong_jwt_secret_key_here_change_this

# Frontend URL (update with your frontend URL)
FRONTEND_URL=https://yourdomain.com
# Or if using IP: http://YOUR_SERVER_IP

# Super Admin (already configured)
SUPER_ADMIN_EMAIL=sealucknow2017@gmail.com
SUPER_ADMIN_PASSWORD=Asli123

# CORS - Allow your frontend domain
CORS_ORIGIN=https://yourdomain.com,http://YOUR_SERVER_IP
```

**Save**: Press `Ctrl+X`, then `Y`, then `Enter`

---

## Step 6: Start Application with PM2

```bash
# Start the application
pm2 start index.js --name "asli-backend"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the command it shows (usually: sudo env PATH=... pm2 startup systemd -u root --hp /root)

# Check status
pm2 status

# View logs
pm2 logs asli-backend
```

---

## Step 7: Install and Configure Nginx

```bash
# Install Nginx
apt install -y nginx

# Create Nginx configuration
nano /etc/nginx/sites-available/asli-backend
```

**Add this configuration**:

```nginx
server {
    listen 80;
    server_name YOUR_SERVER_IP;  # Replace with your domain if you have one

    # Increase timeouts for long requests
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    # Backend API
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

    # Health check
    location /api/health {
        proxy_pass http://localhost:5000/api/health;
        access_log off;
    }

    # Proxy endpoint for content
    location /api/proxy {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Save and enable**:

```bash
# Enable site
ln -s /etc/nginx/sites-available/asli-backend /etc/nginx/sites-enabled/

# Remove default site
rm /etc/nginx/sites-enabled/default

# Test configuration
nginx -t

# Restart Nginx
systemctl restart nginx

# Enable Nginx to start on boot
systemctl enable nginx
```

---

## Step 8: Setup Firewall

```bash
# Allow SSH, HTTP, HTTPS
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw allow 5000/tcp  # Direct backend access (optional, for testing)

# Enable firewall
ufw enable

# Check status
ufw status
```

---

## Step 9: Test Your Deployment

```bash
# Test backend directly
curl http://localhost:3001/api/health

# Test through Nginx
curl http://YOUR_SERVER_IP/api/health

# Check PM2 status
pm2 status

# Check logs
pm2 logs asli-backend
```

---

## Step 10: Setup SSL (Optional but Recommended)

If you have a domain name:

```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Follow prompts - Certbot will configure Nginx automatically
```

---

## Step 11: Update Frontend Configuration

Update your frontend `.env` or `api-config.ts`:

```env
VITE_API_URL=http://YOUR_SERVER_IP
# Or if using domain with SSL:
VITE_API_URL=https://yourdomain.com
```

---

## Useful Commands

### PM2 Commands
```bash
pm2 status              # Check status
pm2 logs asli-backend   # View logs
pm2 restart asli-backend # Restart
pm2 stop asli-backend   # Stop
pm2 monit               # Monitor
```

### Nginx Commands
```bash
nginx -t                # Test configuration
systemctl restart nginx  # Restart
systemctl status nginx  # Check status
tail -f /var/log/nginx/error.log  # View error logs
```

### Update Application
```bash
# Pull latest code
cd /root/asli-backend
git pull  # or upload new files

# Install new dependencies
npm install

# Restart
pm2 restart asli-backend
```

---

## Troubleshooting

### Backend Not Starting
```bash
# Check logs
pm2 logs asli-backend

# Check if port is in use
netstat -tulpn | grep 3001

# Check environment variables
pm2 env 0
```

### Nginx 502 Bad Gateway
```bash
# Check if backend is running
pm2 status

# Check backend logs
pm2 logs asli-backend

# Test backend directly
curl http://localhost:3001/api/health

# Check Nginx error logs
tail -f /var/log/nginx/error.log
```

### Can't Access from Browser
```bash
# Check firewall
ufw status

# Check if Nginx is running
systemctl status nginx

# Check if port 80 is open
netstat -tulpn | grep 80
```

---

## Security Checklist

- [ ] Changed default SSH port (optional)
- [ ] Setup firewall (UFW)
- [ ] SSL certificate installed (if using domain)
- [ ] Environment variables secured (.env file permissions)
- [ ] MongoDB connection string secured
- [ ] JWT secret is strong and unique
- [ ] Regular system updates scheduled

---

## Cost Estimate

- **Droplet (2 CPU / 4GB)**: $24/month
- **Droplet (4 CPU / 8GB)**: $48/month (recommended)
- **Domain**: $10-15/year (optional)
- **MongoDB Atlas**: Already using (free tier or paid)
- **Total**: ~$25-50/month

---

## Next Steps

1. ✅ Test all API endpoints
2. ✅ Update frontend to use new backend URL
3. ✅ Setup monitoring (optional)
4. ✅ Configure backups (optional)
5. ✅ Setup CI/CD (optional)

---

## Quick Reference

**Server IP**: `YOUR_SERVER_IP`  
**Backend URL**: `http://YOUR_SERVER_IP/api`  
**Health Check**: `http://YOUR_SERVER_IP/api/health`  
**PM2 Process**: `asli-backend`  
**Backend Port**: `3001`  
**Nginx Port**: `80` (HTTP), `443` (HTTPS if SSL configured)

---

**Your backend should now be live on DigitalOcean! 🚀**
