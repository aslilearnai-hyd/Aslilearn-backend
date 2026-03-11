# Fix MongoDB Connection Error on Server

## Quick Fix

Run this command on your DigitalOcean server:

```bash
cd /root/asli-backend
bash fix-mongo-uri.sh
```

This will:
1. Update the MongoDB URI in your `.env` file
2. Restart your application
3. Show you the updated URI

---

## Manual Fix (Alternative)

If the script doesn't work, edit the file manually:

```bash
nano /root/asli-backend/.env
```

**Find this line:**
```
MONGO_URI=your_mongodb_connection_string_here
```

**Replace it with:**
```
MONGO_URI=mongodb+srv://amenityforge_db_user:Forge2025@cluster1.xvqqi5w.mongodb.net/ASLI-LEARN?retryWrites=true&w=majority&appName=Cluster1
```

**Save:** `Ctrl+X`, then `Y`, then `Enter`

**Restart:**
```bash
pm2 restart asli-backend
```

---

## Verify It's Fixed

Check the logs:

```bash
pm2 logs asli-backend --lines 20
```

You should see:
- ✅ `Connected to MongoDB` (no errors)
- ✅ Server running on port 5000

Test the API:

```bash
curl http://localhost:5000/api/health
```

You should get a JSON response.

---

## If Still Not Working

Check the .env file:

```bash
cat /root/asli-backend/.env | grep MONGO_URI
```

Make sure it shows the correct MongoDB connection string starting with `mongodb+srv://`
