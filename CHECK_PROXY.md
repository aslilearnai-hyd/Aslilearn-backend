# Check Why PDFs Aren't Loading

## Step 1: Check if Backend Was Updated

**On your server**, check if the fix was applied:

```bash
# Check if basename is imported
grep "import.*basename" /root/asli-backend/index.js

# Should show: import { dirname, join, extname, basename } from 'path';
```

If it doesn't show `basename`, the file wasn't updated. Upload it again:

**On Windows:**
```powershell
scp "F:\Asli learn\backend\index.js" root@139.59.44.174:/root/asli-backend/index.js
```

**Then restart:**
```bash
pm2 restart asli-backend
```

---

## Step 2: Test the Proxy Endpoint

**On your server**, test if the proxy works:

```bash
# Test with a PDF URL
curl -I "http://localhost:5000/api/proxy/content?url=https://ncert.nic.in/textbook/pdf/hegp1ps.pdf"
```

**Expected output:**
- `HTTP/1.1 200 OK` - Proxy is working ✅
- `HTTP/1.1 500 Internal Server Error` - Backend needs fixing
- `HTTP/1.1 404 Not Found` - PDF URL doesn't exist

---

## Step 3: Check Backend Logs

```bash
pm2 logs asli-backend --lines 50
```

Look for:
- "Proxying content from: https://ncert.nic.in/..."
- Any error messages
- "Content type: application/pdf"

---

## Step 4: Test PDF URL Directly

Check if the PDF URL is accessible:

```bash
# On server
curl -I "https://ncert.nic.in/textbook/pdf/hegp1ps.pdf"
```

If this returns 404, the PDF URL is wrong.

---

## Step 5: Alternative - Display PDF Directly

If the proxy still doesn't work, we can display PDFs directly without proxy:

The frontend can load PDFs directly in an iframe if CORS allows it, or we can use a PDF viewer library.

---

## Quick Fix Commands

**If backend wasn't updated:**

```bash
# On Windows
scp "F:\Asli learn\backend\index.js" root@139.59.44.174:/root/asli-backend/index.js

# On server
pm2 restart asli-backend
pm2 logs asli-backend --lines 20
```

**Test the proxy:**
```bash
curl "http://localhost:5000/api/proxy/content?url=https://ncert.nic.in/textbook/pdf/hegp1ps.pdf" -o /tmp/test.pdf && file /tmp/test.pdf
```

If this creates a valid PDF file, the proxy is working!
