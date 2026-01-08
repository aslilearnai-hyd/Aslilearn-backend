#!/usr/bin/env python3
"""
PDF Content Extractor for Teacher AI Tools
Extracts questions, content, and structured data from PDFs
"""

import sys
import json
import csv
import re
import os
from pathlib import Path

try:
    import pdfplumber
    import PyPDF2
except ImportError:
    print("ERROR: Required libraries not installed. Run: pip install pdfplumber PyPDF2")
    sys.exit(1)


def extract_text_from_pdf(pdf_path):
    """Extract all text from PDF using pdfplumber (better for structured content)"""
    text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        print(f"Error with pdfplumber: {e}, trying PyPDF2...")
        # Fallback to PyPDF2
        with open(pdf_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
    return text


def extract_questions_from_text(text):
    """Extract questions from text using enhanced pattern matching for textbooks"""
    questions = []
    question_counter = 1
    
    # Enhanced question patterns for textbooks
    # Pattern 1: Q1, Q2, Question 1, etc.
    pattern1 = r'(?:Q|Question|Q\.|Q:)\s*(\d+)[\.:\)]\s*(.+?)(?=(?:Q|Question|Q\.|Q:)\s*\d+[\.:\)]|$)'
    # Pattern 2: 1., 2., 3. (numbered questions)
    pattern2 = r'^(\d+)[\.\)]\s+(.+?)(?=^\d+[\.\)]|^Q|^Question|$)'
    # Pattern 3: (a), (b), (i), (ii) sub-questions
    pattern3 = r'\(([a-z]|[ivx]+)\)\s+(.+?)(?=\([a-z]|\([ivx]+|^\d+[\.\)]|^Q|$)'
    
    # Try Pattern 1 first (most common in textbooks)
    matches = list(re.finditer(pattern1, text, re.IGNORECASE | re.MULTILINE | re.DOTALL))
    
    # If Pattern 1 doesn't find much, try Pattern 2
    if len(matches) < 3:
        matches = list(re.finditer(pattern2, text, re.IGNORECASE | re.MULTILINE | re.DOTALL))
    
    for match in matches:
        question_num = match.group(1) if match.lastindex >= 1 else str(question_counter)
        question_text = match.group(2).strip() if match.lastindex >= 2 else match.group(0).strip()
        
        # Skip if question is too short (likely not a real question)
        if len(question_text) < 10:
            continue
        
        # Extract options if present (MCQ format)
        options = {}
        option_patterns = [
            r'([A-D])[\.\)]\s*(.+?)(?=[A-D][\.\)]|Answer|Ans|Solution|Correct|$)',
            r'([A-D])[:]\s*(.+?)(?=[A-D][:]|Answer|Ans|Solution|Correct|$)',
            r'\(([A-D])\)\s*(.+?)(?=\([A-D]\)|Answer|Ans|Solution|Correct|$)'
        ]
        
        for opt_pattern in option_patterns:
            option_matches = list(re.finditer(opt_pattern, question_text, re.IGNORECASE | re.MULTILINE))
            if len(option_matches) >= 2:  # At least 2 options found
                for opt_match in option_matches:
                    opt_letter = opt_match.group(1).upper()
                    opt_text = opt_match.group(2).strip()
                    # Clean up option text
                    opt_text = re.sub(r'^\d+[\.\)]\s*', '', opt_text)  # Remove leading numbers
                    options[f'option_{opt_letter.lower()}'] = opt_text
                break
        
        # Extract answer if present
        answer = ''
        answer_patterns = [
            r'(?:Answer|Ans|Correct Answer|Solution|Key)[:\.]\s*([A-D]|.+?)(?=\n|$)',
            r'Answer\s*:\s*([A-D])',
            r'Correct\s+option\s*:\s*([A-D])'
        ]
        
        for ans_pattern in answer_patterns:
            answer_match = re.search(ans_pattern, question_text, re.IGNORECASE)
            if answer_match:
                answer = answer_match.group(1).strip()
                break
        
        # Clean question text - remove options and answer
        clean_question = question_text
        # Remove options
        for opt_key in ['option_a', 'option_b', 'option_c', 'option_d']:
            if opt_key in options:
                opt_letter = opt_key.split('_')[1].upper()
                clean_question = re.sub(rf'{opt_letter}[\.\):]\s*{re.escape(options[opt_key])}', '', clean_question, flags=re.IGNORECASE)
                clean_question = re.sub(rf'\({opt_letter}\)\s*{re.escape(options[opt_key])}', '', clean_question, flags=re.IGNORECASE)
        
        # Remove answer section
        clean_question = re.sub(r'(?:Answer|Ans|Correct Answer|Solution|Key)[:\.].+', '', clean_question, flags=re.IGNORECASE)
        clean_question = re.sub(r'\s+', ' ', clean_question)  # Normalize whitespace
        clean_question = clean_question.strip()
        
        # Determine question type
        question_type = 'MCQ' if len(options) >= 2 else 'Short Answer'
        
        # Only add if we have a meaningful question
        if len(clean_question) >= 10:
            questions.append({
                'Question_Type': question_type,
                'Question_Number': str(question_counter),
                'Question': clean_question,
                'Option_A': options.get('option_a', ''),
                'Option_B': options.get('option_b', ''),
                'Option_C': options.get('option_c', ''),
                'Option_D': options.get('option_d', ''),
                'Answer': answer if answer else (list(options.keys())[0].split('_')[1].upper() if options else '')
            })
            question_counter += 1
    
    # If no structured questions found, try to extract from exercise sections
    if len(questions) == 0:
        # Look for "Exercise", "Questions", "Practice" sections
        exercise_pattern = r'(?:Exercise|Questions|Practice|Problems?)[:\.]?\s*(.+?)(?=(?:Exercise|Questions|Practice|Problems?|Chapter|Unit|$))'
        exercise_matches = re.finditer(exercise_pattern, text, re.IGNORECASE | re.DOTALL)
        
        for ex_match in exercise_matches:
            exercise_text = ex_match.group(1)
            # Try to extract numbered items as questions
            numbered_items = re.finditer(r'(\d+)[\.\)]\s+(.+?)(?=\d+[\.\)]|$)', exercise_text, re.MULTILINE)
            for item in numbered_items:
                item_text = item.group(2).strip()
                if len(item_text) >= 10:
                    questions.append({
                        'Question_Type': 'Short Answer',
                        'Question_Number': str(question_counter),
                        'Question': item_text,
                        'Option_A': '',
                        'Option_B': '',
                        'Option_C': '',
                        'Option_D': '',
                        'Answer': ''
                    })
                    question_counter += 1
    
    return questions


def extract_content_sections(text):
    """Extract content sections (chapters, topics, definitions)"""
    sections = []
    
    # Extract chapter/topic headings
    heading_pattern = r'(?:Chapter|Topic|Unit|Section)\s*(\d+)[:\.]\s*(.+?)(?=(?:Chapter|Topic|Unit|Section)\s*\d+|$)'
    matches = re.finditer(heading_pattern, text, re.IGNORECASE)
    
    for match in matches:
        sections.append({
            'type': 'heading',
            'number': match.group(1),
            'title': match.group(2).strip()
        })
    
    # Extract definitions
    definition_pattern = r'(?:Definition|Def|Term)[:\.]\s*(.+?)(?=(?:Definition|Def|Term|$)'
    def_matches = re.finditer(definition_pattern, text, re.IGNORECASE)
    
    for def_match in def_matches:
        sections.append({
            'type': 'definition',
            'content': def_match.group(1).strip()
        })
    
    return sections


def save_to_csv(questions, output_path):
    """Save extracted questions to CSV format"""
    if not questions:
        # Create empty CSV with headers
        with open(output_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow(['Question_Type', 'Question_Number', 'Question', 
                            'Option_A', 'Option_B', 'Option_C', 'Option_D', 'Answer'])
        return
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['Question_Type', 'Question_Number', 'Question', 
                                              'Option_A', 'Option_B', 'Option_C', 'Option_D', 'Answer'])
        writer.writeheader()
        writer.writerows(questions)


def save_metadata(metadata, output_path):
    """Save extraction metadata to JSON"""
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2, ensure_ascii=False)


def main():
    if len(sys.argv) < 3:
        print("Usage: python pdf-extractor.py <pdf_path> <output_dir> [class_number] [subject] [topic]")
        sys.exit(1)
    
    pdf_path = sys.argv[1]
    output_dir = sys.argv[2]
    class_number = sys.argv[3] if len(sys.argv) > 3 else '9'
    subject = sys.argv[4] if len(sys.argv) > 4 else 'general'
    topic = sys.argv[5] if len(sys.argv) > 5 else 'default'
    
    if not os.path.exists(pdf_path):
        print(f"ERROR: PDF file not found: {pdf_path}")
        sys.exit(1)
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"📄 Extracting content from: {pdf_path}")
    
    # Extract text
    text = extract_text_from_pdf(pdf_path)
    
    if not text or len(text.strip()) < 100:
        print("WARNING: Very little text extracted from PDF. The PDF might be image-based or corrupted.")
    
    # Extract questions
    questions = extract_questions_from_text(text)
    print(f"✅ Extracted {len(questions)} questions")
    
    # Extract content sections
    sections = extract_content_sections(text)
    print(f"✅ Extracted {len(sections)} content sections")
    
    # Save questions to CSV
    csv_path = os.path.join(output_dir, f"{topic}.csv")
    save_to_csv(questions, csv_path)
    print(f"✅ Saved questions to: {csv_path}")
    
    # Save metadata
    metadata = {
        'pdf_path': pdf_path,
        'class_number': class_number,
        'subject': subject,
        'topic': topic,
        'questions_count': len(questions),
        'sections_count': len(sections),
        'text_length': len(text),
        'extracted_at': str(Path(pdf_path).stat().st_mtime)
    }
    
    metadata_path = os.path.join(output_dir, f"{topic}_metadata.json")
    save_metadata(metadata, metadata_path)
    
    # Save full text for reference
    text_path = os.path.join(output_dir, f"{topic}_fulltext.txt")
    with open(text_path, 'w', encoding='utf-8') as f:
        f.write(text)
    
    # Output summary as JSON for Node.js to parse
    result = {
        'success': True,
        'csv_path': csv_path,
        'metadata_path': metadata_path,
        'text_path': text_path,
        'questions_count': len(questions),
        'sections_count': len(sections),
        'metadata': metadata
    }
    
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()

