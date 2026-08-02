// Real PDF -> preview -> save (client CSV shape) -> confirm the ⚠ review flag
// is on the SAVED questions in the database.
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config({ path: path.join(process.cwd(), '.env') });
const BASE = `http://localhost:${process.env.PORT || 5000}`;
const PDF = 'C:/Users/Asus/Downloads/7th Question Paper with Key.pdf';
const token = jwt.sign(
  { id: 'super-admin-001', email: 'e2e@test.local', fullName: 'E2E', role: 'super-admin' },
  process.env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' },
);
const H = { Authorization: `Bearer ${token}` };
const jH = { ...H, 'Content-Type': 'application/json' };
let failed = false;
const check = (l, ok, d) => { console.log(`${ok ? '  ok  ' : '  FAIL'} ${l}${d ? ` — ${d}` : ''}`); if (!ok) failed = true; };

const cr = await (await fetch(`${BASE}/api/super-admin/exams`, {
  method: 'POST', headers: jH,
  body: JSON.stringify({
    title: 'ZZ PDF FLAG TEST (auto-delete)', examType: 'practice', classNumber: '7',
    assignedClasses: ['7'], subjects: ['maths', 'physics', 'chemistry', 'biology'],
    maxAttempts: 1, duration: 120, totalQuestions: 80, totalMarks: 80, board: 'CBSE',
    startDate: new Date().toISOString(), endDate: new Date(Date.now() + 86400000).toISOString(),
  }),
})).json();
const examId = cr?.data?._id || cr?.exam?._id || cr?.data?.exam?._id;
if (!examId) { console.error('create failed'); process.exit(1); }
console.log('exam:', examId);

try {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(PDF)], { type: 'application/pdf' }), 'paper.pdf');
  const conv = await (await fetch(`${BASE}/api/super-admin/exams/${examId}/questions/pdf-convert`, {
    method: 'POST', headers: H, body: fd,
  })).json();
  const rows = Array.isArray(conv.data) ? conv.data : [];
  const previewFlagged = rows.filter((r) => r.solvable === false);
  console.log(`extracted ${rows.length}, cost ₹${conv.meta.extraction.approxCostInr}`);
  check('preview has flagged rows', previewFlagged.length > 0,
    previewFlagged.map((r) => `Q${r.questionNumber}`).join(', '));

  // Exactly what the client builds on "Upload These Questions"
  const san = (v) => String(v ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\t/g, ' ');
  const esc = (v) => { const s = san(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const label = (s) => ({ maths: 'Mathematics', physics: 'Physics', chemistry: 'Chemistry', biology: 'Biology' }[s] || '');
  const headers = ['questionText','questionType','subject','marks','option1','option2','option3','option4','correctAnswer','explanation','questionImage','displayOrder','sectionHeading','needsReview','reviewNote'];
  const csv = [headers.join(','), ...rows.map((r, i) => {
    const qn = Number(r.questionNumber);
    return [r.questionText, r.questionType, r.subject, Number(r.marks || 1) > 0 ? Number(r.marks) : 1,
      r.questionType === 'integer' ? '' : r.option1, r.questionType === 'integer' ? '' : r.option2,
      r.questionType === 'integer' ? '' : r.option3, r.questionType === 'integer' ? '' : r.option4,
      r.correctAnswer, r.explanation, String(r.questionImage || '').trim(),
      Number.isFinite(qn) && qn >= 1 ? qn : i + 1, label(r.subject),
      r.solvable === false ? 'true' : 'false', san(r.validationNote)].map(esc).join(',');
  })].join('\n');

  const fd2 = new FormData();
  fd2.append('file', new Blob([csv], { type: 'text/csv' }), 'x.csv');
  fd2.append('allowDuplicates', 'false');
  const up = await (await fetch(`${BASE}/api/super-admin/exams/${examId}/questions/bulk-upload`, {
    method: 'POST', headers: H, body: fd2,
  })).json();
  check('saved 80 with no errors',
    (up?.data?.created ?? up?.created) === 80 && (up?.data?.errors ?? []).length === 0);

  const list = (await (await fetch(`${BASE}/api/super-admin/exams/${examId}/questions`, { headers: H })).json())?.data || [];
  const savedFlagged = list.filter((q) => q.needsReview === true);
  check('flags present on SAVED questions', savedFlagged.length === previewFlagged.length,
    `preview ${previewFlagged.length} vs saved ${savedFlagged.length}`);
  savedFlagged.forEach((q) => console.log(`     Q${q.displayOrder}: "${q.reviewNote}"`));
  check('review notes saved', savedFlagged.every((q) => String(q.reviewNote || '').trim().length > 0));
  check('unflagged questions are not flagged',
    list.filter((q) => q.needsReview !== true).length === 80 - savedFlagged.length);

  console.log(failed ? '\nFAIL' : '\nPASS — flags survive a real PDF upload');
} finally {
  await fetch(`${BASE}/api/super-admin/exams/${examId}/questions`, { method: 'DELETE', headers: H }).catch(() => {});
  const d = await fetch(`${BASE}/api/super-admin/exams/${examId}`, { method: 'DELETE', headers: H });
  console.log('cleanup:', d.status);
}
