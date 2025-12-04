# 🚀 DeepSeek V2 GGUF Setup Guide

## Overview

This guide will help you set up DeepSeek V2 Q3_K_M GGUF model on your DigitalOcean droplet.

**Model**: DeepSeek V2 Q3_K_M  
**Size**: ~3.5GB (may be single file or sharded)  
**Format**: GGUF (quantized)  
**Server**: DigitalOcean Droplet (165.232.181.99)

---

## 📋 Prerequisites

- DigitalOcean Droplet with Ubuntu
- At least 8GB RAM
- 5GB+ free disk space
- SSH access to droplet

---

## 🔧 Step 1: Install Dependencies

SSH to your droplet and run:

```bash
ssh root@165.232.181.99

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3 python3-pip python3-venv git build-essential cmake

# Install Python packages
pip3 install --upgrade pip
pip3 install llama-cpp-python[server] fastapi uvicorn --break-system-packages
```

---

## 📥 Step 2: Download DeepSeek V2 GGUF Model

**Wait for download URLs from the provider**, then:

```bash
# Create models directory
mkdir -p ~/models/DeepSeek-V2-Q3_K_M
cd ~/models/DeepSeek-V2-Q3_K_M

# Download files using wget (replace URLs with actual signed URLs)
# Example for single file:
wget --progress=bar:force "DOWNLOAD_URL_HERE" -O "DeepSeek-V2-Q3_K_M.gguf"

# OR for sharded files (7 files):
for i in {1..7}; do
    num=$(printf "%05d" $i)
    wget --progress=bar:force "DOWNLOAD_URL_${i}" -O "DeepSeek-V2-Q3_K_M-${num}-of-00007.gguf"
done

# Verify download
ls -lh
du -sh .
```

**Expected result**: 
- Single file: `DeepSeek-V2-Q3_K_M.gguf` (~3.5GB)
- OR 7 sharded files: `DeepSeek-V2-Q3_K_M-00001-of-00007.gguf` through `-00007-of-00007.gguf` (~500MB each)

---

## 🚀 Step 3: Setup Server

```bash
# Create server directory
mkdir -p ~/deepseek-api
cd ~/deepseek-api

# Copy server.py from your backend folder
# Or create it manually with the content from backend/server.py
nano server.py
# Paste the content from backend/server.py
```

---

## ▶️ Step 4: Run Server

```bash
cd ~/deepseek-api
python3 server.py
```

You should see:
```
🔄 Loading DeepSeek-V2 Q3_K_M model...
📁 Loading model from: /root/models/DeepSeek-V2-Q3_K_M/...
✅ Model loaded successfully!
🚀 Starting DeepSeek-V2 API server...
```

---

## ✅ Step 5: Test API

```bash
# Test health endpoint
curl http://localhost:8000/health

# Test chat endpoint
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-v2",
    "messages": [
      {"role": "user", "content": "Hello! What is 2+2?"}
    ]
  }'
```

---

## 🔄 Step 6: Run as System Service (Optional)

Create a systemd service for auto-start:

```bash
sudo tee /etc/systemd/system/deepseek.service > /dev/null << 'EOF'
[Unit]
Description=DeepSeek-V2 API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/deepseek-api
Environment="PATH=/usr/bin:/usr/local/bin"
ExecStart=/usr/bin/python3 /root/deepseek-api/server.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/deepseek.log
StandardError=append:/var/log/deepseek-error.log

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable deepseek
sudo systemctl start deepseek

# Check status
sudo systemctl status deepseek
```

---

## 🔥 Step 7: Open Firewall

```bash
sudo ufw allow 8000/tcp
sudo ufw status
```

---

## 🔗 Step 8: Update Backend Configuration

In your backend `.env` file, set:

```env
DEEPSEEK_API_URL=http://165.232.181.99:8000
```

---

## 📊 Verification

After setup, verify:

```bash
# Check service status
sudo systemctl status deepseek

# Check logs
sudo tail -20 /var/log/deepseek.log

# Test from external
curl http://165.232.181.99:8000/health
```

---

## 🐛 Troubleshooting

### Model not loading
- Check file path: `ls -lh ~/models/DeepSeek-V2-Q3_K_M/`
- Verify file permissions: `chmod 644 ~/models/DeepSeek-V2-Q3_K_M/*.gguf`
- Check disk space: `df -h`

### Service won't start
- Check logs: `sudo tail -50 /var/log/deepseek-error.log`
- Verify Python path: `which python3`
- Check dependencies: `pip3 list | grep llama`

### Port not accessible
- Check firewall: `sudo ufw status`
- Verify service is running: `sudo systemctl status deepseek`
- Check if port is listening: `sudo netstat -tlnp | grep 8000`

---

## 📝 Notes

- Model supports both single file and sharded formats
- Server automatically detects file structure
- API is OpenAI-compatible
- No API keys required (local inference)

---

**Ready to go!** 🎉

