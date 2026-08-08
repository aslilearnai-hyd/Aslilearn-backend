import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function ensureSpace(doc, need = 80) {
  if (doc.y + need > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

function sectionTitle(doc, text, orange) {
  ensureSpace(doc, 36);
  doc.fontSize(13).fillColor(orange).text(text, { underline: true });
  doc.moveDown(0.35);
}

function kv(doc, label, value, muted, ink) {
  doc.fontSize(9).fillColor(muted).text(`${label}: `, { continued: true }).fillColor(ink).text(String(value ?? '—'));
}

/**
 * Multi-page School Impact Report:
 * 1) School summary
 * 2) Day-wise activity (when available)
 * 3) Student roster
 * 4+) Per-active-student detail (videos, exams, AI, sessions)
 */
export async function generateSchoolImpactPDF(snapshot) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 44, bottom: 48, left: 44, right: 44 },
        bufferPages: true,
      });
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
      const students = Array.isArray(snapshot.studentReports) ? snapshot.studentReports : [];
      const active = students.filter((s) => s.accessed);
      const dayBreakdown = Array.isArray(snapshot.dayBreakdown) ? snapshot.dayBreakdown : [];
      const periodKind =
        snapshot.mode === 'custom'
          ? 'Day / custom range report'
          : 'Weekly school impact report';

      // ——— Page 1: School summary ———
      doc.fontSize(18).fillColor(orange).text('AsliLearn.ai', { align: 'center' });
      doc.moveDown(0.15);
      doc.fontSize(14).fillColor(ink).text('Detailed School Impact Report', { align: 'center' });
      doc.fontSize(9).fillColor(muted).text(periodKind, { align: 'center' });
      doc.moveDown(0.7);

      kv(doc, 'School', snapshot.schoolName || '—', muted, ink);
      if (snapshot.location) kv(doc, 'Location', snapshot.location, muted, ink);
      kv(doc, 'Report period', snapshot.periodLabel || '—', muted, ink);
      kv(
        doc,
        'Students with activity',
        `${snapshot.activeStudentCount ?? active.length} / ${
          snapshot.totalStudents ?? students.length ?? snapshot.studentsIssued ?? 0
        }`,
        muted,
        ink,
      );
      doc.moveDown(0.7);

      sectionTitle(doc, '1. Key numbers at a glance', orange);
      doc.fontSize(9).fillColor(ink);
      const keyRows = [
        ['Teacher licenses issued', snapshot.teachersIssued],
        ['Teachers logged in (period)', snapshot.teachersLoggedIn],
        ['Teachers active (3+ days / 14d)', snapshot.teachersActive],
        ['Students on platform', snapshot.studentsIssued],
        ['Students who accessed', snapshot.studentsAccessed],
        ['Students with 3+ sessions', snapshot.studentsActive3Plus],
        ['Total learning sessions', snapshot.totalLearningSessions],
        ['Total minutes spent', snapshot.totalMinutesSpent],
        ['Videos watched (progress updates)', snapshot.videosWatchedCount],
        ['Students who watched videos', snapshot.studentsWatchedVideos],
        ['Exam attempts', snapshot.examAttemptsCount],
        ['Students who took exams', snapshot.studentsTookExams],
        ['AI explanations / doubts', snapshot.aiExplanationsCount],
        ['Practice / quiz attempts', snapshot.practiceAttempts],
        ['Homework submissions', snapshot.homeworkSubmissions],
        ['IQ quiz attempts', snapshot.iqQuizAttempts],
      ];
      for (const [label, value] of keyRows) {
        kv(doc, label, value, muted, ink);
      }
      doc.moveDown(0.5);

      sectionTitle(doc, '2. Subjects & observation', orange);
      const subjects = Array.isArray(snapshot.topSubjects) ? snapshot.topSubjects : [];
      if (!subjects.length) {
        doc.fontSize(9).fillColor(muted).text('No subject activity recorded in this period.');
      } else {
        for (const row of subjects) {
          doc
            .fontSize(9)
            .fillColor(ink)
            .text(`${row.subject || 'General'}: ${row.pct}% (${row.sessions} activity units)`);
        }
      }
      doc.moveDown(0.35);
      doc.fontSize(9).fillColor(muted).text('Key observation', { underline: true });
      doc.fillColor(ink).text(snapshot.keyObservation || '—', { align: 'left' });

      // ——— Day-wise ———
      if (dayBreakdown.length) {
        doc.addPage();
        sectionTitle(doc, '3. Day-wise activity', orange);
        doc
          .fontSize(8)
          .fillColor(muted)
          .text('Date'.padEnd(14) + 'Sessions'.padEnd(12) + 'Minutes'.padEnd(12) + 'Students');
        doc.moveDown(0.2);
        for (const day of dayBreakdown) {
          ensureSpace(doc, 16);
          doc
            .fontSize(9)
            .fillColor(ink)
            .text(
              `${String(day.date || '—').padEnd(14)}${String(day.sessions ?? 0).padEnd(12)}${String(day.minutes ?? 0).padEnd(12)}${day.students ?? 0}`,
            );
        }
      }

      // ——— Student roster ———
      doc.addPage();
      sectionTitle(doc, `${dayBreakdown.length ? '4' : '3'}. Student roster (period)`, orange);
      doc
        .fontSize(8)
        .fillColor(muted)
        .text(
          'Active students listed first. Columns: sessions · videos · exams · AI · summary.',
        );
      doc.moveDown(0.35);

      const roster = active.length ? active : students.slice(0, 120);
      for (let i = 0; i < roster.length; i += 1) {
        const s = roster[i];
        ensureSpace(doc, 28);
        doc
          .fontSize(9)
          .fillColor(ink)
          .text(
            `${i + 1}. ${s.name}${s.classNumber ? ` (Class ${s.classNumber})` : ''}`,
            { continued: false },
          );
        doc
          .fontSize(8)
          .fillColor(muted)
          .text(
            `   Sessions ${s.sessions || 0} · Videos ${s.videosWatched || 0} · Exams ${s.examAttempts || 0} · AI ${s.aiDoubts || 0} · HW ${s.homeworkSubmissions || 0}`,
          );
        if (s.summary) {
          doc.fontSize(8).fillColor(ink).text(`   ${s.summary}`);
        }
        doc.moveDown(0.15);
      }

      if (!active.length) {
        doc.moveDown(0.4);
        doc.fontSize(9).fillColor(muted).text('No student activity in this period.');
      }

      // ——— Per-student detail (active only, cap for huge schools) ———
      const detailCap = 80;
      const detailList = active.slice(0, detailCap);
      if (detailList.length) {
        doc.addPage();
        sectionTitle(
          doc,
          `${dayBreakdown.length ? '5' : '4'}. Student-wise detailed reports`,
          orange,
        );
        doc
          .fontSize(8)
          .fillColor(muted)
          .text(
            `Showing ${detailList.length} student(s) with activity${
              active.length > detailCap ? ` (of ${active.length} active)` : ''
            }. Each block is one student report for this period.`,
          );
        doc.moveDown(0.4);

        detailList.forEach((s, idx) => {
          ensureSpace(doc, 110);
          doc
            .fontSize(11)
            .fillColor(orange)
            .text(`${idx + 1}. ${s.name}`, { underline: false });
          doc
            .fontSize(8)
            .fillColor(muted)
            .text(
              [
                s.classNumber ? `Class ${s.classNumber}` : null,
                s.email || null,
                s.lastLogin ? `Last login ${new Date(s.lastLogin).toLocaleString('en-IN')}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—',
            );
          doc.moveDown(0.2);
          doc.fontSize(9).fillColor(ink);
          kv(doc, 'Learning sessions', `${s.sessions || 0} (${s.minutes || 0} min, ${s.daysActive || 0} active day(s))`, muted, ink);
          kv(doc, 'Videos watched', `${s.videosWatched || 0} (progress updates: ${s.videoTouches || 0})`, muted, ink);
          kv(doc, 'Chapters progressed', s.chaptersCompleted || 0, muted, ink);
          kv(
            doc,
            'Exams written',
            `${s.examAttempts || 0}${
              s.examAttempts
                ? ` · avg ${s.avgExamPct ?? 0}% · best ${s.bestExamPct ?? 0}%`
                : ''
            }`,
            muted,
            ink,
          );
          if (s.examTitles?.length) {
            doc
              .fontSize(8)
              .fillColor(muted)
              .text(`Exam titles: ${s.examTitles.join('; ')}`);
          }
          kv(doc, 'AI / Vidya doubts', s.aiDoubts || 0, muted, ink);
          kv(doc, 'Practice attempts', s.practiceAttempts || 0, muted, ink);
          kv(doc, 'IQ quiz attempts', s.iqAttempts || 0, muted, ink);
          kv(doc, 'Homework submissions', s.homeworkSubmissions || 0, muted, ink);
          doc.moveDown(0.35);
          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor('#e2e8f0')
            .stroke();
          doc.moveDown(0.45);
        });
      }

      // Footer on last content
      ensureSpace(doc, 40);
      doc.moveDown(0.5);
      doc
        .fontSize(8)
        .fillColor(muted)
        .text(
          'Powered by Asli Prep Foundation  |  CBSE & State Boards  |  Asli Prep IIT Books',
          { align: 'center' },
        );
      doc
        .fontSize(7)
        .fillColor(muted)
        .text(`Generated ${new Date().toLocaleString('en-IN')} · Period ${snapshot.periodLabel || ''}`, {
          align: 'center',
        });

      // Page numbers
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i += 1) {
        doc.switchToPage(i);
        doc
          .fontSize(7)
          .fillColor(muted)
          .text(`Page ${i + 1} of ${pages.count}`, 44, doc.page.height - 36, {
            align: 'center',
            width: doc.page.width - 88,
          });
      }

      doc.end();
      stream.on('finish', () => resolve({ filepath, filename }));
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}
