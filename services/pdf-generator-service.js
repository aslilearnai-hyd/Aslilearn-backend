import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Generate PDF from AI Risk Analysis data
 */
export async function generateRiskAnalysisPDF(analysisData, studentInfo) {
  return new Promise((resolve, reject) => {
    try {
      // Create PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      // Create output directory if it doesn't exist
      const outputDir = path.join(__dirname, '../uploads/reports');
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `risk-analysis-${studentInfo.studentId}-${timestamp}.pdf`;
      const filepath = path.join(outputDir, filename);

      // Pipe PDF to file
      const stream = fs.createWriteStream(filepath);
      doc.pipe(stream);

      // Header
      doc.fontSize(20)
         .fillColor('#FF6B35')
         .text('AI Student Risk Analysis Report', { align: 'center' })
         .moveDown(0.5);

      // Student Information
      doc.fontSize(14)
         .fillColor('#333333')
         .text(`Student: ${studentInfo.name}`, { align: 'left' })
         .fontSize(12)
         .text(`Email: ${studentInfo.email}`, { align: 'left' })
         .text(`Class: ${studentInfo.classNumber}`, { align: 'left' })
         .text(`Generated: ${new Date(analysisData.generatedAt).toLocaleString()}`, { align: 'left' })
         .moveDown(1);

      // Risk Assessment Section
      doc.fontSize(16)
         .fillColor('#FF6B35')
         .text('Risk Assessment', { underline: true })
         .moveDown(0.5);

      const riskColor = analysisData.riskLevel === 'high' ? '#DC2626' : 
                       analysisData.riskLevel === 'medium' ? '#F59E0B' : '#10B981';
      const riskLabel = analysisData.riskLevel.toUpperCase();

      doc.fontSize(14)
         .fillColor(riskColor)
         .text(`${riskLabel} RISK`, { align: 'left' })
         .fontSize(12)
         .fillColor('#333333')
         .text(`Risk Score: ${Math.round(analysisData.riskScore * 100)}%`, { align: 'left' })
         .moveDown(0.5)
         .text(analysisData.analysis.summary, { align: 'left' })
         .moveDown(1);

      // Performance Trends
      doc.fontSize(16)
         .fillColor('#FF6B35')
         .text('Performance Trends', { underline: true })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#333333')
         .text(analysisData.analysis.trends, { align: 'left' })
         .moveDown(1);

      // Strengths
      doc.fontSize(16)
         .fillColor('#10B981')
         .text('Strengths', { underline: true })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#333333');

      analysisData.analysis.strengths.forEach((strength, index) => {
        doc.text(`• ${strength}`, { indent: 20 });
      });
      doc.moveDown(1);

      // Weaknesses
      doc.fontSize(16)
         .fillColor('#DC2626')
         .text('Weaknesses', { underline: true })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#333333');

      analysisData.analysis.weaknesses.forEach((weakness, index) => {
        doc.text(`• ${weakness}`, { indent: 20 });
      });
      doc.moveDown(1);

      // Root Causes
      doc.fontSize(16)
         .fillColor('#FF6B35')
         .text('Root Causes', { underline: true })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#333333');

      analysisData.analysis.rootCauses.forEach((cause, index) => {
        doc.text(`• ${cause}`, { indent: 20 });
      });
      doc.moveDown(1);

      // Predictions
      doc.fontSize(16)
         .fillColor('#FF6B35')
         .text('AI Predictions', { underline: true })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#333333')
         .text(`Next Exam Prediction: ${Math.round(analysisData.predictions.nextExamPrediction)}%`, { align: 'left' })
         .text(`Confidence: ${Math.round(analysisData.predictions.confidence * 100)}%`, { align: 'left' })
         .text(`Trend: ${analysisData.predictions.trend.toUpperCase()}`, { align: 'left' })
         .moveDown(1);

      // Interventions
      doc.fontSize(16)
         .fillColor('#FF6B35')
         .text('Recommended Interventions', { underline: true })
         .moveDown(0.5)
         .fontSize(12)
         .fillColor('#333333');

      analysisData.interventions.forEach((intervention, index) => {
        const priorityColor = intervention.priority === 'high' ? '#DC2626' : 
                             intervention.priority === 'medium' ? '#F59E0B' : '#10B981';
        
        doc.fillColor(priorityColor)
           .text(`${index + 1}. ${intervention.priority.toUpperCase()} PRIORITY: ${intervention.action}`, { indent: 20 })
           .fillColor('#666666')
           .fontSize(10)
           .text(`   Reasoning: ${intervention.reasoning}`, { indent: 30 })
           .text(`   Expected Impact: ${intervention.expectedImpact}`, { indent: 30 })
           .fontSize(12)
           .fillColor('#333333')
           .moveDown(0.5);
      });
      doc.moveDown(1);

      // Subject Breakdown
      if (Object.keys(analysisData.subjectBreakdown).length > 0) {
        doc.fontSize(16)
           .fillColor('#FF6B35')
           .text('Subject-wise Analysis', { underline: true })
           .moveDown(0.5)
           .fontSize(12)
           .fillColor('#333333');

        Object.entries(analysisData.subjectBreakdown).forEach(([subject, data]) => {
          doc.text(`${subject}:`, { indent: 20, continued: true })
             .fillColor('#666666')
             .text(` ${data.performance.toUpperCase()} - ${data.trend.toUpperCase()}`, { indent: 0 })
             .fillColor('#333333')
             .fontSize(10)
             .text(`   ${data.recommendation}`, { indent: 30 })
             .fontSize(12)
             .moveDown(0.3);
        });
      }

      // Footer
      doc.fontSize(10)
         .fillColor('#999999')
         .text(`Generated by AsliLearn AI - Based on ${analysisData.dataPoints || 0} exam${analysisData.dataPoints !== 1 ? 's' : ''}`, 
                { align: 'center' })
         .moveDown(0.5)
         .text('This is an AI-generated analysis. Please consult with educators for personalized guidance.', 
                { align: 'center' });

      // Finalize PDF
      doc.end();

      stream.on('finish', () => {
        resolve({ filepath, filename });
      });

      stream.on('error', (error) => {
        reject(error);
      });

    } catch (error) {
      reject(error);
    }
  });
}

