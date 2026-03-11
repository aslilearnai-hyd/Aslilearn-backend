# Quick Deploy to DigitalOcean - Step by Step

## Prerequisites
- DigitalOcean droplet created (IP: `139.59.44.174`)
- SSH access to your droplet
- Your backend code ready

---

## Method 1: Automated Upload & Deploy (Recommended)

### Step 1: Upload Your Code

On your **Windows machine**, open PowerShell in the project root and run:

```powershell
# Navigate to backend directory
cd "F:\Asli learn\backend"

# Run the upload script
.\upload-to-digitalocean.ps1 -ServerIP "139.59.44.174"
```

This will:
- Prepare your backend files (exclude node_modules, .git, etc.)
- Upload to `/root/asli-backend` on your server

### Step 2: Deploy on Server

SSH into your server:

```bash
ssh root@139.59.44.174
```

Then run the deployment script:

```bash
# Make script executable
chmod +x /root/asli-backend/deploy-to-digitalocean.sh

# Run deployment
bash /root/asli-backend/deploy-to-digitalocean.sh
```

The script will:
- Install Node.js and PM2
- Install dependencies
- Setup Nginx
- Configure firewall
- Start your application

### Step 3: Configure Environment

If the script prompts you to edit `.env`, run:

```bash
nano /root/asli-backend/.env
```

Update these values:
```env
MONGO_URI=mongodb+srv://amenityforge_db_user:Forge2025@cluster1.xvqqi5w.mongodb.net/ASLI-LEARN?retryWrites=true&w=majority&appName=Cluster1
JWT_SECRET=your_strong_random_secret_here
FRONTEND_URL=http://139.59.44.174
CORS_ORIGIN=http://139.59.44.174
```

Save: `Ctrl+X`, `Y`, `Enter`

Then restart:
```bash
pm2 restart asli-backend
```

---

## Method 2: Manual Upload (Alternative)

### Step 1: Upload via SCP

From your Windows PowerShell:

```powershell
# Upload entire backend folder
scp -r "F:\Asli learn\backend" root@139.59.44.174:/root/asli-backend
```

### Step 2: SSH and Deploy

```bash
ssh root@139.59.44.174
cd /root/asli-backend
bash deploy-to-digitalocean.sh
```

---

## Method 3: Using Git (If your code is in a repository)

### On Server:

```bash
ssh root@139.59.44.174

# Clone repository
git clone YOUR_REPO_URL
cd YOUR_REPO_NAME/backend

# Run deployment
bash deploy-to-digitalocean.sh
```

---

## Verify Deployment

After deployment, test your backend:

```bash
# On server
curl http://localhost:5000/api/health
curl http://localhost/api/health

# From your local machine
curl http://139.59.44.174/api/health
```

You should see a JSON response.

---

## Update Frontend

Update your frontend to use the new backend:

**In `client/src/lib/api-config.ts` or `.env`:**
```typescript
export const API_BASE_URL = 'http://139.59.44.174';
```

Or:
```env
VITE_API_URL=http://139.59.44.174
```

---

## Useful Commands

### On Server:

```bash
# Check app status
pm2 status

# View logs
pm2 logs asli-backend

# Restart app
pm2 restart asli-backend

# Check Nginx
systemctl status nginx

# View Nginx logs
tail -f /var/log/nginx/error.log
```

### Update Code:

```bash
# Pull latest (if using Git)
cd /root/asli-backend
git pull
npm install
pm2 restart asli-backend

# Or re-upload and restart
```

---

## Troubleshooting

### Backend not starting:
```bash
pm2 logs asli-backend
# Check for errors in logs
```

### Nginx 502 error:
```bash
# Check if backend is running
pm2 status

# Test backend directly
curl http://localhost:5000/api/health

# Check Nginx config
nginx -t
```

### Can't access from browser:
```bash
# Check firewall
ufw status

# Check if port 80 is open
netstat -tulpn | grep 80
```

---

## Your Backend URL

Once deployed, your backend will be available at:

- **API Base**: `http://139.59.44.174/api`
- **Health Check**: `http://139.59.44.174/api/health`

---

**Ready to deploy? Start with Method 1! 🚀**
