import fs from 'fs/promises';
import path from 'path';

// Base directory for hardcoded content
const BASE_DIR = path.join(__dirname, '..', 'Asli hardcoding');

// Helper to log and also push into a report array
const report = {
  checked_topics: [],
  created_activity_folders: [],
  removed_topics: [],
  already_complete: [],
};

// Configuration for which topics to keep per class/subject
// "ALL" means keep all topics for that subject in that class.
// For filtered subjects, we match topic folder names using simple predicates.
const rules = {
  7: {
    Maths: {
      type: 'FILTERED',
      keep: (topicName) =>
        ['2.', '4.', '6.', '7.'].some((prefix) =>
          topicName.trim().startsWith(prefix),
        ),
    },
    English: { type: 'ALL' },
    Hindi: { type: 'ALL' }, // DONE
    Science: { type: 'ALL' }, // DONE
    Social: { type: 'ALL' }, // DONE
  },
  8: {
    Maths: {
      type: 'FILTERED',
      keep: (topicName) =>
        topicName.toLowerCase().includes('proportional reasoning'),
    },
    English: { type: 'ALL' },
    Hindi: { type: 'ALL' }, // DONE
    Science: { type: 'ALL' }, // DONE
    Social: { type: 'ALL' }, // DONE
  },
  9: {
    Maths: { type: 'ALL' }, // DONE
    English: { type: 'ALL' }, // DONE
    Hindi: { type: 'ALL' }, // DONE
    Science: {
      type: 'FILTERED',
      keep: (topicName) => {
        const lower = topicName.toLowerCase();
        return (
          lower.includes('structure of atom') ||
          lower.includes('structure of the atom') ||
          lower.startsWith('9.')
        );
      },
    },
    Social: {
      type: 'FILTERED',
      keep: (topicName) => {
        const lower = topicName.toLowerCase();
        return (
          lower.includes('population') ||
          lower.includes('democratic rights')
        );
      },
    },
  },
  10: {
    Maths: { type: 'ALL' }, // DONE
    English: { type: 'ALL' }, // DONE
    Hindi: {
      type: 'SPECIAL_HINDI_10',
    },
    Science: {
      type: 'FILTERED',
      keep: (topicName) => {
        const lower = topicName.toLowerCase();
        return (
          lower.includes('metals and non-metals') ||
          lower.includes('metals & non-metals') ||
          lower.startsWith('8.')
        );
      },
    },
    Social: { type: 'ALL' }, // DONE
  },
};

const ACTIVITY_FOLDER_NAME = 'Activity and Project Generator';
const ACTIVITY_FILES = [
  'easy_activity.json',
  'medium_activity.json',
  'hard_activity.json',
];

async function ensureActivityFolder(topicDir, relativeTopicPath) {
  const activityDir = path.join(topicDir, ACTIVITY_FOLDER_NAME);

  try {
    await fs.mkdir(activityDir, { recursive: true });
  } catch {
    // ignore mkdir race conditions
  }

  const createdFiles = [];

  for (const fileName of ACTIVITY_FILES) {
    const filePath = path.join(activityDir, fileName);
    try {
      await fs.access(filePath);
    } catch {
      // File does not exist; create a simple placeholder
      const placeholder = {
        status: 'placeholder',
        note: 'TODO: replace with real Activity & Project Generator content',
      };
      await fs.writeFile(filePath, JSON.stringify(placeholder, null, 2), 'utf8');
      createdFiles.push(path.join(relativeTopicPath, ACTIVITY_FOLDER_NAME, fileName));
    }
  }

  if (createdFiles.length > 0) {
    report.created_activity_folders.push({
      topic: relativeTopicPath,
      created_files: createdFiles,
    });
  } else {
    report.already_complete.push(relativeTopicPath);
  }
}

async function processSubject(classNumber, classDir, subjectName, subjectDir) {
  const classRules = rules[classNumber];
  const subjectRule = classRules && classRules[subjectName];

  // If subject is not in the rules for this class, we leave it untouched.
  if (!subjectRule) {
    return;
  }

  const topicEntries = await fs.readdir(subjectDir, { withFileTypes: true });

  // Special case: Class 10 Hindi has Reader (NOT DONE) and Supplementary (DONE)
  if (subjectRule.type === 'SPECIAL_HINDI_10') {
    for (const bookEntry of topicEntries) {
      if (!bookEntry.isDirectory()) continue;
      const bookName = bookEntry.name;
      const bookDir = path.join(subjectDir, bookName);

      const bookTopics = await fs.readdir(bookDir, { withFileTypes: true });
      for (const topicEntry of bookTopics) {
        if (!topicEntry.isDirectory()) continue;
        const topicName = topicEntry.name;
        const topicDir = path.join(bookDir, topicName);
        const relativeTopicPath = path.join(
          `Class ${classNumber}`,
          subjectName,
          bookName,
          topicName,
        );

        report.checked_topics.push(relativeTopicPath);
        await ensureActivityFolder(topicDir, relativeTopicPath);
      }
    }
    return;
  }

  for (const topicEntry of topicEntries) {
    if (!topicEntry.isDirectory()) continue;

    const topicName = topicEntry.name;
    const topicDir = path.join(subjectDir, topicName);
    const relativeTopicPath = path.join(
      `Class ${classNumber}`,
      subjectName,
      topicName,
    );

    const keepTopic =
      subjectRule.type === 'ALL'
        ? true
        : subjectRule.type === 'FILTERED'
          ? subjectRule.keep(topicName)
          : true;

    if (!keepTopic) {
      // Remove the entire topic folder
      await fs.rm(topicDir, { recursive: true, force: true });
      report.removed_topics.push(relativeTopicPath);
      continue;
    }

    report.checked_topics.push(relativeTopicPath);
    await ensureActivityFolder(topicDir, relativeTopicPath);
  }
}

async function main() {
  for (const classNumber of [7, 8, 9, 10]) {
    const classDirName = `Class ${classNumber}`;
    const classDir = path.join(BASE_DIR, classDirName);

    try {
      const stat = await fs.stat(classDir);
      if (!stat.isDirectory()) continue;
    } catch {
      // Class folder does not exist, skip
      continue;
    }

    const subjectEntries = await fs.readdir(classDir, { withFileTypes: true });
    for (const subjectEntry of subjectEntries) {
      if (!subjectEntry.isDirectory()) continue;

      const subjectName = subjectEntry.name;
      const subjectDir = path.join(classDir, subjectName);

      await processSubject(classNumber, classDir, subjectName, subjectDir);
    }
  }

  // Final report
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('Error while validating Activity and Project Generator:', err);
  process.exit(1);
});

