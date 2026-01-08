# Digital Ocean Droplet Deployment Guide

Complete guide to deploy your ASLI app with Ollama on Digital Ocean.

## Prerequisites

- Digital Ocean account
- Domain name (optional, but recommended)
- SSH access to your computer

---

## Step 1: Create Digital Ocean Droplet

### 1.1 Create Droplet

1. **Login to Digital Ocean**: https://cloud.digitalocean.com
2. **Click "Create" → "Droplets"**
3. **Choose Configuration:**
   - **Image**: Ubuntu 22.04 (LTS)
   - **Plan**: Regular (4 CPU / 8GB RAM / 160GB SSD) - $48/month
   - **Datacenter**: Choose closest to your users
   - **Authentication**: SSH keys (recommended) or Password
   - **Hostname**: `asli-backend` (or your choice)

4. **Click "Create Droplet"**

### 1.2 Note Your Server Details

After creation, note:
- **IP Address**: `YOUR_SERVER_IP`
- **Root password** (if using password auth)

---

## Step 2: Initial Server Setup

### 2.1 Connect to Your Droplet

```bash
# Using SSH key
ssh root@YOUR_SERVER_IP

# Or using password
ssh root@YOUR_SERVER_IP
# Enter password when prompted
```

### 2.2 Update System

```bash
# Update package list
apt update && apt upgrade -y

# Install essential tools
apt install -y curl wget git build-essential
```

### 2.3 Create Non-Root User (Recommended)

```bash
# Create new user
adduser asli
usermod -aG sudo asli

# Switch to new user
su - asli
```

---

## Step 3: Install Node.js

### 3.1 Install Node.js 18.x

```bash
# Install Node.js using NodeSource
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should show v18.x.x
npm --version
```

### 3.2 Install PM2 (Process Manager)

```bash
sudo npm install -g pm2
```

---

## Step 4: Install Ollama

### 4.1 Install Ollama

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Verify installation
ollama --version
```

### 4.2 Download Required Models

```bash
# Download text model (1.1GB)
ollama pull llama3.2:1b

# Download vision model (4GB) - Optional
ollama pull llava:7b

# Verify models
ollama list
```

### 4.3 Configure Ollama to Run as Service

```bash
# Create systemd service for Ollama
sudo nano /etc/systemd/system/ollama.service
```

Add this content:

```ini
[Unit]
Description=Ollama Service
After=network.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/ollama serve
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Save and enable:

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable Ollama to start on boot
sudo systemctl enable ollama

# Start Ollama
sudo systemctl start ollama

# Check status
sudo systemctl status ollama
```

---

## Step 5: Setup Your Application

### 5.1 Clone Your Repository

```bash
# Navigate to home directory
cd ~

# Clone your repository (replace with your repo URL)
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
# OR upload your code using SCP/SFTP

# Navigate to backend
cd YOUR_REPO/ASLI-STUD-BACK
```

### 5.2 Install Dependencies

```bash
# Install npm packages
npm install

# If you have build steps
npm run build  # if applicable
```

### 5.3 Create Environment File

```bash
# Create .env file
nano .env
```

Add your configuration:

```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Database Configuration
MONGO_URI=your_mongodb_connection_string

# JWT Configuration
JWT_SECRET=your_jwt_secret_key

# Frontend URL
FRONTEND_URL=https://yourdomain.com
# Or if frontend is on same server: http://localhost:5173

# Ollama Configuration
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_TEXT_MODEL=llama3.2:1b
OLLAMA_VISION_MODEL=llava:7b

# Super Admin Credentials
SUPER_ADMIN_EMAIL=amenityforge@gmail.com
SUPER_ADMIN_PASSWORD=Amenity
```

Save: `Ctrl+X`, then `Y`, then `Enter`

---

## Step 6: Setup Swap Space (Important for 8GB RAM)

```bash
# Create 4GB swap file
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Make it permanent
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Verify
free -h
```

---

## Step 7: Start Application with PM2

### 7.1 Start Application

```bash
# Navigate to backend directory
cd ~/YOUR_REPO/ASLI-STUD-BACK

# Start with PM2
pm2 start index.js --name "asli-backend"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the instructions it shows
```

### 7.2 PM2 Useful Commands

```bash
# Check status
pm2 status

# View logs
pm2 logs asli-backend

# Restart
pm2 restart asli-backend

# Stop
pm2 stop asli-backend

# Monitor
pm2 monit
```

---

## Step 8: Install and Configure Nginx

### 8.1 Install Nginx

```bash
sudo apt install -y nginx
```

### 8.2 Configure Nginx Reverse Proxy

```bash
# Create Nginx configuration
sudo nano /etc/nginx/sites-available/asli-backend
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    # Increase timeouts for Ollama requests
    proxy_read_timeout 300s;
    proxy_connect_timeout 300s;
    proxy_send_timeout 300s;

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
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
        proxy_pass http://localhost:3001;
        access_log off;
    }

    # Frontend (if serving from same server)
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Save and enable:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/asli-backend /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

## Step 9: Setup Firewall

```bash
# Allow SSH, HTTP, HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow 3001/tcp  # Direct backend access (optional)

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Step 10: Setup SSL with Let's Encrypt (Optional but Recommended)

### 10.1 Install Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
```

### 10.2 Get SSL Certificate

```bash
# Replace with your domain
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow the prompts. Certbot will automatically configure Nginx.

### 10.3 Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run
```

Certificates auto-renew via systemd timer.

---

## Step 11: Verify Everything Works

### 11.1 Check Services

```bash
# Check Ollama
curl http://localhost:11434/api/tags

# Check backend
curl http://localhost:3001/api/health

# Check through Nginx
curl http://YOUR_SERVER_IP/api/health
```

### 11.2 Check Logs

```bash
# Application logs
pm2 logs asli-backend

# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log

# Ollama logs
sudo journalctl -u ollama -f
```

---

## Step 12: Update Frontend Configuration

Update your frontend `.env` file:

```env
VITE_API_URL=http://YOUR_SERVER_IP
# Or if using domain:
VITE_API_URL=https://yourdomain.com
```

Rebuild and deploy frontend.

---

## Monitoring and Maintenance

### Daily Checks

```bash
# Check all services
pm2 status
sudo systemctl status ollama
sudo systemctl status nginx

# Check disk space
df -h

# Check memory
free -h

# Check CPU
top
```

### Update Application

```bash
# Pull latest code
cd ~/YOUR_REPO/ASLI-STUD-BACK
git pull

# Install new dependencies
npm install

# Restart application
pm2 restart asli-backend
```

### Update Models

```bash
# Pull latest model version
ollama pull llama3.2:1b

# Restart Ollama
sudo systemctl restart ollama
```

---

## Troubleshooting

### Backend Not Starting

```bash
# Check logs
pm2 logs asli-backend

# Check if port is in use
sudo netstat -tulpn | grep 3001

# Check environment variables
pm2 env 0
```

### Ollama Not Responding

```bash
# Check Ollama status
sudo systemctl status ollama

# Check if models are loaded
ollama list

# Restart Ollama
sudo systemctl restart ollama
```

### High Memory Usage

```bash
# Check memory
free -h

# Check what's using memory
ps aux --sort=-%mem | head

# Restart services if needed
pm2 restart all
sudo systemctl restart ollama
```

### Nginx Errors

```bash
# Check Nginx configuration
sudo nginx -t

# Check error logs
sudo tail -f /var/log/nginx/error.log

# Restart Nginx
sudo systemctl restart nginx
```

---

## Security Checklist

- [ ] Changed default SSH port (optional)
- [ ] Disabled root login (use sudo user)
- [ ] Setup firewall (UFW)
- [ ] SSL certificate installed
- [ ] Environment variables secured
- [ ] MongoDB connection string secured
- [ ] JWT secret is strong and unique
- [ ] Regular system updates scheduled

---

## Performance Optimization

### 1. Enable Gzip Compression in Nginx

Add to Nginx config:

```nginx
gzip on;
gzip_vary on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
```

### 2. Setup Log Rotation

```bash
# PM2 log rotation
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 3. Monitor Resources

```bash
# Install monitoring tools
sudo apt install -y htop iotop

# Use PM2 monitoring
pm2 install pm2-server-monit
```

---

## Backup Strategy

### 1. Database Backups

Setup MongoDB Atlas backups (if using Atlas) or:

```bash
# Manual backup script
mongodump --uri="YOUR_MONGO_URI" --out=/backup/$(date +%Y%m%d)
```

### 2. Application Backups

```bash
# Backup application code
tar -czf /backup/app-$(date +%Y%m%d).tar.gz ~/YOUR_REPO
```

### 3. Automated Backups

Create cron job:

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/backup-script.sh
```

---

## Cost Estimate

- **Droplet (4 CPU / 8GB)**: $48/month
- **Domain**: $10-15/year
- **MongoDB Atlas**: Free tier or $9/month
- **Total**: ~$50-60/month

---

## Next Steps

1. ✅ Test all endpoints
2. ✅ Setup monitoring alerts
3. ✅ Configure backups
4. ✅ Setup CI/CD (optional)
5. ✅ Load testing
6. ✅ Document API endpoints

---

## Support

If you encounter issues:

1. Check logs: `pm2 logs` and `sudo journalctl -u ollama`
2. Verify services: `pm2 status` and `sudo systemctl status ollama`
3. Check network: `curl http://localhost:3001/api/health`
4. Review this guide for common issues

---

**Your application should now be running on Digital Ocean! 🚀**

