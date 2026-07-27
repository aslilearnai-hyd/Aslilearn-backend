# Restore Brainfeed students (simple steps)

Your students were **deleted from the live database**. Copies still exist in **MongoDB Atlas Backup**.  
I cannot put them back until Atlas gives us that backup copy (one short step from you).

## Do this now (about 5–10 minutes)

### 1. Open Atlas Backup
1. Go to [cloud.mongodb.com](https://cloud.mongodb.com)
2. Open project **Project 0** → cluster **Cluster0**
3. Click **Backup** (left sidebar)

### 2. Pick a safe snapshot
Click a snapshot from **21 July** or **22 July morning**  
(before about **3:20 PM IST on 22 July** — that is when students were still active).

Avoid 25–27 July snapshots — those may already have **0** students.

### 3. Start Queryable Backup
1. On that snapshot row, click **…** or **Restore**
2. Choose **Queryable Backup** / **Query**
3. Wait until status says **Ready** (can take several minutes)
4. Click **Connect** / copy the **connection string**

### 4. Send me the connection string
Paste it in this chat (it is temporary; you can end Queryable Backup after we finish).

I will then:
1. Copy the Brainfeed student accounts out of that backup  
2. Insert only those ~12 students back into live `users`  
3. **Not** wipe your live database  

---

## What not to click
- Do **not** choose **Restore to Cluster0** / overwrite the whole cluster  
- That can erase newer data for every school  

---

## After restore
Students can log in with their **old passwords** (same accounts, same IDs).  
Exam history should reconnect because we keep the original student IDs.
