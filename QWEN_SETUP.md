# 🚀 Qwen 2.5 7B Instruct GGUF Setup Guide

## Overview

This guide will help you set up **Qwen 2.5 7B Instruct GGUF** model on your DigitalOcean droplet.

**Model**: Qwen 2.5 7B Instruct  
**Size**: ~4.5GB (Q4_K_M quantization) or ~7GB (Q8_0)  
**Format**: GGUF (quantized)  
**Server**: DigitalOcean Droplet (165.232.181.99)

---

## 📋 Prerequisites

- DigitalOcean Droplet with Ubuntu
- At least 8GB RAM (16GB recommended)
- 10GB+ free disk space
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

## 📥 Step 2: Download Qwen 2.5 7B Instruct GGUF Model

### Option A: Download from HuggingFace (Recommended)

```bash
# Create models directory
mkdir -p ~/models/Qwen2.5-7B-Instruct
cd ~/models/Qwen2.5-7B-Instruct

# Install huggingface_hub if not already installed
pip3 install huggingface_hub --break-system-packages

# Download Q4_K_M quantization (~4.5GB - good balance)
python3 << 'EOF'
from huggingface_hub import hf_hub_download
import os

repo_id = "Qwen/Qwen2.5-7B-Instruct-GGUF"
filename = "qwen2.5-7b-instruct-q4_k_m.gguf"

print("📥 Downloading Qwen 2.5 7B Instruct Q4_K_M (~4.5GB)...")
print("⏱️  This will take 10-20 minutes depending on connection...")
print("⚠️  DO NOT INTERRUPT - Let it complete!\n")

try:
    local_path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir="/root/models/Qwen2.5-7B-Instruct",
        local_dir_use_symlinks=False
    )
    
    size = os.path.getsize(local_path) / (1024**3)
    print(f"\n✅ Download complete!")
    print(f"📦 File: {os.path.basename(local_path)}")
    print(f"📊 Size: {size:.2f} GB")
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()
EOF

# Verify download
ls -lh
du -sh .
```

### Option B: Download using wget (if direct URL available)

```bash
cd ~/models/Qwen2.5-7B-Instruct

# Download Q4_K_M version (~4.5GB)
wget --progress=bar:force \
    "https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/resolve/main/qwen2.5-7b-instruct-q4_k_m.gguf" \
    -O "qwen2.5-7b-instruct-q4_k_m.gguf"

# Verify
ls -lh
```

### Available Quantizations

- **Q4_K_M** (~4.5GB) - Recommended: Good balance of quality and size
- **Q5_K_M** (~5.2GB) - Better quality, slightly larger
- **Q8_0** (~7GB) - Best quality, larger file
- **Q3_K_M** (~3.5GB) - Smaller, faster, slightly lower quality

---

## 🚀 Step 3: Setup Server

```bash
# Create server directory
mkdir -p ~/qwen-api
cd ~/qwen-api

# Copy server.py from your backend folder
# Or create it manually with the content from backend/server.py
nano server.py
# Paste the content from backend/server.py
```

---

## ▶️ Step 4: Run Server

```bash
cd ~/qwen-api
python3 server.py
```

You should see:
```
🔄 Loading Qwen 2.5 7B Instruct model...
📁 Loading single file model from: /root/models/Qwen2.5-7B-Instruct/qwen2.5-7b-instruct-q4_k_m.gguf
✅ Model loaded successfully!
🚀 Starting Qwen 2.5 7B Instruct API server...
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
    "model": "qwen2.5-7b-instruct",
    "messages": [
      {"role": "user", "content": "Hello! What is 2+2?"}
    ]
  }'
```

---

## 🔄 Step 6: Run as System Service (Optional)

Create a systemd service for auto-start:

```bash
sudo tee /etc/systemd/system/qwen.service > /dev/null << 'EOF'
[Unit]
Description=Qwen 2.5 7B Instruct API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/qwen-api
Environment="PATH=/usr/bin:/usr/local/bin"
ExecStart=/usr/bin/python3 /root/qwen-api/server.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/qwen.log
StandardError=append:/var/log/qwen-error.log

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable qwen
sudo systemctl start qwen

# Check status
sudo systemctl status qwen
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

**Note**: The variable name is still `DEEPSEEK_API_URL` for backward compatibility, but it now points to Qwen.

---

## 📊 Verification

After setup, verify:

```bash
# Check service status
sudo systemctl status qwen

# Check logs
sudo tail -20 /var/log/qwen.log

# Test from external
curl http://165.232.181.99:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "model": "qwen2.5-7b-instruct",
  "model_loaded": true
}
```

---

## 🐛 Troubleshooting

### Model not loading
- Check file path: `ls -lh ~/models/Qwen2.5-7B-Instruct/`
- Verify file permissions: `chmod 644 ~/models/Qwen2.5-7B-Instruct/*.gguf`
- Check disk space: `df -h`
- Verify file integrity: Check file size matches expected (~4.5GB for Q4_K_M)

### Service won't start
- Check logs: `sudo tail -50 /var/log/qwen-error.log`
- Verify Python path: `which python3`
- Check dependencies: `pip3 list | grep llama`
- Test manually: `cd ~/qwen-api && python3 server.py`

### Port not accessible
- Check firewall: `sudo ufw status`
- Verify service is running: `sudo systemctl status qwen`
- Check if port is listening: `sudo netstat -tlnp | grep 8000`

### Out of memory errors
- Qwen 2.5 7B needs ~8GB RAM minimum
- If you have 8GB RAM, use Q4_K_M or Q3_K_M quantization
- For 16GB+ RAM, you can use Q5_K_M or Q8_0 for better quality

---

## 📝 Model Specifications

- **Model**: Qwen 2.5 7B Instruct
- **Parameters**: 7 billion
- **Context Window**: 32,768 tokens
- **Quantization**: Q4_K_M (recommended)
- **RAM Required**: ~8GB minimum
- **CPU**: Works on CPU (2+ vCPUs recommended)
- **Speed**: ~3-10 seconds per response (depending on CPU)

---

## 🎯 Your Droplet Info

- **IP**: `165.232.181.99`
- **SSH**: `ssh root@165.232.181.99`
- **API Endpoint**: `http://165.232.181.99:8000`
- **Health Check**: `http://165.232.181.99:8000/health`

---

## 💡 Tips

1. **Quantization Choice**:
   - Q4_K_M: Best balance (recommended)
   - Q5_K_M: Better quality if you have RAM
   - Q3_K_M: Faster, smaller, slightly lower quality

2. **Performance Optimization**:
   - Use `n_threads=2` for 2 vCPU droplet
   - Increase `n_ctx` if you need longer context
   - Adjust `temperature` for different response styles

3. **Monitoring**:
   - Check logs regularly: `sudo tail -f /var/log/qwen.log`
   - Monitor memory: `free -h`
   - Monitor CPU: `top`

---

**Ready to go!** 🎉

