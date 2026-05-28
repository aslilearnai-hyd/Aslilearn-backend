// Formatter for hardcoded content - Converts JSON/CSV to Markdown format

/**
 * Format Concept Mastery Helper content with beautiful card-based design
 * Uses special HTML markers that will be rendered directly
 */
function formatConceptMasteryHelper(data) {
  let markdown = `# 📚 Concept Mastery Helper\n\n`;
  
  if (data.concepts && Array.isArray(data.concepts)) {
    data.concepts.forEach((concept, index) => {
      // Create a beautiful card for each concept
      markdown += `__CONCEPT_CARD_START__\n`;
      
      // Main card container
      markdown += `<div class="concept-card-gradient" style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-radius: 12px; padding: 28px; margin: 24px 0; box-shadow: 0 10px 25px rgba(59, 130, 246, 0.2); position: relative; overflow: hidden; border: 2px solid #bae6fd;">\n`;
      
      // Decorative top border
      markdown += `<div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);"></div>\n`;
      
      // Concept name header
      markdown += `<div style="margin-bottom: 24px; margin-top: 8px;">\n`;
      markdown += `<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">\n`;
      markdown += `<div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); width: 56px; height: 56px; border-radius: 12px; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);">\n`;
      markdown += `<span style="font-size: 1.5rem;">📚</span>\n`;
      markdown += `</div>\n`;
      markdown += `<div>\n`;
      // Escape HTML in concept name
      const escapedConceptName = concept.concept_name
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      markdown += `<h2 style="color: #1f2937; margin: 0; font-size: 1.5rem; font-weight: 700;">${escapedConceptName}</h2>\n`;
      if (concept.difficulty) {
        const diffColors = {
          easy: { bg: '#10b981', text: 'white' },
          medium: { bg: '#f59e0b', text: 'white' },
          hard: { bg: '#ef4444', text: 'white' }
        };
        const color = diffColors[concept.difficulty.toLowerCase()] || { bg: '#6b7280', text: 'white' };
        markdown += `<span style="display: inline-block; background: ${color.bg}; color: ${color.text}; padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-top: 8px;">${concept.difficulty.toUpperCase()}</span>\n`;
      }
      markdown += `</div>\n`;
      markdown += `</div>\n`;
      markdown += `</div>\n`;
      
      if (concept.lesson) {
        markdown += `<div style="background: white; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 5px solid #3b82f6; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">\n`;
        markdown += `<div style="display: flex; align-items: center; margin-bottom: 12px;">\n`;
        markdown += `<div style="background: linear-gradient(135deg, #3b82f6, #2563eb); width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);">\n`;
        markdown += `<span style="font-size: 1.2rem;">💡</span>\n`;
        markdown += `</div>\n`;
        markdown += `<h3 style="color: #3b82f6; margin: 0; font-size: 1.15rem; font-weight: 600;">Lesson Explanation</h3>\n`;
        markdown += `</div>\n`;
        // Escape HTML in lesson but preserve line breaks
        const escapedLesson = concept.lesson
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        markdown += `<p style="margin: 0; line-height: 1.8; color: #374151; font-size: 0.95rem;">${escapedLesson}</p>\n`;
        markdown += `</div>\n`;
      }
      
      if (concept.real_example) {
        markdown += `<div style="background: white; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 5px solid #8b5cf6; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">\n`;
        markdown += `<div style="display: flex; align-items: center; margin-bottom: 12px;">\n`;
        markdown += `<div style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; box-shadow: 0 4px 8px rgba(139, 92, 246, 0.3);">\n`;
        markdown += `<span style="font-size: 1.2rem;">🎯</span>\n`;
        markdown += `</div>\n`;
        markdown += `<h3 style="color: #8b5cf6; margin: 0; font-size: 1.15rem; font-weight: 600;">Real-world Example</h3>\n`;
        markdown += `</div>\n`;
        // Escape HTML in real example but preserve line breaks
        const escapedExample = concept.real_example
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        markdown += `<p style="margin: 0; line-height: 1.8; color: #374151; font-size: 0.95rem;">${escapedExample}</p>\n`;
        markdown += `</div>\n`;
      }
      
      if (concept.key_points && Array.isArray(concept.key_points)) {
        markdown += `<div style="background: white; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 5px solid #10b981; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">\n`;
        markdown += `<div style="display: flex; align-items: center; margin-bottom: 12px;">\n`;
        markdown += `<div style="background: linear-gradient(135deg, #10b981, #059669); width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);">\n`;
        markdown += `<span style="font-size: 1.2rem;">🎯</span>\n`;
        markdown += `</div>\n`;
        markdown += `<h3 style="color: #10b981; margin: 0; font-size: 1.15rem; font-weight: 600;">Key Points</h3>\n`;
        markdown += `</div>\n`;
        markdown += `<ul style="margin: 0; padding-left: 0; list-style: none;">\n`;
        concept.key_points.forEach((point, pointIndex) => {
          markdown += `<li style="margin: 10px 0; padding: 12px; background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%); border-radius: 8px; border-left: 3px solid #10b981; display: flex; align-items: flex-start;">\n`;
          markdown += `<span style="background: #10b981; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; margin-right: 12px; flex-shrink: 0; margin-top: 2px;">${pointIndex + 1}</span>\n`;
          // Escape HTML in key point
          const escapedPoint = point
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          markdown += `<span style="line-height: 1.7; color: #374151; font-size: 0.95rem; flex: 1;">${escapedPoint}</span>\n`;
          markdown += `</li>\n`;
        });
        markdown += `</ul>\n`;
        markdown += `</div>\n`;
      }
      
      markdown += `</div>\n`;
      markdown += `__CONCEPT_CARD_END__\n\n`;
    });
  }
  
  return markdown;
}

/**
 * Format Flashcard Generator content
 * Creates one card per question/note/fact with type markers for frontend filtering
 */
function formatFlashcardGenerator(data) {
  let markdown = `# Flashcard Generator\n\n`;
  
  if (data.flashcards || data.concepts || data.questions) {
    // Support two shapes:
    // 1) { flashcards: { questions: [], important_notes: [], facts: [] } }
    // 2) { flashcards: [ { question, correct_answer, ... } ], notes: [ ... ] }
    let questions = [];
    let importantNotes = [];
    let facts = [];

    if (Array.isArray(data.flashcards)) {
      // Shape (2): flat array of flashcard question objects
      questions = data.flashcards;
    } else if (data.flashcards) {
      // Shape (1): grouped by type
      questions = data.flashcards.questions || [];
      importantNotes = data.flashcards.important_notes || [];
      facts = data.flashcards.facts || [];
    }

    // CMH-style JSON: turn each concept into a flashcard
    if ((!questions || questions.length === 0) && Array.isArray(data.concepts)) {
      questions = data.concepts.map(concept => ({
        question: concept.concept_name || 'Concept',
        correct_answer: concept.lesson || (concept.key_points || []).join('\n'),
        explanation: concept.real_example || undefined,
      }));
    }

    // Generic MCQ JSON used in some _fcm.json files (e.g. Class 10 Social):
    // { content_type: 'MCQs', questions: [...] }
    if ((!questions || questions.length === 0) && Array.isArray(data.questions)) {
      questions = data.questions;
    }

    // Also treat top-level `notes` array (if present) as important notes
    if (Array.isArray(data.notes) && data.notes.length > 0) {
      importantNotes = importantNotes.concat(data.notes);
    }
    
    // Format all questions as individual cards with type marker
    if (questions.length > 0) {
      questions.forEach((q, index) => {
        const cardNumber = index + 1;
        
        markdown += `## Flashcard ${cardNumber}\n\n`;
        markdown += `**Type:** question\n\n`;
        markdown += `### Front:\n\n`;
        markdown += `${q.question}\n\n`;
        markdown += `### Back:\n\n`;
        markdown += `**Answer:**\n\n`;
        
        let answerText = q.correct_answer;
        if (q.explanation) {
          answerText += `\n\n${q.explanation}`;
        }
        markdown += `${answerText}\n\n`;
        markdown += `---\n\n`;
      });
    }
    
    // Format important notes as cards with type marker
    if (importantNotes.length > 0) {
      importantNotes.forEach((note, index) => {
        const cardNumber = questions.length + index + 1;
        
        markdown += `## Flashcard ${cardNumber}\n\n`;
        markdown += `**Type:** note\n\n`;
        markdown += `### Front:\n\n`;
        markdown += `${note.title}\n\n`;
        markdown += `### Back:\n\n`;
        markdown += `**Answer:**\n\n`;
        markdown += `${note.content}\n\n`;
        markdown += `---\n\n`;
      });
    }
    
    // Format facts as cards with type marker
    if (facts.length > 0) {
      facts.forEach((fact, index) => {
        const cardNumber = questions.length + importantNotes.length + index + 1;
        
        markdown += `## Flashcard ${cardNumber}\n\n`;
        markdown += `**Type:** fact\n\n`;
        markdown += `### Front:\n\n`;
        markdown += `Quick Fact\n\n`;
        markdown += `### Back:\n\n`;
        markdown += `**Answer:**\n\n`;
        markdown += `${fact.fact}\n\n`;
        markdown += `---\n\n`;
      });
    }
  }
  
  return markdown;
}

/**
 * Format Short Notes & Summaries content with beautiful visual card-based design
 * Uses special HTML markers that will be rendered directly
 */
function formatShortNotesSummaries(data) {
  let markdown = `# 📝 Short Notes & Summaries\n\n`;
  
  if (data.notes && Array.isArray(data.notes)) {
    data.notes.forEach((note, index) => {
      // Create a beautiful card for each note
      markdown += `__NOTE_CARD_START__\n`;
      
      // Main card container with gradient
      markdown += `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; padding: 28px; margin: 24px 0; box-shadow: 0 10px 25px rgba(102, 126, 234, 0.3); position: relative; overflow: hidden;">\n`;
      
      // Concept name header
      markdown += `<div style="background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); border-radius: 10px; padding: 12px 16px; margin-bottom: 20px;">\n`;
      markdown += `<h2 style="color: white; margin: 0; font-size: 1.3rem; font-weight: 700; text-shadow: 0 2px 4px rgba(0,0,0,0.2);">🎯 ${note.concept_name}</h2>\n`;
      markdown += `</div>\n`;
      
      if (note.summary) {
        markdown += `<div style="background: white; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 5px solid #667eea; box-shadow: 0 4px 12px rgba(0,0,0,0.1); transition: transform 0.2s;">\n`;
        markdown += `<div style="display: flex; align-items: center; margin-bottom: 12px;">\n`;
        markdown += `<div style="background: linear-gradient(135deg, #667eea, #764ba2); width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; box-shadow: 0 4px 8px rgba(102, 126, 234, 0.3);">\n`;
        markdown += `<span style="font-size: 1.2rem;">📋</span>\n`;
        markdown += `</div>\n`;
        markdown += `<h3 style="color: #667eea; margin: 0; font-size: 1.15rem; font-weight: 600;">Summary</h3>\n`;
        markdown += `</div>\n`;
        // Escape HTML in summary but preserve line breaks
        const escapedSummary = note.summary
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        markdown += `<p style="margin: 0; line-height: 1.8; color: #374151; font-size: 0.95rem;">${escapedSummary}</p>\n`;
        markdown += `</div>\n`;
      }
      
      if (note.importance) {
        markdown += `<div style="background: white; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 5px solid #f59e0b; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">\n`;
        markdown += `<div style="display: flex; align-items: center; margin-bottom: 12px;">\n`;
        markdown += `<div style="background: linear-gradient(135deg, #f59e0b, #f97316); width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; box-shadow: 0 4px 8px rgba(245, 158, 11, 0.3);">\n`;
        markdown += `<span style="font-size: 1.2rem;">⭐</span>\n`;
        markdown += `</div>\n`;
        markdown += `<h3 style="color: #f59e0b; margin: 0; font-size: 1.15rem; font-weight: 600;">Importance</h3>\n`;
        markdown += `</div>\n`;
        // Escape HTML in importance but preserve line breaks
        const escapedImportance = note.importance
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/\n/g, '<br>');
        markdown += `<p style="margin: 0; line-height: 1.8; color: #374151; font-size: 0.95rem;">${escapedImportance}</p>\n`;
        markdown += `</div>\n`;
      }
      
      if (note.quick_facts && Array.isArray(note.quick_facts)) {
        markdown += `<div style="background: white; border-radius: 12px; padding: 20px; margin: 16px 0; border-left: 5px solid #10b981; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">\n`;
        markdown += `<div style="display: flex; align-items: center; margin-bottom: 12px;">\n`;
        markdown += `<div style="background: linear-gradient(135deg, #10b981, #059669); width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 12px; box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);">\n`;
        markdown += `<span style="font-size: 1.2rem;">⚡</span>\n`;
        markdown += `</div>\n`;
        markdown += `<h3 style="color: #10b981; margin: 0; font-size: 1.15rem; font-weight: 600;">Quick Facts</h3>\n`;
        markdown += `</div>\n`;
        markdown += `<ul style="margin: 0; padding-left: 0; list-style: none;">\n`;
        note.quick_facts.forEach((fact, factIndex) => {
          markdown += `<li style="margin: 10px 0; padding: 12px; background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%); border-radius: 8px; border-left: 3px solid #10b981; display: flex; align-items: flex-start;">\n`;
          markdown += `<span style="background: #10b981; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; margin-right: 12px; flex-shrink: 0; margin-top: 2px;">${factIndex + 1}</span>\n`;
          // Escape HTML in fact content
          const escapedFact = fact
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          markdown += `<span style="line-height: 1.7; color: #374151; font-size: 0.95rem; flex: 1;">${escapedFact}</span>\n`;
          markdown += `</li>\n`;
        });
        markdown += `</ul>\n`;
        markdown += `</div>\n`;
      }
      
      markdown += `</div>\n`;
      markdown += `__NOTE_CARD_END__\n\n`;
    });
  }
  
  return markdown;
}

/**
 * Format Lesson Planner content with beautiful HTML cards
 * Uses special HTML markers that will be rendered directly
 */
function formatLessonPlanner(data, metadata) {
  let markdown = `# 📚 Lesson Planner\n\n`;
  
  // Filter lessons by topic if provided
  let lessons = [];
  if (data.lessons && Array.isArray(data.lessons)) {
    lessons = data.lessons;
  } else if (data.lesson_plans && Array.isArray(data.lesson_plans)) {
    // Social Science format uses lesson_plans
    lessons = data.lesson_plans;
  } else if (data.lesson_plan && Array.isArray(data.lesson_plan)) {
    // New JSON structure for Class 7–10 per‑chapter lesson planner:
    // has root fields like class, subject, chapter_name, total_periods, period_duration_minutes
    // and an array "lesson_plan" of period objects.
    const baseTitle = data.chapter_name || metadata.topic || 'Lesson';
    const durationMinutes =
      typeof data.period_duration_minutes === 'string'
        ? parseInt(String(data.period_duration_minutes).split('-')[0], 10) || 40
        : data.period_duration_minutes || 40;

    lessons = data.lesson_plan.map((period) => ({
      lesson_name: period.title || `${baseTitle} - Period ${period.period || ''}`,
      subject_area: data.subject || undefined,
      duration: {
        periods: 1,
        minutes_per_period: durationMinutes
      }
    }));
  }
  
  // If topic is provided, try to filter lessons by matching topic name
  // Topic is optional - if not provided, show all lessons
  if (metadata.topic && lessons.length > 0) {
    const topicLower = metadata.topic.toLowerCase().trim();
    const filtered = lessons.filter(lesson => {
      const lessonName = (lesson.lesson_name || '').toLowerCase();
      // Check for exact match, contains match, or partial match
      return lessonName === topicLower || 
             lessonName.includes(topicLower) || 
             topicLower.includes(lessonName) ||
             (lesson.subject_area && lesson.subject_area.toLowerCase().includes(topicLower));
    });
    // Only use filtered if we found matches, otherwise show all lessons
    if (filtered.length > 0) {
      lessons = filtered;
    }
    // If no matches found but topic was provided, still show all (user might want to see all and pick)
  }
  
  if (lessons.length > 0) {
    lessons.forEach((lesson, index) => {
      // Create a beautiful card for each lesson
      markdown += `__LESSON_CARD_START__\n`;
      
      // Main card container with neon styling
      markdown += `<div class="lesson-card-neon" style="background: linear-gradient(135deg, rgba(15, 12, 41, 0.95), rgba(48, 43, 99, 0.95)); border-radius: 16px; padding: 24px; margin: 20px 0; border: 2px solid rgba(0, 245, 255, 0.3); box-shadow: 0 0 30px rgba(0, 245, 255, 0.2), inset 0 0 20px rgba(255, 0, 255, 0.1);">\n`;
      
      // Lesson name header
      const escapedLessonName = (lesson.lesson_name || 'Untitled Lesson')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      markdown += `<h3 style="color: #00f5ff; font-size: 1.5rem; font-weight: 700; margin: 0 0 16px 0; text-shadow: 0 0 20px rgba(0, 245, 255, 0.6);">${escapedLessonName}</h3>\n`;
      
      if (lesson.subject_area) {
        const escapedArea = lesson.subject_area
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        markdown += `<span style="display: inline-block; background: linear-gradient(90deg, #00f5ff, #ff00ff); color: white; padding: 4px 12px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-bottom: 12px;">${escapedArea}</span>\n`;
      }
      
      if (lesson.duration) {
        markdown += `<p style="color: rgba(255, 255, 255, 0.8); margin: 8px 0;"><strong>Duration:</strong> ${lesson.duration.periods || 1} periods × ${lesson.duration.minutes_per_period || 40} minutes each</p>\n`;
      }
      
      markdown += `</div>\n`;
      markdown += `__LESSON_CARD_END__\n\n`;
    });
  }
  
  return markdown;
}

/**
 * Format Daily Class Plan Maker content
 * Uses planner.json data to create a daily schedule
 */
function formatDailyClassPlan(data, metadata) {
  let markdown = `# 📅 Daily Class Plan\n\n`;
  
  // Add date and class info
  if (metadata.date) {
    markdown += `**Date:** ${metadata.date}\n\n`;
  }
  if (metadata.classNumber) {
    markdown += `**Class:** ${metadata.classNumber}\n\n`;
  }
  if (metadata.subject) {
    markdown += `**Subject:** ${metadata.subject}\n\n`;
  }
  if (metadata.timeSlots) {
    markdown += `**Time Slots:** ${metadata.timeSlots}\n\n`;
  }
  
  // Get lessons from planner.json
  let lessons = [];
  if (data.lessons && Array.isArray(data.lessons)) {
    lessons = data.lessons;
  } else if (data.lesson_plans && Array.isArray(data.lesson_plans)) {
    lessons = data.lesson_plans;
  }
  
  // Filter by subject if provided
  if (metadata.subject && lessons.length > 0) {
    const subjectLower = metadata.subject.toLowerCase();
    lessons = lessons.filter(lesson => {
      // Match by subject area or lesson name
      const subjectArea = (lesson.subject_area || '').toLowerCase();
      return subjectArea.includes(subjectLower) || subjectLower.includes(subjectArea);
    });
  }
  
  if (lessons.length > 0) {
    markdown += `## Daily Schedule\n\n`;
    
    // Group lessons by time slots if provided
    const timeSlots = metadata.timeSlots ? metadata.timeSlots.split(',').map(s => s.trim()) : [];
    
    lessons.forEach((lesson, index) => {
      const timeSlot = timeSlots[index] || `Period ${index + 1}`;
      
      markdown += `### ${timeSlot}\n\n`;
      markdown += `**Lesson:** ${lesson.lesson_name || 'Untitled'}\n\n`;
      
      if (lesson.subject_area) {
        markdown += `**Subject Area:** ${lesson.subject_area}\n\n`;
      }
      
      if (lesson.duration) {
        markdown += `**Duration:** ${lesson.duration.periods || 1} periods × ${lesson.duration.minutes_per_period || 40} minutes\n\n`;
      }
      
      if (lesson.learning_objectives && lesson.learning_objectives.length > 0) {
        markdown += `**Learning Objectives:**\n`;
        lesson.learning_objectives.forEach(obj => {
          markdown += `- ${obj}\n`;
        });
        markdown += `\n`;
      }
      
      if (lesson.activities && lesson.activities.class_activities) {
        markdown += `**Activities:**\n`;
        lesson.activities.class_activities.forEach(activity => {
          markdown += `- ${activity}\n`;
        });
        markdown += `\n`;
      }
      
      markdown += `---\n\n`;
    });
  } else {
    markdown += `No lessons found for the selected criteria.\n`;
  }
  
  return markdown;
}

/**
 * Format CSV data (MCQ, Fill in blanks, etc.)
 */
function formatCSVContent(csvData, toolType, metadata) {
  let markdown = `## ${getToolTitle(toolType)}\n\n`;
  markdown += `**Class:** ${metadata.classNumber}\n`;
  markdown += `**Subject:** ${metadata.subject}\n`;
  markdown += `**Topic:** ${metadata.topic}\n`;
  if (metadata.difficulty) {
    markdown += `**Difficulty:** ${metadata.difficulty}\n`;
  }
  markdown += `\n`;
  
  if (!csvData || !csvData.data || csvData.data.length === 0) {
    return markdown + `No questions available.\n`;
  }
  
  // Format based on CSV structure
  const headers = csvData.headers || [];
  const rows = csvData.data || [];
  
  // MCQ format
  if (headers.includes('Question') && headers.includes('Option A')) {
    markdown += `### Multiple Choice Questions\n\n`;
    rows.forEach((row, index) => {
      markdown += `**Question ${index + 1}:** ${row.Question || ''}\n\n`;
      if (row['Option A']) markdown += `A. ${row['Option A']}\n`;
      if (row['Option B']) markdown += `B. ${row['Option B']}\n`;
      if (row['Option C']) markdown += `C. ${row['Option C']}\n`;
      if (row['Option D']) markdown += `D. ${row['Option D']}\n`;
      if (row['Correct Answer']) {
        markdown += `\n**Correct Answer:** ${row['Correct Answer']}\n`;
      }
      markdown += `\n---\n\n`;
    });
  }
  // Match the following format
  else if (headers.includes('Column A') && headers.includes('Column B / Correct Match')) {
    markdown += `### Match the Following\n\n`;
    rows.forEach((row, index) => {
      if (row['Column A'] && row['Column B / Correct Match']) {
        markdown += `**${index + 1}.** ${row['Column A']} → ${row['Column B / Correct Match']}\n\n`;
      }
    });
  }
  // Fill in the blanks, Short answer, Long answer, True or False format
  else if (headers.includes('Question') && headers.includes('Answer')) {
    const questionType = toolType.includes('fill') ? 'Fill in the Blanks' :
                         toolType.includes('short') ? 'Short Answer Questions' :
                         toolType.includes('long') ? 'Long Answer Questions' :
                         toolType.includes('true') ? 'True or False' : 'Questions';
    
    markdown += `### ${questionType}\n\n`;
    rows.forEach((row, index) => {
      markdown += `**Question ${index + 1}:** ${row.Question || ''}\n\n`;
      markdown += `**Answer:** ${row.Answer || ''}\n\n`;
      markdown += `---\n\n`;
    });
  }
  // Generic format
  else {
    markdown += `### Questions\n\n`;
    rows.forEach((row, index) => {
      markdown += `**${index + 1}.** `;
      Object.keys(row).forEach(key => {
        if (row[key] && key !== 'Type') {
          markdown += `${key}: ${row[key]} `;
        }
      });
      markdown += `\n\n`;
    });
  }
  
  return markdown;
}

/**
 * Format Projects/Activities CSV
 */
function formatProjectsCSV(csvData, metadata) {
  let markdown = `## Activity & Project Generator\n\n`;
  markdown += `**Class:** ${metadata.classNumber}\n`;
  markdown += `**Subject:** ${metadata.subject}\n\n`;
  
  if (!csvData || !csvData.data || csvData.data.length === 0) {
    return markdown + `No projects available.\n`;
  }
  
  csvData.data.forEach((project, index) => {
    markdown += `### Project ${index + 1}\n\n`;
    Object.keys(project).forEach(key => {
      if (project[key]) {
        markdown += `**${key}:** ${project[key]}\n\n`;
      }
    });
    markdown += `---\n\n`;
  });
  
  return markdown;
}

/**
 * Format Passages CSV content
 */
function formatPassagesCSV(csvData, metadata) {
  let markdown = `## Story & Passage Creator\n\n`;
  markdown += `**Class:** ${metadata.classNumber}\n`;
  markdown += `**Subject:** ${metadata.subject}\n\n`;
  
  if (!csvData || !csvData.data || csvData.data.length === 0) {
    return markdown + `No passages available.\n`;
  }
  
  csvData.data.forEach((passage, index) => {
    markdown += `### Passage ${index + 1}\n\n`;
    Object.keys(passage).forEach(key => {
      if (passage[key]) {
        // Format key names nicely
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        markdown += `**${formattedKey}:** ${passage[key]}\n\n`;
      }
    });
    markdown += `---\n\n`;
  });
  
  return markdown;
}

/**
 * Get tool title from tool type
 */
function getToolTitle(toolType) {
  const titles = {
    'concept-mastery-helper': 'Concept Mastery Helper',
    'my-study-decks': 'My Study Decks',
    'flashcard-generator': 'Flash Card Generator',
    'short-notes-summaries-maker': 'Short Notes & Summaries',
    'lesson-planner': 'Lesson Planner',
    'study-schedule-maker': 'Study Schedule Maker',
    'worksheet-mcq-generator': 'Worksheet & MCQ Generator',
    'mock-test-builder': 'Mock Test Builder',
    'exam-question-paper-generator': 'Exam Question Paper Generator',
    'activity-project-generator': 'Activity / Project Generator',
    'project-idea-lab': 'Project Idea Lab',
    'reading-practice-room': 'Reading Practice Room',
    'story-passage-creator': 'Story & Passage Creator',
    'smart-study-guide-generator': 'Smart Study Guide Generator',
    'concept-breakdown-explainer': 'Concept Breakdown Explainer',
    'smart-qa-practice-generator': 'Smart Q&A Practice Generator',
    'chapter-summary-creator': 'Chapter Summary Creator',
    'key-points-formula-extractor': 'Key Points Extractor',
    'quick-assignment-builder': 'Quick Assignment Builder',
  };
  return titles[toolType] || 'Content';
}

/**
 * Main formatter function
 */
export function formatHardcodedContent(data, toolType, metadata = {}) {
  try {
    // Special handling for exam-question-paper-generator
    if ((toolType === 'mock-test-builder' || toolType === 'exam-question-paper-generator') && (data.content_type === 'Exam Paper' || (data.sections && Array.isArray(data.sections)))) {
      return formatExamPaper(data, toolType, metadata);
    }
    
    // Special handling for worksheet-mcq-generator
    if (toolType === 'worksheet-mcq-generator' && (data.content_type === 'Worksheet' || (data.sections && Array.isArray(data.sections)))) {
      return formatWorksheet(data, toolType, metadata);
    }
    
    // Special handling for homework-creator
    if (toolType === 'homework-creator' && (data.content_type === 'Homework' || (data.sections && Array.isArray(data.sections)))) {
      return formatHomework(data, toolType, metadata);
    }
    
    // Student tools that use CSV format - format as study guides or practice questions
    const studentCSVTools = [
      'smart-study-guide-generator',
      'concept-breakdown-explainer',
      'smart-qa-practice-generator',
      'key-points-formula-extractor',
      'quick-assignment-builder'
    ];
    
    if (studentCSVTools.includes(toolType) && data.headers && data.data) {
      return formatStudentCSVContent(data, toolType, metadata);
    }
    
    // Student tools that use planner.json
    if (toolType === 'personalized-revision-planner' && (data.class || data.lessons || data.lesson_plans)) {
      return formatRevisionPlanner(data, metadata);
    }
    
    // Flashcard Generator should always try to produce flashcards, even if
    // the underlying JSON was authored for Concept Mastery Helper (CMH).
    // This allows us to reuse CMH content as Q&A cards.
    if (toolType === 'my-study-decks' || toolType === 'flashcard-generator') {
      return formatFlashcardGenerator(data);
    }

    // Chapter summary creator can use AMENITY short notes or planner.json
    if (toolType === 'chapter-summary-creator') {
      if (data.content_type === 'Short Notes & Summaries') {
        // Use short notes formatter for AMENITY content
        return formatShortNotesSummaries(data);
      } else if (data.class || data.lessons || data.lesson_plans) {
        // Use planner.json format
        return formatChapterSummary(data, metadata);
      }
    }
    
    // Check if data is JSON (object) or CSV (has headers/data structure)
    if (data.content_type) {
      // JSON format
      switch (data.content_type) {
        case 'Concept Mastery Helper':
          return formatConceptMasteryHelper(data);
        case 'Flashcard Maker':
        case 'Flashcards':
          return formatFlashcardGenerator(data);
        case 'Short Notes & Summaries':
          return formatShortNotesSummaries(data);
        case 'Exam Paper':
          return formatExamPaper(data, toolType, metadata);
        case 'Worksheet':
          return formatWorksheet(data, toolType, metadata);
        case 'Homework':
          return formatHomework(data, toolType, metadata);
      case 'Story & Passage Creator':
        // When hardcoded JSON already has passages array, wrap it into the
        // structure expected by StoryPassageViewer (PassagesData) and return
        // it as a JSON string so the frontend can render beautiful cards.
        if (Array.isArray(data.passages) && data.passages.length > 0) {
          const payload = {
            subject: data.subject || metadata.subject,
            book: data.book || data.textbook || undefined,
            chapter: data.chapter || metadata.topic || undefined,
            title: data.title || 'Reading Passages',
            total_passages: data.total_passages || data.passages.length,
            instructions:
              data.instructions ||
              data.note ||
              'Read each passage carefully and answer the questions that follow.',
            passages: data.passages.map((p, idx) => ({
              passage_number: p.passage_number || p.id || idx + 1,
              paragraph: p.paragraph || p.passage || p.text || '',
              questions:
                (Array.isArray(p.questions) && p.questions.length > 0)
                  ? p.questions
                  : p.question
                  ? [p.question]
                  : [],
            })),
          };
          return JSON.stringify(payload);
        }
        // Fallback to generic JSON formatting when shape is unknown
        return formatGenericJSON(data, toolType, metadata);
        case 'MCQs':
          // Single MCQ JSON from Class 7-10 → wrap into worksheet format for display
          if (data.questions && Array.isArray(data.questions)) {
            const worksheetData = {
              content_type: 'Worksheet',
              sections: [{
                type: 'Multiple Choice Questions',
                questions: data.questions.map((q, i) => ({ ...q, question_number: i + 1, question_type: 'Multiple Choice Questions' })),
                count: data.questions.length,
              }],
              total_questions: data.questions.length,
            };
            return formatWorksheet(worksheetData, toolType, metadata);
          }
          return formatGenericJSON(data, toolType, metadata);
        default:
          return formatGenericJSON(data, toolType, metadata);
      }
    } else if (data.short_notes) {
      // Nested SNS format: { short_notes: { key_points: [], examples: [], ... } }
      const adaptedData = {
        notes: [{
          concept_name: data.chapter || metadata.topic || 'Summary',
          summary: (data.short_notes.key_points || []).join('\n\n'),
          importance: (data.short_notes.exam_tips || []).join('\n\n'),
          quick_facts: [
            ...(data.short_notes.examples || []),
            ...(data.short_notes.formulas || []),
          ],
        }],
      };
      return formatShortNotesSummaries(adaptedData);
    } else if (data.key_points && Array.isArray(data.key_points)) {
      // Root-level SNS format (e.g. easy_sns.json): key_points, examples, formulas, exam_tips at root
      const adaptedData = {
        notes: [{
          concept_name: data.chapter || data.subject || metadata.topic || 'Summary',
          summary: (data.key_points || []).join('\n\n'),
          importance: (data.exam_tips || []).join('\n\n'),
          quick_facts: [
            ...(data.examples || []),
            ...(data.formulas || []),
          ],
        }],
      };
      return formatShortNotesSummaries(adaptedData);
    } else if (data.concepts && Array.isArray(data.concepts)) {
      // CMH JSON from Class 7-10 (no content_type field, just concepts array)
      return formatConceptMasteryHelper(data);
    } else if (data.flashcards) {
      // Flashcard JSON from Class 7-10 (no content_type field)
      return formatFlashcardGenerator(data);
    } else if (
      (toolType === 'story-passage-creator' || toolType === 'reading-practice-room') &&
      Array.isArray(data.passages) &&
      data.passages.length > 0
    ) {
      // Story & Passage JSON without explicit content_type – treat it like
      // the exam/hardcoded format and emit a PassagesData JSON string for
      // StoryPassageViewer.
      const payload = {
        subject: data.subject || metadata.subject,
        book: data.book || data.textbook || undefined,
        chapter: data.chapter || metadata.topic || undefined,
        title: data.title || 'Reading Passages',
        total_passages: data.total_passages || data.passages.length,
        instructions:
          data.instructions ||
          data.note ||
          'Read each passage carefully and answer the questions that follow.',
        passages: data.passages.map((p, idx) => ({
          passage_number: p.passage_number || p.id || idx + 1,
          paragraph: p.paragraph || p.passage || p.text || '',
          questions:
            (Array.isArray(p.questions) && p.questions.length > 0)
              ? p.questions
              : p.question
              ? [p.question]
              : [],
        })),
      };
      return JSON.stringify(payload);
    } else if (data.notes && Array.isArray(data.notes)) {
      // SNS JSON with notes array (no content_type field)
      return formatShortNotesSummaries(data);
    } else if (data.questions && Array.isArray(data.questions)) {
      // Generic questions JSON (MCQs, SAQ, LAQ, VSAQ)
      // Wrap into worksheet format for display
      const questionType = toolType === 'short-answer' ? 'Short Answer Questions'
        : toolType === 'long-answer' ? 'Long Answer Questions'
        : toolType === 'very-short-answer' ? 'Very Short Answer Questions'
        : toolType === 'fill-in-blanks' ? 'Fill in the Blanks'
        : 'Multiple Choice Questions';
      const worksheetData = {
        content_type: 'Worksheet',
        sections: [{
          type: questionType,
          questions: data.questions.map((q, i) => ({ ...q, question_number: i + 1, question_type: questionType })),
          count: data.questions.length,
        }],
        total_questions: data.questions.length,
      };
      return formatWorksheet(worksheetData, toolType, metadata);
    } else if (
      (data.activities && Array.isArray(data.activities)) ||
      (data.activities_projects && Array.isArray(data.activities_projects)) ||
      (data.activities_and_projects && Array.isArray(data.activities_and_projects))
    ) {
      // Activity & Project Generator JSON from Class 7-10
      // Normalize different field names into a single "activities" array
      if (data.activities_projects) data.activities = data.activities_projects;
      if (data.activities_and_projects) data.activities = data.activities_and_projects;
      return formatActivitiesJSON(data, metadata);
    } else if (data.headers && data.data) {
      // CSV format
      if (toolType === 'activity-project-generator') {
        return formatProjectsCSV(data, metadata);
      } else if (toolType === 'story-passage-creator' || toolType === 'reading-practice-room') {
        return formatPassagesCSV(data, metadata);
      } else {
        return formatCSVContent(data, toolType, metadata);
      }
    } else if (data.class || data.lessons || data.lesson_plans) {
      // Lesson planner or daily class plan maker JSON (both use planner.json)
      if (toolType === 'daily-class-plan-maker') {
        return formatDailyClassPlan(data, metadata);
      }
      // Lesson planner or daily class plan maker JSON (both use planner.json)
      if (toolType === 'daily-class-plan-maker') {
        return formatDailyClassPlan(data, metadata);
      }
      return formatLessonPlanner(data, metadata);
    } else {
      // Generic JSON
      return formatGenericJSON(data, toolType, metadata);
    }
  } catch (error) {
    console.error('Error formatting hardcoded content:', error);
    return `## ${getToolTitle(toolType)}\n\nError formatting content. Please try again.\n`;
  }
}

/**
 * Format exam question paper (all question types with professional formatting)
 */
function formatExamPaper(data, toolType, metadata) {
  let markdown = `# 📋 Examination Question Paper\n\n`;
  
  // Professional exam header
  markdown += `<div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); border-radius: 12px; padding: 28px; margin-bottom: 32px; color: white; box-shadow: 0 10px 20px rgba(30, 58, 138, 0.3); text-align: center;">\n`;
  markdown += `<h1 style="color: white; margin: 0 0 20px 0; font-size: 2rem; font-weight: 800; text-shadow: 2px 2px 4px rgba(0,0,0,0.2);">EXAMINATION QUESTION PAPER</h1>\n`;
  markdown += `<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 30px; margin-top: 20px; font-size: 1.1rem;">\n`;
  
  if (metadata.classNumber) {
    markdown += `<div><strong>Class:</strong> ${metadata.classNumber}</div>\n`;
  }
  if (metadata.subject) {
    markdown += `<div><strong>Subject:</strong> ${metadata.subject}</div>\n`;
  }
  if (metadata.topic) {
    markdown += `<div><strong>Topic:</strong> ${metadata.topic}</div>\n`;
  }
  if (data.total_marks) {
    markdown += `<div><strong>Total Marks:</strong> ${data.total_marks}</div>\n`;
  }
  if (data.estimated_time) {
    markdown += `<div><strong>Duration:</strong> ${data.estimated_time} minutes</div>\n`;
  }
  if (metadata.duration) {
    markdown += `<div><strong>Allotted Time:</strong> ${metadata.duration} minutes</div>\n`;
  }
  if (metadata.questionCount) {
    markdown += `<div><strong>Total Questions:</strong> ${metadata.questionCount}</div>\n`;
  }
  
  markdown += `</div>\n`;
  markdown += `</div>\n\n`;

  // Instructions section
  markdown += `<div style="background: #fef3c7; border-left: 5px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 24px 0;">\n`;
  markdown += `<h3 style="color: #d97706; margin: 0 0 12px 0; font-size: 1.2rem; display: flex; align-items: center; gap: 8px;"><span>📌</span> General Instructions</h3>\n`;
  markdown += `<ul style="margin: 0; padding-left: 24px; color: #92400e; line-height: 1.8;">\n`;
  markdown += `<li>All questions are compulsory.</li>\n`;
  markdown += `<li>Read each question carefully before answering.</li>\n`;
  markdown += `<li>Marks are indicated against each question.</li>\n`;
  markdown += `<li>Write your answers clearly and legibly.</li>\n`;
  markdown += `</ul>\n`;
  markdown += `</div>\n\n`;

  if (!data.sections || data.sections.length === 0) {
    return markdown + `<div style="text-align: center; padding: 40px; color: #6b7280;">No questions available.</div>\n`;
  }

  // Format each section with professional exam styling
  data.sections.forEach((section, sectionIndex) => {
    // Section header with marks and time
    const sectionColors = [
      { bg: 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)', border: '#1e3a8a', icon: '🔘' },
      { bg: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)', border: '#6d28d9', icon: '✏️' },
      { bg: 'linear-gradient(135deg, #059669 0%, #10b981 100%)', border: '#047857', icon: '📝' },
      { bg: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)', border: '#b91c1c', icon: '📄' },
      { bg: 'linear-gradient(135deg, #ea580c 0%, #f97316 100%)', border: '#c2410c', icon: '📚' }
    ];
    
    const colors = sectionColors[sectionIndex % sectionColors.length];
    
    markdown += `<div style="background: ${colors.bg}; border-radius: 12px; padding: 24px; margin: 28px 0; box-shadow: 0 8px 16px rgba(0,0,0,0.2); border-left: 6px solid ${colors.border};">\n`;
    markdown += `<div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 20px;">\n`;
    markdown += `<h2 style="color: white; margin: 0; font-size: 1.6rem; font-weight: 700; display: flex; align-items: center; gap: 12px;">\n`;
    markdown += `<span style="font-size: 2rem;">${colors.icon}</span>\n`;
    markdown += `<span>Section ${String.fromCharCode(65 + sectionIndex)}: ${section.type}</span>\n`;
    markdown += `</h2>\n`;
    markdown += `<div style="display: flex; gap: 20px; color: white; font-weight: 600;">\n`;
    markdown += `<div style="background: rgba(255,255,255,0.2); padding: 8px 16px; border-radius: 8px;">Questions: ${section.count}</div>\n`;
    markdown += `<div style="background: rgba(255,255,255,0.2); padding: 8px 16px; border-radius: 8px;">Marks: ${section.total_marks}</div>\n`;
    markdown += `<div style="background: rgba(255,255,255,0.2); padding: 8px 16px; border-radius: 8px;">Time: ${section.estimated_time} min</div>\n`;
    markdown += `</div>\n`;
    markdown += `</div>\n`;
    
    if (section.questions && Array.isArray(section.questions)) {
      section.questions.forEach((q, qIndex) => {
        const qNum = q.question_number || (qIndex + 1);
        
        // Question card with marks badge
        markdown += `<div style="background: #ffffff; border-radius: 10px; padding: 24px; margin: 20px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-left: 5px solid ${colors.border};">\n`;
        
        // Question header with number and marks
        markdown += `<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">\n`;
        markdown += `<div style="display: flex; align-items: center; gap: 12px;">\n`;
        markdown += `<div style="background: ${colors.border}; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1rem; flex-shrink: 0;">${qNum}</div>\n`;
        markdown += `<div style="font-size: 1.1rem; font-weight: 700; color: #1f2937; flex: 1;">${q.question || ''}</div>\n`;
        markdown += `</div>\n`;
        markdown += `<div style="background: #fef3c7; color: #d97706; padding: 6px 14px; border-radius: 20px; font-weight: 700; font-size: 0.9rem; white-space: nowrap;">[${q.marks || 1} Marks]</div>\n`;
        markdown += `</div>\n`;
        
        // Format question based on type
        if (section.type === 'Multiple Choice Questions') {
          // Options with nice styling
          if (q.options) {
            markdown += `<div style="margin-left: 52px; margin-top: 16px;">\n`;
            const optionColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
            const optionLabels = ['A', 'B', 'C', 'D'];
            let optionIndex = 0;
            
            if (q.options.A) {
              markdown += `<div style="display: flex; align-items: center; gap: 12px; padding: 12px; margin: 10px 0; background: #f9fafb; border-radius: 10px; border-left: 4px solid ${optionColors[optionIndex % 4]}; transition: all 0.2s;">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; font-size: 1rem;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151; font-size: 1.05rem;">${q.options.A}</span>\n`;
              markdown += `</div>\n`;
              optionIndex++;
            }
            if (q.options.B) {
              markdown += `<div style="display: flex; align-items: center; gap: 12px; padding: 12px; margin: 10px 0; background: #f9fafb; border-radius: 10px; border-left: 4px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; font-size: 1rem;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151; font-size: 1.05rem;">${q.options.B}</span>\n`;
              markdown += `</div>\n`;
              optionIndex++;
            }
            if (q.options.C) {
              markdown += `<div style="display: flex; align-items: center; gap: 12px; padding: 12px; margin: 10px 0; background: #f9fafb; border-radius: 10px; border-left: 4px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; font-size: 1rem;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151; font-size: 1.05rem;">${q.options.C}</span>\n`;
              markdown += `</div>\n`;
              optionIndex++;
            }
            if (q.options.D) {
              markdown += `<div style="display: flex; align-items: center; gap: 12px; padding: 12px; margin: 10px 0; background: #f9fafb; border-radius: 10px; border-left: 4px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; font-size: 1rem;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151; font-size: 1.05rem;">${q.options.D}</span>\n`;
              markdown += `</div>\n`;
            }
            markdown += `</div>\n`;
          }
        } else {
          // For Fill in the Blanks, VSAQs, SAQs, LAQs - show answer space
          markdown += `<div style="margin-left: 52px; margin-top: 16px; padding: 16px; background: #f9fafb; border-radius: 8px; border: 2px dashed #d1d5db; min-height: 60px;">\n`;
          markdown += `<div style="color: #6b7280; font-style: italic;">Answer space for ${q.marks || 1} marks</div>\n`;
          markdown += `</div>\n`;
        }
        
        markdown += `</div>\n\n`;
      });
    }
    
    markdown += `</div>\n\n`;
  });

  // Footer with total marks and time
  markdown += `<div style="background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); border-radius: 12px; padding: 24px; margin-top: 32px; color: white; text-align: center; box-shadow: 0 8px 16px rgba(30, 58, 138, 0.3);">\n`;
  markdown += `<div style="display: flex; justify-content: center; gap: 40px; flex-wrap: wrap; font-size: 1.2rem; font-weight: 700;">\n`;
  markdown += `<div>Total Questions: <span style="font-size: 1.5rem;">${data.total_questions}</span></div>\n`;
  markdown += `<div>Total Marks: <span style="font-size: 1.5rem;">${data.total_marks}</span></div>\n`;
  if (data.estimated_time) {
    markdown += `<div>Estimated Time: <span style="font-size: 1.5rem;">${data.estimated_time} min</span></div>\n`;
  }
  markdown += `</div>\n`;
  markdown += `</div>\n`;

  return markdown;
}

/**
 * Format worksheet content (MCQs and Fill in the Blanks with beautiful formatting)
 */
function formatWorksheet(data, toolType, metadata) {
  let markdown = `# 📝 Worksheet & MCQ Generator\n\n`;
  
  // Header section with metadata
  markdown += `<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; margin-bottom: 24px; color: white; box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);">\n`;
  markdown += `<div style="display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">\n`;
  
  if (metadata.classNumber) {
    markdown += `<div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 1.2rem;">📚</span><strong>Class:</strong> ${metadata.classNumber}</div>\n`;
  }
  if (metadata.subject) {
    markdown += `<div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 1.2rem;">📖</span><strong>Subject:</strong> ${metadata.subject}</div>\n`;
  }
  if (metadata.topic) {
    markdown += `<div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 1.2rem;">📑</span><strong>Topic:</strong> ${metadata.topic}</div>\n`;
  }
  if (data.total_questions) {
    markdown += `<div style="display: flex; align-items: center; gap: 8px;"><span style="font-size: 1.2rem;">❓</span><strong>Total Questions:</strong> ${data.total_questions}</div>\n`;
  }
  
  markdown += `</div>\n`;
  markdown += `</div>\n\n`;

  if (!data.sections || data.sections.length === 0) {
    return markdown + `<div style="text-align: center; padding: 40px; color: #6b7280;">No questions available.</div>\n`;
  }

  // Format each section with beautiful styling
  data.sections.forEach((section, sectionIndex) => {
    // Section header with gradient - different colors for different question types
    const sectionColors = [
      { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', border: '#5a67d8', icon: '🔘' },
      { bg: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', border: '#e53e3e', icon: '✏️' },
      { bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: '#047857', icon: '🔗' }
    ];
    
    const colors = sectionColors[sectionIndex % sectionColors.length];
    
    markdown += `<div style="background: ${colors.bg}; border-radius: 12px; padding: 20px; margin: 24px 0; box-shadow: 0 6px 12px rgba(0,0,0,0.15); border-left: 5px solid ${colors.border};">\n`;
    markdown += `<h2 style="color: white; margin: 0 0 16px 0; font-size: 1.5rem; font-weight: 700; display: flex; align-items: center; gap: 10px;">\n`;
    markdown += `<span style="font-size: 1.8rem;">${colors.icon}</span>\n`;
    markdown += `<span>${section.type} (${section.count} questions)</span>\n`;
    markdown += `</h2>\n`;
    markdown += `</div>\n\n`;
    
    if (section.questions && Array.isArray(section.questions)) {
      section.questions.forEach((q, qIndex) => {
        const qNum = q.question_number || (qIndex + 1);
        
        // Question card with nice styling
        const borderColor = sectionIndex === 0 ? '#667eea' : (sectionIndex === 1 ? '#f5576c' : '#10b981');
        markdown += `<div style="background: #ffffff; border-radius: 10px; padding: 20px; margin: 16px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1); border-left: 4px solid ${borderColor};">\n`;
        
        // Format question based on type
        if (section.type === 'Multiple Choice Questions') {
          markdown += `<div style="margin-bottom: 16px;">\n`;
          markdown += `<div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">\n`;
          markdown += `<div style="background: ${sectionIndex === 0 ? '#667eea' : '#f5576c'}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${qNum}</div>\n`;
          markdown += `<div style="flex: 1; font-size: 1.05rem; font-weight: 600; color: #1f2937; line-height: 1.6;">${q.question || ''}</div>\n`;
          markdown += `</div>\n`;
          
          // Options with nice styling
          if (q.options) {
            markdown += `<div style="margin-left: 44px; margin-top: 12px;">\n`;
            const optionColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
            const optionLabels = ['A', 'B', 'C', 'D'];
            let optionIndex = 0;
            
            if (q.options.A) {
              markdown += `<div style="display: flex; align-items: center; gap: 10px; padding: 10px; margin: 8px 0; background: #f9fafb; border-radius: 8px; border-left: 3px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151;">${q.options.A}</span>\n`;
              markdown += `</div>\n`;
              optionIndex++;
            }
            if (q.options.B) {
              markdown += `<div style="display: flex; align-items: center; gap: 10px; padding: 10px; margin: 8px 0; background: #f9fafb; border-radius: 8px; border-left: 3px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151;">${q.options.B}</span>\n`;
              markdown += `</div>\n`;
              optionIndex++;
            }
            if (q.options.C) {
              markdown += `<div style="display: flex; align-items: center; gap: 10px; padding: 10px; margin: 8px 0; background: #f9fafb; border-radius: 8px; border-left: 3px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151;">${q.options.C}</span>\n`;
              markdown += `</div>\n`;
              optionIndex++;
            }
            if (q.options.D) {
              markdown += `<div style="display: flex; align-items: center; gap: 10px; padding: 10px; margin: 8px 0; background: #f9fafb; border-radius: 8px; border-left: 3px solid ${optionColors[optionIndex % 4]};">\n`;
              markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${optionLabels[optionIndex]}</span>\n`;
              markdown += `<span style="flex: 1; color: #374151;">${q.options.D}</span>\n`;
              markdown += `</div>\n`;
            }
            markdown += `</div>\n`;
          }
          
          // Answer (hidden or shown based on preference)
          if (q.correct_answer) {
            markdown += `<div style="margin-left: 44px; margin-top: 12px; padding: 12px; background: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;">\n`;
            markdown += `<strong style="color: #059669;">✓ Correct Answer:</strong> <span style="color: #047857; font-weight: 600;">${q.correct_answer}</span>\n`;
            markdown += `</div>\n`;
          }
          
          markdown += `</div>\n`;
        } else if (section.type === 'Fill in the Blanks') {
          markdown += `<div style="margin-bottom: 16px;">\n`;
          markdown += `<div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">\n`;
          markdown += `<div style="background: ${borderColor}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${qNum}</div>\n`;
          markdown += `<div style="flex: 1; font-size: 1.05rem; font-weight: 600; color: #1f2937; line-height: 1.6;">${q.question || ''}</div>\n`;
          markdown += `</div>\n`;
          
          // Answer
          if (q.correct_answer) {
            markdown += `<div style="margin-left: 44px; margin-top: 12px; padding: 12px; background: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;">\n`;
            markdown += `<strong style="color: #059669;">✓ Answer:</strong> <span style="color: #047857; font-weight: 600;">${q.correct_answer}</span>\n`;
            markdown += `</div>\n`;
          }
          
          markdown += `</div>\n`;
        } else if (section.type === 'Match the Following') {
          // Format Match the Following questions
          markdown += `<div style="margin-bottom: 16px;">\n`;
          markdown += `<div style="display: flex; align-items: start; gap: 12px; margin-bottom: 16px;">\n`;
          markdown += `<div style="background: ${borderColor}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;">${qNum}</div>\n`;
          markdown += `<div style="flex: 1;">\n`;
          markdown += `<div style="font-size: 1.05rem; font-weight: 600; color: #1f2937; margin-bottom: 12px;">${q.question || 'Match the following:'}</div>\n`;
          
          // Match item display - side by side
          markdown += `<div style="display: flex; align-items: center; gap: 16px; margin-top: 12px; padding: 12px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">\n`;
          
          // Column A item
          markdown += `<div style="flex: 1; padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #667eea;">\n`;
          markdown += `<div style="font-weight: 600; color: #667eea; font-size: 0.85rem; margin-bottom: 4px;">Column A</div>\n`;
          if (q.column_a) {
            markdown += `<div style="color: #374151; font-size: 1rem; line-height: 1.5;">${q.column_a}</div>\n`;
          }
          markdown += `</div>\n`;
          
          // Arrow
          markdown += `<div style="font-size: 1.5rem; color: #9ca3af; font-weight: bold;">→</div>\n`;
          
          // Column B item
          markdown += `<div style="flex: 1; padding: 12px; background: white; border-radius: 6px; border-left: 4px solid #f5576c;">\n`;
          markdown += `<div style="font-weight: 600; color: #f5576c; font-size: 0.85rem; margin-bottom: 4px;">Column B</div>\n`;
          if (q.column_b) {
            markdown += `<div style="color: #374151; font-size: 1rem; line-height: 1.5;">${q.column_b}</div>\n`;
          }
          markdown += `</div>\n`;
          
          markdown += `</div>\n`; // End match item container
          markdown += `</div>\n`; // End flex container
          markdown += `</div>\n`; // End question container
          
          // Answer
          if (q.correct_match) {
            markdown += `<div style="margin-left: 44px; margin-top: 12px; padding: 12px; background: #ecfdf5; border-radius: 8px; border-left: 4px solid #10b981;">\n`;
            markdown += `<strong style="color: #059669;">✓ Correct Match:</strong> <span style="color: #047857; font-weight: 600;">${q.column_a || ''} → ${q.correct_match}</span>\n`;
            markdown += `</div>\n`;
          }
          
          markdown += `</div>\n`;
        }
        
        // Explanation if available
        if (q.explanation) {
          markdown += `<div style="margin-top: 12px; padding: 12px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b; margin-left: 44px;">\n`;
          markdown += `<strong style="color: #d97706;">💡 Explanation:</strong> <span style="color: #92400e;">${q.explanation}</span>\n`;
          markdown += `</div>\n`;
        }
        
        markdown += `</div>\n\n`;
      });
    }
  });

  return markdown;
}

/**
 * Format homework content (combined from multiple question types)
 */
function formatHomework(data, toolType, metadata) {
  let markdown = `# 📝 Homework Assignment\n\n`;
  
  if (metadata.classNumber) {
    markdown += `**Class:** ${metadata.classNumber}\n`;
  }
  if (metadata.subject) {
    markdown += `**Subject:** ${metadata.subject}\n`;
  }
  if (metadata.topic) {
    markdown += `**Topic:** ${metadata.topic}\n`;
  }
  if (data.total_questions) {
    markdown += `**Total Questions:** ${data.total_questions}\n`;
  }
  markdown += `\n---\n\n`;

  if (!data.sections || data.sections.length === 0) {
    return markdown + `No questions available.\n`;
  }

  // Format each section
  data.sections.forEach((section, sectionIndex) => {
    markdown += `## ${section.type} (${section.count} questions)\n\n`;
    
    if (section.questions && Array.isArray(section.questions)) {
      section.questions.forEach((q, qIndex) => {
        const qNum = q.question_number || (qIndex + 1);
        
        // Format question based on type
        if (section.type === 'MCQs') {
          markdown += `**Question ${qNum}:** ${q.question || ''}\n\n`;
          if (q.options) {
            if (q.options.A) markdown += `A. ${q.options.A}\n`;
            if (q.options.B) markdown += `B. ${q.options.B}\n`;
            if (q.options.C) markdown += `C. ${q.options.C}\n`;
            if (q.options.D) markdown += `D. ${q.options.D}\n`;
          }
          if (q.correct_answer) {
            markdown += `\n**Answer:** ${q.correct_answer}\n`;
          }
        } else if (section.type === 'Fill in the Blanks') {
          markdown += `**Question ${qNum}:** ${q.question || ''}\n\n`;
          if (q.correct_answer) {
            markdown += `**Answer:** ${q.correct_answer}\n`;
          }
        } else {
          // Short Answer, Long Answer, Very Short Answer
          markdown += `**Question ${qNum}:** ${q.question || ''}\n\n`;
          if (q.answer) {
            markdown += `**Answer:** ${q.answer}\n`;
          }
        }
        
        if (q.explanation) {
          markdown += `\n*Explanation: ${q.explanation}*\n`;
        }
        
        markdown += `\n---\n\n`;
      });
    }
  });

  return markdown;
}

/**
 * Format student CSV content (for study guides, practice questions, etc.)
 */
function formatStudentCSVContent(data, toolType, metadata) {
  const toolTitles = {
    'smart-study-guide-generator': '📚 Smart Study Guide',
    'concept-breakdown-explainer': '🧠 Concept Breakdown Explainer',
    'smart-qa-practice-generator': '❓ Smart Q&A Practice',
    'key-points-formula-extractor': '🔑 Key Points Extractor',
    'quick-assignment-builder': '📝 Quick Assignment Builder'
  };
  
  const toolColors = {
    'smart-study-guide-generator': { bg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: '#1e40af', icon: '📚' },
    'concept-breakdown-explainer': { bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', border: '#6d28d9', icon: '🧠' },
    'smart-qa-practice-generator': { bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: '#047857', icon: '❓' },
    'key-points-formula-extractor': { bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: '#b45309', icon: '🔑' },
    'quick-assignment-builder': { bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', border: '#b91c1c', icon: '📝' }
  };
  
  const colors = toolColors[toolType] || { bg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: '#1e40af', icon: '📚' };
  
  let markdown = `<div style="background: ${colors.bg}; border-radius: 12px; padding: 28px; margin-bottom: 32px; color: white; box-shadow: 0 10px 20px rgba(0,0,0,0.2); text-align: center;">\n`;
  markdown += `<h1 style="color: white; margin: 0 0 20px 0; font-size: 2rem; font-weight: 800; text-shadow: 2px 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; gap: 12px;">\n`;
  markdown += `<span style="font-size: 2.5rem;">${colors.icon}</span>\n`;
  markdown += `<span>${toolTitles[toolType] || 'Study Content'}</span>\n`;
  markdown += `</h1>\n`;
  markdown += `<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 30px; margin-top: 20px; font-size: 1.1rem;">\n`;
  
  if (metadata.classNumber) {
    markdown += `<div><strong>Class:</strong> ${metadata.classNumber}</div>\n`;
  }
  if (metadata.subject) {
    markdown += `<div><strong>Subject:</strong> ${metadata.subject}</div>\n`;
  }
  if (metadata.topic) {
    markdown += `<div><strong>Topic:</strong> ${metadata.topic}</div>\n`;
  }
  markdown += `</div>\n`;
  markdown += `</div>\n\n`;
  
  if (!data.data || data.data.length === 0) {
    return markdown + `<div style="text-align: center; padding: 40px; color: #6b7280; background: #f9fafb; border-radius: 12px;">No content available for this topic.</div>\n`;
  }
  
  // For quick-assignment-builder: select 10 random questions and show answers at the end
  let questionsData = data.data;
  if (toolType === 'quick-assignment-builder') {
    // Shuffle and take 10 questions
    const shuffled = [...questionsData].sort(() => Math.random() - 0.5);
    questionsData = shuffled.slice(0, 10);
  }
  
  // Store answers for quick-assignment-builder
  const answers = [];
  
  // Format questions/items from CSV with beautiful styling
  questionsData.forEach((row, index) => {
    const question = row.question || row.Question || row['Question'] || '';
    const answer = row.answer || row.Answer || row['Answer'] || row.correct_answer || row['Correct Answer'] || '';
    const options = row.options || row.Options || row['Options'] || '';
    const optionA = row.option_a || row['Option A'] || row.optionA || '';
    const optionB = row.option_b || row['Option B'] || row.optionB || '';
    const optionC = row.option_c || row['Option C'] || row.optionC || '';
    const optionD = row.option_d || row['Option D'] || row.optionD || '';
    
    // Store answer for quick-assignment-builder
    if (toolType === 'quick-assignment-builder' && answer) {
      answers.push({ number: index + 1, question, answer });
    }
    
    // Question card
    markdown += `<div style="background: #ffffff; border-radius: 12px; padding: 24px; margin: 24px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-left: 5px solid ${colors.border};">\n`;
    
    // Question header
    markdown += `<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">\n`;
    markdown += `<div style="background: ${colors.border}; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.1rem; flex-shrink: 0;">${index + 1}</div>\n`;
    markdown += `<div style="font-size: 1.15rem; font-weight: 700; color: #1f2937; flex: 1; line-height: 1.6;">${question}</div>\n`;
    markdown += `</div>\n`;
    
    // Options (if available)
    if (options || optionA || optionB || optionC || optionD) {
      markdown += `<div style="margin-left: 52px; margin-top: 16px;">\n`;
      const optionColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
      const optionLabels = ['A', 'B', 'C', 'D'];
      let optionIndex = 0;
      
      // Handle comma-separated options or individual options
      if (options) {
        const optionList = options.split(',').map(opt => opt.trim()).filter(opt => opt);
        optionList.forEach((opt, i) => {
          if (opt) {
            markdown += `<div style="display: flex; align-items: center; gap: 12px; padding: 12px; margin: 10px 0; background: #f9fafb; border-radius: 10px; border-left: 4px solid ${optionColors[optionIndex % 4]};">\n`;
            markdown += `<span style="background: ${optionColors[optionIndex % 4]}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; font-size: 1rem;">${optionLabels[optionIndex]}</span>\n`;
            markdown += `<span style="flex: 1; color: #374151; font-size: 1.05rem; line-height: 1.6;">${opt}</span>\n`;
            markdown += `</div>\n`;
            optionIndex++;
          }
        });
      } else {
        // Individual options
        [optionA, optionB, optionC, optionD].forEach((opt, i) => {
          if (opt) {
            markdown += `<div style="display: flex; align-items: center; gap: 12px; padding: 12px; margin: 10px 0; background: #f9fafb; border-radius: 10px; border-left: 4px solid ${optionColors[i % 4]};">\n`;
            markdown += `<span style="background: ${optionColors[i % 4]}; color: white; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; flex-shrink: 0; font-size: 1rem;">${optionLabels[i]}</span>\n`;
            markdown += `<span style="flex: 1; color: #374151; font-size: 1.05rem; line-height: 1.6;">${opt}</span>\n`;
            markdown += `</div>\n`;
          }
        });
      }
      markdown += `</div>\n`;
    }
    
    // Answer (if available) - only show for non-assignment-builder tools
    if (answer && toolType !== 'quick-assignment-builder') {
      markdown += `<div style="margin-left: 52px; margin-top: 20px; padding: 16px; background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 10px; border-left: 4px solid #10b981;">\n`;
      markdown += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">\n`;
      markdown += `<span style="font-size: 1.2rem;">✅</span>\n`;
      markdown += `<strong style="color: #047857; font-size: 1rem;">Answer:</strong>\n`;
      markdown += `</div>\n`;
      markdown += `<div style="color: #065f46; font-size: 1.05rem; line-height: 1.7; padding-left: 28px;">${answer}</div>\n`;
      markdown += `</div>\n`;
    }
    
    markdown += `</div>\n\n`;
  });
  
  // For quick-assignment-builder, show answers section at the end
  if (toolType === 'quick-assignment-builder' && answers.length > 0) {
    markdown += `<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; padding: 28px; margin: 32px 0; box-shadow: 0 10px 20px rgba(16, 185, 129, 0.3);">\n`;
    markdown += `<h2 style="color: white; margin: 0 0 24px 0; font-size: 1.75rem; font-weight: 800; text-shadow: 2px 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; gap: 12px;">\n`;
    markdown += `<span style="font-size: 2rem;">✅</span>\n`;
    markdown += `<span>Answer Key</span>\n`;
    markdown += `</h2>\n`;
    
    answers.forEach((item) => {
      markdown += `<div style="background: white; border-radius: 10px; padding: 20px; margin: 16px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">\n`;
      markdown += `<div style="display: flex; align-items: flex-start; gap: 12px;">\n`;
      markdown += `<div style="background: #10b981; color: white; width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1rem; flex-shrink: 0;">${item.number}</div>\n`;
      markdown += `<div style="flex: 1;">\n`;
      markdown += `<div style="color: #1f2937; font-size: 1.05rem; font-weight: 600; margin-bottom: 8px;">${item.question}</div>\n`;
      markdown += `<div style="color: #047857; font-size: 1rem; font-weight: 600;">Answer: <span style="font-weight: 700;">${item.answer}</span></div>\n`;
      markdown += `</div>\n`;
      markdown += `</div>\n`;
      markdown += `</div>\n`;
    });
    
    markdown += `</div>\n`;
  }
  
  // Footer
  markdown += `<div style="background: ${colors.bg}; border-radius: 12px; padding: 20px; margin-top: 32px; color: white; text-align: center; box-shadow: 0 8px 16px rgba(0,0,0,0.2);">\n`;
  markdown += `<div style="font-size: 1.1rem; font-weight: 600;">Total Questions: <span style="font-size: 1.5rem; font-weight: 800;">${questionsData.length}</span></div>\n`;
  markdown += `</div>\n`;
  
  return markdown;
}

/**
 * Format revision planner from planner.json
 */
function formatRevisionPlanner(data, metadata) {
  let markdown = `<div style="background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%); border-radius: 12px; padding: 28px; margin-bottom: 32px; color: white; box-shadow: 0 10px 20px rgba(139, 92, 246, 0.3); text-align: center;">\n`;
  markdown += `<h1 style="color: white; margin: 0 0 20px 0; font-size: 2rem; font-weight: 800; text-shadow: 2px 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; gap: 12px;">\n`;
  markdown += `<span style="font-size: 2.5rem;">📅</span>\n`;
  markdown += `<span>Personalized Revision Planner</span>\n`;
  markdown += `</h1>\n`;
  markdown += `<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 30px; margin-top: 20px; font-size: 1.1rem;">\n`;
  
  if (metadata.classNumber) {
    markdown += `<div><strong>Class:</strong> ${metadata.classNumber}</div>\n`;
  }
  if (metadata.subject) {
    markdown += `<div><strong>Subject:</strong> ${metadata.subject}</div>\n`;
  }
  markdown += `</div>\n`;
  markdown += `</div>\n\n`;
  
  const lessons = data.lessons || data.lesson_plans || [];
  
  if (lessons.length === 0) {
    return markdown + `<div style="text-align: center; padding: 40px; color: #6b7280; background: #f9fafb; border-radius: 12px;">No revision plan available.</div>\n`;
  }
  
  markdown += `<div style="margin-bottom: 24px;">\n`;
  markdown += `<h2 style="color: #1f2937; font-size: 1.75rem; font-weight: 700; margin-bottom: 24px; display: flex; align-items: center; gap: 12px;">\n`;
  markdown += `<span style="font-size: 2rem;">📋</span>\n`;
  markdown += `<span>Revision Schedule</span>\n`;
  markdown += `</h2>\n`;
  markdown += `</div>\n\n`;
  
  const weekColors = [
    { bg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', border: '#1e40af' },
    { bg: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', border: '#6d28d9' },
    { bg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: '#047857' },
    { bg: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', border: '#b45309' },
    { bg: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', border: '#b91c1c' }
  ];
  
  lessons.forEach((lesson, index) => {
    const colors = weekColors[index % weekColors.length];
    
    markdown += `<div style="background: ${colors.bg}; border-radius: 12px; padding: 24px; margin: 24px 0; box-shadow: 0 8px 16px rgba(0,0,0,0.2); border-left: 6px solid ${colors.border};">\n`;
    markdown += `<div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">\n`;
    markdown += `<div style="background: rgba(255,255,255,0.2); color: white; width: 50px; height: 50px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 1.2rem; flex-shrink: 0;">${index + 1}</div>\n`;
    markdown += `<h3 style="color: white; margin: 0; font-size: 1.5rem; font-weight: 700;">Week ${index + 1}: ${lesson.title || lesson.name || `Lesson ${index + 1}`}</h3>\n`;
    markdown += `</div>\n`;
    
    markdown += `<div style="background: white; border-radius: 10px; padding: 20px; margin-top: 16px;">\n`;
    markdown += `<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">\n`;
    markdown += `<span style="font-size: 1.2rem;">📚</span>\n`;
    markdown += `<strong style="color: #1f2937; font-size: 1.1rem;">Topics to Revise:</strong>\n`;
    markdown += `</div>\n`;
    
    if (lesson.topics && Array.isArray(lesson.topics)) {
      markdown += `<ul style="margin: 0; padding-left: 0; list-style: none;">\n`;
      lesson.topics.forEach((topic, topicIndex) => {
        markdown += `<li style="margin: 10px 0; padding: 12px; background: linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%); border-radius: 8px; border-left: 3px solid ${colors.border}; display: flex; align-items: flex-start;">\n`;
        markdown += `<span style="background: ${colors.border}; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 600; margin-right: 12px; flex-shrink: 0; margin-top: 2px;">${topicIndex + 1}</span>\n`;
        markdown += `<span style="line-height: 1.7; color: #374151; font-size: 1rem; flex: 1;">${topic}</span>\n`;
        markdown += `</li>\n`;
      });
      markdown += `</ul>\n`;
    }
    markdown += `</div>\n`;
    markdown += `</div>\n\n`;
  });
  
  return markdown;
}

/**
 * Format chapter summary from planner.json
 */
function formatChapterSummary(data, metadata) {
  let markdown = `<div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 12px; padding: 28px; margin-bottom: 32px; color: white; box-shadow: 0 10px 20px rgba(16, 185, 129, 0.3); text-align: center;">\n`;
  markdown += `<h1 style="color: white; margin: 0 0 20px 0; font-size: 2rem; font-weight: 800; text-shadow: 2px 2px 4px rgba(0,0,0,0.2); display: flex; align-items: center; justify-content: center; gap: 12px;">\n`;
  markdown += `<span style="font-size: 2.5rem;">📖</span>\n`;
  markdown += `<span>Chapter Summary</span>\n`;
  markdown += `</h1>\n`;
  markdown += `<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 30px; margin-top: 20px; font-size: 1.1rem;">\n`;
  
  if (metadata.classNumber) {
    markdown += `<div><strong>Class:</strong> ${metadata.classNumber}</div>\n`;
  }
  if (metadata.subject) {
    markdown += `<div><strong>Subject:</strong> ${metadata.subject}</div>\n`;
  }
  if (metadata.topic) {
    markdown += `<div><strong>Chapter:</strong> ${metadata.topic}</div>\n`;
  }
  markdown += `</div>\n`;
  markdown += `</div>\n\n`;
  
  const lessons = data.lessons || data.lesson_plans || [];
  
  // Find the lesson matching the topic
  const matchingLesson = lessons.find(lesson => 
    lesson.title?.toLowerCase().includes(metadata.topic?.toLowerCase() || '') ||
    lesson.name?.toLowerCase().includes(metadata.topic?.toLowerCase() || '')
  );
  
  if (matchingLesson) {
    markdown += `<div style="background: #ffffff; border-radius: 12px; padding: 28px; margin: 24px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-left: 5px solid #10b981;">\n`;
    markdown += `<h2 style="color: #1f2937; font-size: 1.75rem; font-weight: 700; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">\n`;
    markdown += `<span style="font-size: 2rem;">📚</span>\n`;
    markdown += `<span>${matchingLesson.title || matchingLesson.name}</span>\n`;
    markdown += `</h2>\n`;
    
    if (matchingLesson.summary) {
      markdown += `<div style="background: #f9fafb; border-radius: 10px; padding: 20px; margin: 20px 0; border-left: 4px solid #10b981;">\n`;
      markdown += `<div style="color: #374151; font-size: 1.05rem; line-height: 1.8; white-space: pre-wrap;">${matchingLesson.summary}</div>\n`;
      markdown += `</div>\n`;
    }
    
    if (matchingLesson.key_points && Array.isArray(matchingLesson.key_points)) {
      markdown += `<div style="margin-top: 24px;">\n`;
      markdown += `<h3 style="color: #1f2937; font-size: 1.3rem; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">\n`;
      markdown += `<span style="font-size: 1.5rem;">🔑</span>\n`;
      markdown += `<span>Key Points:</span>\n`;
      markdown += `</h3>\n`;
      markdown += `<ul style="margin: 0; padding-left: 0; list-style: none;">\n`;
      matchingLesson.key_points.forEach((point, i) => {
        markdown += `<li style="margin: 12px 0; padding: 16px; background: linear-gradient(90deg, rgba(16, 185, 129, 0.1) 0%, rgba(16, 185, 129, 0.05) 100%); border-radius: 8px; border-left: 3px solid #10b981; display: flex; align-items: flex-start;">\n`;
        markdown += `<span style="background: #10b981; color: white; width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 0.875rem; font-weight: 600; margin-right: 12px; flex-shrink: 0; margin-top: 2px;">${i + 1}</span>\n`;
        markdown += `<span style="line-height: 1.7; color: #374151; font-size: 1.05rem; flex: 1;">${point}</span>\n`;
        markdown += `</li>\n`;
      });
      markdown += `</ul>\n`;
      markdown += `</div>\n`;
    }
    markdown += `</div>\n`;
  } else {
    // If no matching lesson, show all lessons
    lessons.forEach((lesson, index) => {
      markdown += `<div style="background: #ffffff; border-radius: 12px; padding: 24px; margin: 24px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-left: 5px solid #10b981;">\n`;
      markdown += `<h2 style="color: #1f2937; font-size: 1.5rem; font-weight: 700; margin-bottom: 16px;">${lesson.title || lesson.name || `Chapter ${index + 1}`}</h2>\n`;
      if (lesson.summary) {
        markdown += `<div style="color: #374151; font-size: 1.05rem; line-height: 1.8; white-space: pre-wrap;">${lesson.summary}</div>\n`;
      }
      markdown += `</div>\n`;
    });
  }
  
  return markdown;
}

/**
 * Format Activities JSON (Class 7-10 Activity & Project Generator)
 */
function formatActivitiesJSON(data, metadata) {
  let markdown = `## Activity & Project Generator\n\n`;
  if (metadata.classNumber) markdown += `**Class:** ${metadata.classNumber}\n`;
  if (metadata.subject) markdown += `**Subject:** ${metadata.subject}\n`;
  if (metadata.topic) markdown += `**Topic:** ${metadata.topic}\n\n`;

  if (data.activities && Array.isArray(data.activities)) {
    data.activities.forEach((activity, index) => {
      markdown += `### Activity ${index + 1}: ${activity.title || activity.name || 'Untitled'}\n\n`;
      if (activity.description) markdown += `**Description:** ${activity.description}\n\n`;
      if (activity.objective) markdown += `**Objective:** ${activity.objective}\n\n`;

      // Materials can come from `materials` (array/string) or `materials_required`
      const materials =
        activity.materials ??
        activity.materials_required ??
        null;
      if (materials) {
        if (Array.isArray(materials)) {
          markdown += `**Materials:** ${materials.join(', ')}\n\n`;
        } else {
          markdown += `**Materials:** ${materials}\n\n`;
        }
      }

      // Step-by-step procedure: support `instructions` or `steps`
      const instructions =
        activity.instructions && Array.isArray(activity.instructions)
          ? activity.instructions
          : activity.steps && Array.isArray(activity.steps)
          ? activity.steps
          : activity.instructions || activity.steps || null;

      if (instructions) {
        if (Array.isArray(instructions)) {
          markdown += `**Steps / Procedure:**\n`;
          instructions.forEach((inst) => {
            markdown += `- ${inst}\n`;
          });
          markdown += `\n`;
        } else {
          markdown += `**Steps / Procedure:** ${instructions}\n\n`;
        }
      }

      // Learning outcomes may be stored under different keys
      const learningOutcome =
        activity.expected_outcome ||
        activity.learning_outcome ||
        activity.learning_outcomes ||
        null;
      if (learningOutcome) {
        markdown += `**Expected Outcome / Learning Outcome:** ${learningOutcome}\n\n`;
      }

      // Evaluation / assessment criteria
      if (activity.evaluation || activity.assessment) {
        markdown += `**Evaluation:** ${
          Array.isArray(activity.evaluation || activity.assessment)
            ? (activity.evaluation || activity.assessment).join('; ')
            : activity.evaluation || activity.assessment
        }\n\n`;
      }

      markdown += `---\n\n`;
    });
  } else {
    // Fallback: treat the whole object as key-value pairs
    Object.keys(data).forEach(key => {
      if (key !== 'activities' && data[key]) {
        const formattedKey = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        markdown += `**${formattedKey}:** ${typeof data[key] === 'object' ? JSON.stringify(data[key], null, 2) : data[key]}\n\n`;
      }
    });
  }

  return markdown;
}

/**
 * Format generic JSON content
 */
function formatGenericJSON(data, toolType, metadata) {
  // Check if it's exam paper format
  if (data.content_type === 'Exam Paper' || ((toolType === 'mock-test-builder' || toolType === 'exam-question-paper-generator') && data.sections && Array.isArray(data.sections))) {
    return formatExamPaper(data, toolType, metadata);
  }
  
  // Check if it's worksheet format
  if (data.content_type === 'Worksheet' || (toolType === 'worksheet-mcq-generator' && data.sections && Array.isArray(data.sections))) {
    return formatWorksheet(data, toolType, metadata);
  }
  
  // Check if it's homework format
  if (data.content_type === 'Homework' || (data.sections && Array.isArray(data.sections))) {
    return formatHomework(data, toolType, metadata);
  }
  
  let markdown = `## ${getToolTitle(toolType)}\n\n`;
  markdown += `**Class:** ${metadata.classNumber || 'N/A'}\n`;
  markdown += `**Subject:** ${metadata.subject || 'N/A'}\n`;
  markdown += `**Topic:** ${metadata.topic || 'N/A'}\n\n`;
  
  // Try to format common structures
  if (typeof data === 'object') {
    markdown += JSON.stringify(data, null, 2);
  } else {
    markdown += String(data);
  }
  
  return markdown;
}

export default formatHardcodedContent;
