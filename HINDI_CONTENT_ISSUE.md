# Hindi Content Issue - Exam Question Paper Generator

## Problem
When selecting **Hindi** as the subject, the exam question paper generator is showing **Maths questions in English** instead of Hindi questions.

## Root Cause
All CSV files in `backend/Asli hardcoding/Class 6/Hindi/` contain **Maths questions in English** instead of Hindi language questions.

### Example:
- **File**: `Class 6/Hindi/MCQ/c2 medium.csv` (for topic "बचपन")
- **Current Content**: Maths questions like "Which of the following is the smallest whole number?"
- **Expected Content**: Hindi questions about "बचपन" (childhood) in Hindi language

## Affected Files
All CSV files in these folders need Hindi content:
- `Class 6/Hindi/MCQ/` - All c1-c13 files (easy, medium, hard)
- `Class 6/Hindi/Fill in the Blanks/` - All c1-c13 files
- `Class 6/Hindi/Short answer/` - All c1-c13 files
- `Class 6/Hindi/Long answer/` - All c1-c13 files
- `Class 6/Hindi/Match the following/` - All c1-c13 files
- `Class 6/Hindi/True or False/` - All c1-c13 files

## Topic Mapping (from planner.json)
- C1 = "वह चिड़िया जो"
- C2 = "बचपन" (Bachpan - Childhood)
- C3 = "नादान दोस्त"
- ... and so on

## Solution Required
Replace all Hindi CSV files with actual Hindi language questions related to the corresponding topics from `planner.json`.

### Example Format for Hindi MCQ:
```csv
Question,Option A,Option B,Option C,Option D,Correct Answer
"बचपन कविता के कवि कौन हैं?","रामधारी सिंह दिनकर","सुमित्रानंदन पंत","महादेवी वर्मा","हरिवंश राय बच्चन",D
"बचपन कविता में किस भावना का वर्णन है?","खुशी","उदासी","याद","भय",C
```

## Code Fix Status
✅ **Fixed**: The code now properly combines all question types (MCQ, Fill in Blanks, Short answer, Long answer, etc.) for exam papers.

❌ **Pending**: Hindi CSV files need to be replaced with actual Hindi content.

## Next Steps
1. Generate or obtain Hindi questions for all topics in `planner.json`
2. Replace all CSV files in `Class 6/Hindi/` folders with Hindi content
3. Ensure questions are in Hindi language and related to the correct topics
