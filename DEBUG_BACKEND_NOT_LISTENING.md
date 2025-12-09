# Debug: Backend Not Listening on Port 5000

## Problem
- ✅ PM2 shows backend is "online"
- ❌ `curl http://localhost:5000/api/health` fails
- ❌ Nginx returns 502 Bad Gateway

This means the backend process is running but **not listening on port 5000**.

## Step 1: Check PM2 Logs for Errors

```bash
# Check recent logs
pm2 logs index --lines 50

# Check only error logs
pm2 logs index --err --lines 50

# Watch logs in real-time
pm2 logs index
```

**Look for:**
- MongoDB connection errors
- Port already in use errors
- Missing environment variables
- Module import errors
- Any crash/error messages

## Step 2: Check What Port Backend is Using

```bash
# Check .env file
cat ~/ASLI-STUD-BACK/.env | grep PORT

# Check if backend is listening on any port
ss -tlnp | grep node
# or
netstat -tlnp | grep node

# Check all listening ports
ss -tlnp
```

## Step 3: Check if Port 5000 is Already in Use

```bash
# Check what's using port 5000
sudo lsof -i :5000
# or
sudo netstat -tlnp | grep :5000
# or
sudo ss -tlnp | grep :5000
```

If something else is using port 5000, either:
- Stop that process, OR
- Change your backend PORT in .env

## Step 4: Verify Backend Code is Correct

Check that `backend/index.js` has:
```javascript
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
```

## Step 5: Check Environment Variables

```bash
# Check if MONGO_URI is set
cat ~/ASLI-STUD-BACK/.env | grep MONGO_URI

# Check if PORT is set
cat ~/ASLI-STUD-BACK/.env | grep PORT

# If PORT is not set, it defaults to 5000
```

## Step 6: Test Backend Startup Manually

Stop PM2 and run directly to see errors:

```bash
# Stop PM2
pm2 stop index

# Run backend directly (shows all errors)
cd ~/ASLI-STUD-BACK
node index.js
```

**Watch for:**
- MongoDB connection errors
- Missing dependencies
- Port binding errors
- Any startup errors

Press `Ctrl+C` to stop, then restart with PM2.

## Step 7: Common Issues and Fixes

### Issue 1: MongoDB Connection Failed
**Error in logs:** `MongoDB connection error` or `MONGO_URI is not set`

**Fix:**
```bash
# Check .env file has MONGO_URI
cat ~/ASLI-STUD-BACK/.env | grep MONGO_URI

# If missing, add it:
nano ~/ASLI-STUD-BACK/.env
# Add: MONGO_URI=your_mongodb_connection_string
```

### Issue 2: Port Already in Use
**Error:** `EADDRINUSE: address already in use :::5000`

**Fix:**
```bash
# Find what's using port 5000
sudo lsof -i :5000

# Kill that process, or change PORT in .env
```

### Issue 3: Missing Dependencies
**Error:** `Cannot find module 'xyz'`

**Fix:**
```bash
cd ~/ASLI-STUD-BACK
npm install
pm2 restart index --update-env
```

### Issue 4: Backend Crashes Immediately
**PM2 shows:** Process restarts constantly

**Fix:**
```bash
# Check PM2 logs for crash reason
pm2 logs index --err

# Check if it's a code error or missing env var
```

### Issue 5: Backend Listening on Wrong Interface
**Backend only listens on 127.0.0.1 instead of 0.0.0.0**

**Fix:** Ensure code has:
```javascript
app.listen(PORT, '0.0.0.0', () => {
```

## Step 8: Restart with Fresh Environment

```bash
# Delete PM2 process
pm2 delete index

# Restart with updated code and env
cd ~/ASLI-STUD-BACK
pm2 start index.js --name index --update-env

# Save PM2 config
pm2 save

# Check status
pm2 list

# Check logs
pm2 logs index --lines 20
```

## Step 9: Verify It's Working

```bash
# Check PM2 status
pm2 list

# Check if listening
ss -tlnp | grep node
# Should show: LISTEN 0 4096 0.0.0.0:5000

# Test locally
curl http://localhost:5000/api/health
# Should return: {"status":"ok",...}

# Test via Nginx
curl https://api.aslilearn.ai/api/health
# Should return: {"status":"ok",...}
```

## Quick Diagnostic Script

Run this to check everything:

```bash
echo "=== PM2 Status ==="
pm2 list

echo ""
echo "=== Recent Logs ==="
pm2 logs index --lines 10 --nostream

echo ""
echo "=== Error Logs ==="
pm2 logs index --err --lines 10 --nostream

echo ""
echo "=== Port Check ==="
ss -tlnp | grep node

echo ""
echo "=== Environment Check ==="
cat ~/ASLI-STUD-BACK/.env | grep -E "PORT|MONGO_URI"

echo ""
echo "=== Test Backend ==="
curl -s http://localhost:5000/api/health || echo "FAILED: Backend not responding"
```

## Most Likely Causes

1. **MongoDB connection failing** - Backend crashes on startup
2. **Missing environment variables** - Backend can't start
3. **Port conflict** - Another process using port 5000
4. **Code error** - Syntax error or missing module
5. **Backend listening on wrong interface** - Only 127.0.0.1 instead of 0.0.0.0

Check PM2 logs first - that will tell you exactly what's wrong!




