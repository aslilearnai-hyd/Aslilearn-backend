/**
 * Find adminId values still referenced in content after school/admin deletion.
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import connectDB from '../config/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const COLS = ['contents', 'exams', 'assessments', 'videos', 'classes', 'examresults', 'teachers'];

async function main() {
  await connectDB();
  const db = (await import('mongoose')).default.connection.db;
  const adminIds = new Set();

  for (const col of COLS) {
    try {
      const cursor = db.collection(col).find({ adminId: { $exists: true, $ne: null } });
      for await (const doc of cursor) {
        if (doc.adminId) adminIds.add(String(doc.adminId));
      }
    } catch {
      // collection may not exist
    }
  }

  console.log('Orphaned adminId references in content:', adminIds.size);
  console.log([...adminIds].slice(0, 20));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
