# Brainfeed deletion — which hourly snapshot first lost the students?

## Atlas Admin API limits
- Restore API `deliveryType` accepts only: `automated` | `download` | `pointInTime`
- `queryable` is **not** supported via API (returns `MISSING_ATTRIBUTE`)
- Use **Atlas UI → Queryable Backup** to binary-search hourlies
- API can start a **download** restore; extract `users` into a temp collection (do not overwrite live)

Use **Queryable Backup** on hourly snapshots and binary-search.

## Known facts
- Last student exam activity: **2026-07-22T09:49:51.414Z** (student still existed)
- School row updated: **2026-07-24T06:25:01.226Z**
- Live DB now: **0** Brainfeed students
- Deletion window: **after 22 Jul 09:49 UTC** and before now

## Snapshots to check (in this order — binary search)

Your Atlas times look like local time. Convert carefully.
UTC reference: last exam ≈ **22 Jul 15:19 IST** if browser is IST (UTC+5:30).

### Round 1 — find the day
| Snapshot to open | Expected |
|---|---|
| **22 Jul ~05:00 / morning hourly** (before 09:49 UTC) | PRESENT (count > 0) |
| **22 Jul evening / 23 Jul daily** | ? |
| **24 Jul ~06:00 UTC / morning** | ? |
| **25 Jul 11:39 AM daily** (from your list) | likely MISSING |

### Round 2 — once you know the day, check that day's hourlies
Example if missing starts on 24 Jul:
- 23 Jul 11:39 PM hourly
- 24 Jul 05:38 AM hourly
- 24 Jul 11:39 AM hourly
- 24 Jul 05:39 PM hourly

The **first snapshot where count = 0** is the first backup taken **after** the delete.
Delete time ≈ between that snapshot and the previous hourly.

## How to check one snapshot (Atlas UI)
1. Backup → click the snapshot row
2. **Query** / **Queryable Backup** (or Restore → queryable)
3. Wait until status is ready → copy connection string
4. On droplet:

```bash
cd /var/www/ASLI-STUD-BACK
SNAPSHOT_LABEL='22Jul-05:38AM' SNAPSHOT_URI='<paste-queryable-uri>' \
  node scripts/count-brainfeed-in-snapshot.mjs
```

- Exit / message **PRESENT** → students still there  
- **MISSING** → already deleted in that snapshot  

5. Close/end the queryable backup when done (they cost money while running)

## Fast path
1. Check **22 Jul morning** hourly → should be PRESENT  
2. Check **24 Jul 05:38 AM** hourly  
3. Check **25 Jul 11:39 AM** daily  
4. Narrow between the last PRESENT and first MISSING hourlies  

Paste each script JSON output here and I’ll tell you the exact snapshot where data first went missing.
