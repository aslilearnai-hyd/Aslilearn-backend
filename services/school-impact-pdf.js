import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 2-page School Impact Snapshot PDF (matches AsliLearn_AI_School_Impact_Report_Template).
 */
export async function generateSchoolImpactPDF(snapshot) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
      const outputDir = path.join(__dirname, '../uploads/reports/impact');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `school-impact-${String(snapshot.adminId)}-${stamp}.pdf`;
      const filepath = path.join(outputDir, filename);
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      const orange = '#FF6B35';
      const ink = '#1e293b';
      const muted = '#64748b';

      doc.fontSize(20).fillColor(orange).text('AsliLearn.ai', { align: 'center' });
      doc.moveDown(0.2);
      doc.fontSize(16).fillColor(ink).text('School Impact Snapshot', { align: 'center' });
      doc.moveDown(0.8);

      doc.fontSize(11).fillColor(muted).text(`School: `, { continued: true }).fillColor(ink).text(snapshot.schoolName || '—');
      if (snapshot.location) {
        doc.fillColor(muted).text(`Location: `, { continued: true }).fillColor(ink).text(snapshot.location);
      }
      doc.fillColor(muted).text(`Report period: `, { continued: true }).fillColor(ink).text(snapshot.periodLabel || '—');
      doc.moveDown(1);

      doc.fontSize(13).fillColor(orange).text('1. Key Numbers at a Glance', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor(ink);

      const keyRows = [
        ['Teacher licenses issued', snapshot.teachersIssued],
        ['Teachers who logged in (week)', snapshot.teachersLoggedIn],
        ['Teachers actively using (3+ days / 14d)', snapshot.teachersActive],
        ['Teachers occasional / inactive', `${snapshot.teachersOccasional} / ${snapshot.teachersInactive}`],
        ['Students on platform', snapshot.studentsIssued],
        ['Students who accessed (week)', snapshot.studentsAccessed],
        ['Students with 3+ sessions', snapshot.studentsActive3Plus],
        ['Total learning sessions', snapshot.totalLearningSessions],
        ['Total minutes spent', snapshot.totalMinutesSpent],
        ['AI explanations / doubts', snapshot.aiExplanationsCount],
        ['Practice / quiz attempts', snapshot.practiceAttempts],
      ];
      for (const [label, value] of keyRows) {
        doc.fillColor(muted).text(`${label}: `, { continued: true }).fillColor(ink).text(String(value ?? '—'));
      }
      doc.moveDown(0.8);

      doc.fontSize(13).fillColor(orange).text('2. Subject-wise & Content Engagement', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor(ink);
      const subjects = Array.isArray(snapshot.topSubjects) ? snapshot.topSubjects : [];
      if (!subjects.length) {
        doc.fillColor(muted).text('No subject activity recorded this week.');
      } else {
        for (const row of subjects) {
          doc
            .fillColor(ink)
            .text(`${row.subject || 'General'}: ${row.pct}% (${row.sessions} activity units)`);
        }
      }
      doc.moveDown(0.8);

      doc.fontSize(13).fillColor(orange).text('3. Depth of Usage & Early Insights', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor(ink);
      doc.text(`Average sessions per active student: ${snapshot.avgSessionsPerActiveStudent ?? 0}`);
      doc.text(`% students with repeat practice: ${snapshot.repeatPracticeStudentPct ?? 0}%`);
      doc.text(`Practice accuracy (where tracked): ${snapshot.practiceCorrectRate ?? 0}%`);
      doc.text(
        `Teachers consistently assigning / generating: ${snapshot.teachersActive ?? 0} of ${snapshot.teachersIssued ?? 0}`,
      );
      doc.moveDown(0.5);
      doc.fillColor(muted).text('Key observation', { underline: true });
      doc.fillColor(ink).text(snapshot.keyObservation || '—', { align: 'left' });
      doc.moveDown(0.8);

      doc.fontSize(13).fillColor(orange).text('4. Projected Impact if Scaled', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor(ink);
      doc.text(
        'If the same engagement extends across Classes 6–10, expect stronger consistent practice, better foundation readiness for boards and competitive exams, and clearer visibility for Admin and Teachers.',
      );
      doc.moveDown(0.8);

      doc.fontSize(13).fillColor(orange).text('5. Recommended Next Step', { underline: true });
      doc.moveDown(0.4);
      doc.fontSize(10).fillColor(ink);
      doc.text(
        'Activate paid student licenses so every student gets the same advantage as your active teachers and early users. Custom pricing, priority onboarding, and continued support available.',
      );
      doc.moveDown(1);
      doc.fontSize(9).fillColor(muted).text('Powered by Asli Prep Foundation  |  CBSE & State Boards  |  Asli Prep IIT Books', {
        align: 'center',
      });

      doc.end();
      stream.on('finish', () => resolve({ filepath, filename }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}
