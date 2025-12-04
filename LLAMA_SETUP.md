# 🚀 Llama 3.1 8B Instruct GGUF Setup Guide

## Overview

This guide will help you set up **Llama 3.1 8B Instruct GGUF** model on your DigitalOcean droplet.

**Model**: Llama 3.1 8B Instruct  
**Size**: ~4.8GB (Q4_K_M quantization)  
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

## 📥 Step 2: Download Llama 3.1 8B Instruct GGUF Model

### Option A: Download from HuggingFace (Recommended)

```bash
# Create models directory
mkdir -p ~/models/Llama-3.1-8B-Instruct
cd ~/models/Llama-3.1-8B-Instruct

# Install huggingface_hub if not already installed
pip3 install huggingface_hub --break-system-packages

# Download Q4_K_M quantization (~4.8GB - recommended)
python3 << 'EOF'
from huggingface_hub import hf_hub_download
import os

repo_id = "bartowski/Llama-3.1-8B-Instruct-GGUF"
filename = "Llama-3.1-8B-Instruct-Q4_K_M.gguf"

print("📥 Downloading Llama 3.1 8B Instruct Q4_K_M (~4.8GB)...")
print("⏱️  This will take 10-20 minutes depending on connection...")
print("⚠️  DO NOT INTERRUPT - Let it complete!\n")

try:
    local_path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir="/root/models/Llama-3.1-8B-Instruct",
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

### Option B: Alternative Repository

If the above doesn't work, try:

```bash
# Alternative repository
repo_id = "TheBloke/Llama-3.1-8B-Instruct-GGUF"
filename = "llama-3.1-8b-instruct-q4_k_m.gguf"
```

### Option C: Download using wget (if direct URL available)

```bash
cd ~/models/Llama-3.1-8B-Instruct

# Download Q4_K_M version (~4.8GB)
wget --progress=bar:force \
    "https://huggingface.co/bartowski/Llama-3.1-8B-Instruct-GGUF/resolve/main/Llama-3.1-8B-Instruct-Q4_K_M.gguf" \
    -O "Llama-3.1-8B-Instruct-Q4_K_M.gguf"

# Verify
ls -lh
```

### Available Quantizations

- **Q4_K_M** (~4.8GB) - **Recommended**: Best balance of quality and size
- **Q5_K_M** (~5.8GB) - Better quality, slightly larger
- **Q8_0** (~7.5GB) - Best quality, larger file
- **Q3_K_M** (~3.8GB) - Smaller, faster, slightly lower quality

---

## 🚀 Step 3: Setup Server

```bash
# Create server directory
mkdir -p ~/llama-api
cd ~/llama-api

# Copy server.py from your backend folder
# Or create it manually with the content from backend/server.py
nano server.py
# Paste the content from backend/server.py
```

---

## ▶️ Step 4: Run Server

```bash
cd ~/llama-api
python3 server.py
```

You should see:
```
🔄 Loading Llama 3.1 8B Instruct model...
📁 Loading single file model from: /root/models/Llama-3.1-8B-Instruct/Llama-3.1-8B-Instruct-Q4_K_M.gguf
✅ Model loaded successfully!
🚀 Starting Llama 3.1 8B Instruct API server...
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
    "model": "llama-3.1-8b-instruct",
    "messages": [
      {"role": "user", "content": "Hello! What is 2+2?"}
    ]
  }'
```

---

## 🔄 Step 6: Run as System Service (Optional)

Create a systemd service for auto-start:

```bash
sudo tee /etc/systemd/system/llama.service > /dev/null << 'EOF'
[Unit]
Description=Llama 3.1 8B Instruct API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/llama-api
Environment="PATH=/usr/bin:/usr/local/bin"
ExecStart=/usr/bin/python3 /root/llama-api/server.py
Restart=always
RestartSec=10
StandardOutput=append:/var/log/llama.log
StandardError=append:/var/log/llama-error.log

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable llama
sudo systemctl start llama

# Check status
sudo systemctl status llama
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

**Note**: The variable name is still `DEEPSEEK_API_URL` for backward compatibility, but it now points to Llama 3.1 8B.

---

## 📊 Verification

After setup, verify:

```bash
# Check service status
sudo systemctl status llama

# Check logs
sudo tail -20 /var/log/llama.log

# Test from external
curl http://165.232.181.99:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "model": "llama-3.1-8b-instruct",
  "model_loaded": true
}
```

---

## 🐛 Troubleshooting

### Model not loading
- Check file path: `ls -lh ~/models/Llama-3.1-8B-Instruct/`
- Verify file permissions: `chmod 644 ~/models/Llama-3.1-8B-Instruct/*.gguf`
- Check disk space: `df -h`
- Verify file integrity: Check file size matches expected (~4.8GB for Q4_K_M)

### Service won't start
- Check logs: `sudo tail -50 /var/log/llama-error.log`
- Verify Python path: `which python3`
- Check dependencies: `pip3 list | grep llama`
- Test manually: `cd ~/llama-api && python3 server.py`

### Port not accessible
- Check firewall: `sudo ufw status`
- Verify service is running: `sudo systemctl status llama`
- Check if port is listening: `sudo netstat -tlnp | grep 8000`

### Out of memory errors
- Llama 3.1 8B needs ~8GB RAM minimum
- If you have 8GB RAM, use Q4_K_M quantization
- For 16GB+ RAM, you can use Q5_K_M or Q8_0 for better quality

---

## 📝 Model Specifications

- **Model**: Llama 3.1 8B Instruct
- **Parameters**: 8 billion
- **Context Window**: 128,000 tokens (excellent!)
- **Quantization**: Q4_K_M (recommended)
- **RAM Required**: ~8GB minimum
- **CPU**: Works on CPU (2+ vCPUs recommended)
- **Speed**: ~3-10 seconds per response (depending on CPU)

---

## 🎯 Why Llama 3.1 8B?

✅ **Excellent for educational content** - Meta's latest model  
✅ **Large context window** - 128K tokens (great for long conversations)  
✅ **Good quality** - Better than 7B models  
✅ **Well optimized** - Efficient GGUF quantization  
✅ **Active development** - Regular updates from Meta  

---

## 🎯 Your Droplet Info

- **IP**: `165.232.181.99`
- **SSH**: `ssh root@165.232.181.99`
- **API Endpoint**: `http://165.232.181.99:8000`
- **Health Check**: `http://165.232.181.99:8000/health`

---

## 💡 Tips

1. **Quantization Choice**:
   - Q4_K_M: Best balance (recommended) ✅
   - Q5_K_M: Better quality if you have RAM
   - Q3_K_M: Faster, smaller, slightly lower quality

2. **Performance Optimization**:
   - Use `n_threads=2` for 2 vCPU droplet
   - Increase `n_ctx` if you need longer context (up to 128K!)
   - Adjust `temperature` for different response styles

3. **Monitoring**:
   - Check logs regularly: `sudo tail -f /var/log/llama.log`
   - Monitor memory: `free -h`
   - Monitor CPU: `top`

---

**Ready to go!** 🎉

