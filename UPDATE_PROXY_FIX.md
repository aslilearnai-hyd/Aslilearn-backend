# Fix Proxy 500 Error - Update Backend

The proxy endpoint has been fixed. You need to update the backend on your server.

## Quick Fix

### Option 1: Upload Fixed File (Easiest)

**On your Windows machine**, upload the fixed `index.js`:

```powershell
# From your local machine
scp "F:\Asli learn\backend\index.js" root@139.59.44.174:/root/asli-backend/index.js
```

**Then on your server**, restart:

```bash
pm2 restart asli-backend
pm2 logs asli-backend --lines 20
```

---

### Option 2: Re-upload Entire Backend

If Option 1 doesn't work, re-upload the entire backend:

**On Windows:**
```powershell
cd "F:\Asli learn\backend"
.\upload-to-digitalocean.ps1 -ServerIP "139.59.44.174"
```

**Then on server:**
```bash
cd /root/asli-backend
npm install  # In case any new dependencies
pm2 restart asli-backend
```

---

## What Was Fixed

1. ✅ Added missing `basename` import from `path`
2. ✅ Improved error handling for 404/500 responses
3. ✅ Better logging for debugging
4. ✅ Fixed response status validation

---

## Verify It's Fixed

After updating, test in your browser:
- Open a textbook (PDF)
- Check browser console - should not see 500 errors
- PDF should load in the iframe

---

## Check Backend Logs

```bash
pm2 logs asli-backend --lines 30
```

Look for:
- "Proxying content from: ..." (should show the PDF URL)
- "Content type: application/pdf"
- No error messages

If you still see errors, share the log output.
