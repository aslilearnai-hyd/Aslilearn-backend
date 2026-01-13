# PDF Extraction Setup Guide

## Overview
The teacher dashboard AI tools now use PDF-extracted content instead of AI generation. Teachers upload PDFs, content is extracted using Python, and all tools generate content from the extracted data.

## Workflow

1. **Teacher uploads PDF** → PDF is saved to server
2. **Python script extracts content** → Questions, topics, content extracted
3. **Content saved to CSV** → Stored in organized structure
4. **AI tools use extracted content** → All 14 tools generate from PDF content
5. **Zero AI cost** → No API calls needed

## Setup Instructions

### 1. Install Python Dependencies

```bash
pip install pdfplumber PyPDF2
```

Or using requirements.txt:
```bash
pip install -r requirements.txt
```

### 2. Verify Python Installation

```bash
python3 --version  # Should be Python 3.7+
```

### 3. Make PDF Extractor Executable (Linux/Mac)

```bash
chmod +x backend/scripts/pdf-extractor.py
```

### 4. Test PDF Extraction

```bash
python3 backend/scripts/pdf-extractor.py test.pdf output/ 9 maths algebra
```

## API Endpoints

### Upload PDF
```
POST /api/teacher/ai/upload-pdf
Content-Type: multipart/form-data

Body:
- pdf: File (PDF file)
- classNumber: String (e.g., "9")
- subject: String (e.g., "Mathematics")
- topic: String (e.g., "Algebra")
```

### Get PDF Topics
```
GET /api/teacher/ai/pdf-topics?classNumber=9&subject=Mathematics
```

### Generate Tool (Uses PDF content)
```
POST /api/teacher/ai/tool
Body:
{
  "toolType": "worksheet-mcq-generator",
  "classNumber": "9",
  "subject": "Mathematics",
  "topic": "Algebra",
  ...
}
```

## File Structure

```
backend/
├── scripts/
│   └── pdf-extractor.py          # Python extraction script
├── services/
│   └── pdf-extractor-service.js   # Node.js service wrapper
├── models/
│   └── PDFContent.js              # MongoDB model for PDF metadata
├── uploads/
│   ├── pdfs/                      # Uploaded PDFs
│   └── extracted/                 # Extracted CSV files
│       ├── 9/
│       │   └── maths/
│       │       ├── algebra.csv
│       │       └── algebra_metadata.json
│       └── 10/
│           └── science/
│               └── ...
└── controllers/
    └── aiToolsController.js       # Updated to use PDF content
```

## How It Works

### 1. PDF Upload Flow
```
User uploads PDF
    ↓
Backend saves PDF to uploads/pdfs/
    ↓
Python script extracts content
    ↓
Content saved to uploads/extracted/{class}/{subject}/{topic}.csv
    ↓
Metadata saved to MongoDB (PDFContent model)
    ↓
Ready for AI tools to use
```

### 2. Tool Generation Flow
```
User selects tool and parameters
    ↓
Backend checks for PDF-extracted content
    ↓
If found: Use PDF content
If not found: Fallback to CSV (Class 9-10 only)
    ↓
Transform questions using templates
    ↓
Return formatted content
```

## Supported Tools

All 14 teacher tools work with PDF content:
1. Activity & Project Generator
2. Worksheet & MCQ Generator
3. Concept Mastery Helper
4. Lesson Planner
5. Exam Question Paper Generator
6. Daily Class Plan Maker
7. Homework Creator
8. Rubrics & Evaluation Generator
9. Learning Outcomes Generator
10. Story & Passage Creator
11. Short Notes & Summaries Maker
12. Flashcard Generator
13. Report Card Generator
14. Student Skill Tracker

## Cost Savings

- **Before**: ₹13,44,720/month (1,000 users, 200 requests/day)
- **After**: ₹0/month (PDF extraction, no AI needed)
- **Savings**: 100% cost reduction

## Troubleshooting

### Python not found
```bash
# Check Python installation
python3 --version

# If not installed, install Python 3.7+
```

### PDF extraction fails
1. Check PDF is not image-based (scanned PDFs need OCR)
2. Verify PDF is not corrupted
3. Check file size (max 50MB)
4. Review extraction logs in backend console

### No topics found
1. Upload a PDF first for the class/subject/topic
2. Wait for extraction to complete (check extractionStatus in database)
3. Verify CSV file was created in uploads/extracted/

### Content not generating
1. Check if PDF was uploaded for that topic
2. Verify extraction completed successfully
3. Check CSV file exists and has questions
4. Review backend logs for errors

## Next Steps

1. ✅ Install Python dependencies
2. ✅ Test PDF upload
3. ✅ Verify extraction works
4. ✅ Use AI tools with PDF content
5. ✅ Monitor extraction quality
6. ✅ Upload more PDFs for different topics

## Notes

- PDF extraction happens asynchronously (non-blocking)
- Teachers can use tools immediately after upload (extraction in background)
- CSV fallback still works for Class 9-10
- All extracted content is stored locally (no external APIs)






