# 🚨 Important: Qwen 2.5 7B Instruct Server Location

## ⚠️ This server.py is for DigitalOcean Droplet, NOT Local Windows!

The `server.py` file in this folder is meant to run on your **DigitalOcean Ubuntu droplet**, not on your local Windows machine.

**Model**: Qwen 2.5 7B Instruct GGUF (~4.5GB Q4_K_M)

---

## ✅ Correct Setup

### Run on Droplet (Ubuntu):
1. ✅ SSH to your droplet: `ssh root@165.232.181.99`
2. ✅ Copy `server.py` to: `~/deepseek-api/server.py`
3. ✅ Install dependencies on Ubuntu: `pip3 install llama-cpp-python[server] fastapi uvicorn`
4. ✅ Run on droplet: `python3 server.py`

### Your Backend (Node.js):
- ✅ Stays on your production server (Railway/Vercel/etc.)
- ✅ Connects to Qwen API via: `http://165.232.181.99:8000/v1`

---

## ❌ Don't Run on Windows

**Why?**
- `llama-cpp-python` requires C++ compilation
- Windows installation is complex
- Model file is 4-6 GB (too large for local testing)
- You need Ubuntu/Linux for proper setup

---

## 📋 What to Do

### Option 1: Setup on Droplet (Recommended)

1. **SSH to your droplet:**
   ```bash
   ssh root@165.232.181.99
   ```

2. **Create the server file on droplet:**
   ```bash
   mkdir -p ~/deepseek-api
   cd ~/deepseek-api
   nano server.py
   # Copy the content from backend/server.py
   ```

3. **Install on Ubuntu (easy):**
   ```bash
   pip3 install llama-cpp-python[server] fastapi uvicorn
   ```

4. **Run on droplet:**
   ```bash
   python3 server.py
   ```

### Option 2: Remove from Local Backend (Clean)

Since this file shouldn't be in your backend folder, you can:

1. **Delete it from local backend:**
   ```bash
   # It's not needed in your Node.js backend
   # The backend just connects to DeepSeek API
   ```

2. **Keep it only on droplet:**
   - Upload to droplet when setting up
   - Don't commit to your backend repo

---

## 🎯 Summary

- **server.py** → Run on **DigitalOcean Droplet** (Ubuntu)
- **Your Backend** → Run on **Production Server** (Railway/Vercel)
- **Connection** → Backend connects to Qwen API via HTTP
- **Model** → Qwen 2.5 7B Instruct GGUF (local inference)

**Don't try to run server.py on Windows!** Use the droplet setup instead.

## 📚 Setup Instructions

See `QWEN_SETUP.md` for complete setup instructions.

