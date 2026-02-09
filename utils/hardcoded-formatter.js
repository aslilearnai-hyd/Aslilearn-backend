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
  
  if (data.flashcards) {
    const questions = data.flashcards.questions || [];
    const importantNotes = data.flashcards.important_notes || [];
    const facts = data.flashcards.facts || [];
    
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
    'flashcard-generator': 'Flashcard Generator',
    'short-notes-summaries-maker': 'Short Notes & Summaries',
    'lesson-planner': 'Lesson Planner',
    'worksheet-mcq-generator': 'Worksheet & MCQ Generator',
    'exam-question-paper-generator': 'Exam Question Paper Generator',
    'activity-project-generator': 'Activity & Project Generator',
    'story-passage-creator': 'Story & Passage Creator',
  };
  return titles[toolType] || 'Content';
}

/**
 * Main formatter function
 */
export function formatHardcodedContent(data, toolType, metadata = {}) {
  try {
    // Check if data is JSON (object) or CSV (has headers/data structure)
    if (data.content_type) {
      // JSON format
      switch (data.content_type) {
        case 'Concept Mastery Helper':
          return formatConceptMasteryHelper(data);
        case 'Flashcard Maker':
          return formatFlashcardGenerator(data);
        case 'Short Notes & Summaries':
          return formatShortNotesSummaries(data);
        default:
          return formatGenericJSON(data, toolType, metadata);
      }
    } else if (data.headers && data.data) {
      // CSV format
      if (toolType === 'activity-project-generator') {
        return formatProjectsCSV(data, metadata);
      } else if (toolType === 'story-passage-creator') {
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
 * Format generic JSON content
 */
function formatGenericJSON(data, toolType, metadata) {
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
