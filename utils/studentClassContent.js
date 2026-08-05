/**
 * Class-scoped content visibility for students.
 */

export function normalizeClassNumberLabel(value) {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  // IIT-6 / Class-6-IIT → 6
  if (/^iit[-\s]*\d+/i.test(raw) || /^class[-\s]*\d+[-\s]*iit/i.test(raw)) {
    const d = raw.match(/(\d+)/);
    return d ? String(parseInt(d[1], 10)) : raw;
  }
  const withoutClass = raw.replace(/^class\s+/i, '').trim();
  // "6", "6th", "Class 6", "VI" handled via digits when present
  const digitMatch = withoutClass.match(/(\d+)/);
  if (digitMatch) return String(parseInt(digitMatch[1], 10));
  if (/^\d+$/.test(withoutClass)) return String(parseInt(withoutClass, 10));
  return withoutClass;
}

export function classLabelFromContent(doc) {
  const cn = doc?.classNumber;
  if (cn != null && String(cn).trim() !== '') return String(cn).trim();
  const subjectCn = doc?.subject?.classNumber;
  if (subjectCn != null && String(subjectCn).trim() !== '') return String(subjectCn).trim();
  const n = doc?.subject?.name || '';
  const m = String(n).match(/_(\d+)$/);
  return m ? m[1] : '';
}

export function resolveStudentClassNumber(student, studentClassDoc) {
  const fromClass = studentClassDoc?.classNumber ?? student?.assignedClass?.classNumber;
  if (fromClass && String(fromClass).trim() !== '' && String(fromClass) !== 'Unassigned') {
    return normalizeClassNumberLabel(fromClass);
  }
  if (
    student?.classNumber &&
    String(student.classNumber).trim() !== '' &&
    String(student.classNumber) !== 'Unassigned'
  ) {
    return normalizeClassNumberLabel(student.classNumber);
  }
  return null;
}

function classLabelsMatch(a, b) {
  if (!a || !b) return false;
  return normalizeClassNumberLabel(a) === normalizeClassNumberLabel(b);
}

/**
 * Include content for the student's class only.
 * - Tagged with another class → exclude.
 * - No class tag → include only when subject is in librarySubjectIds (direct class subjects, not siblings).
 */
export function contentMatchesStudentClass(doc, studentClassNumber, librarySubjectIds) {
  const label = normalizeClassNumberLabel(classLabelFromContent(doc));

  if (studentClassNumber && label) {
    return classLabelsMatch(label, studentClassNumber);
  }

  if (librarySubjectIds?.length) {
    const libSet = new Set(librarySubjectIds.map((id) => String(id)));
    const sid = String(doc?.subject?._id || doc?.subject || '');
    return libSet.has(sid);
  }

  if (studentClassNumber && label) {
    return classLabelsMatch(label, studentClassNumber);
  }

  return !studentClassNumber;
}

export function filterContentsForStudentClass(contents, studentClassNumber, librarySubjectIds) {
  if (!Array.isArray(contents)) return contents;
  if (!studentClassNumber && !librarySubjectIds?.length) return contents;
  return contents.filter((doc) =>
    contentMatchesStudentClass(doc, studentClassNumber, librarySubjectIds)
  );
}

/** Class numbers targeted by an exam (assignedClasses + legacy classNumber). */
export function getExamAssignedClassNumbers(exam) {
  const classes = [];
  const raw = exam?.assignedClasses;
  if (typeof raw === 'string' && raw.trim()) {
    const parts = raw.includes('|') ? raw.split('|') : raw.includes(',') ? raw.split(',') : [raw];
    parts.forEach((part) => {
      const n = normalizeClassNumberLabel(part);
      if (n) classes.push(n);
    });
  } else if (Array.isArray(raw)) {
    raw.forEach((c) => {
      const n = normalizeClassNumberLabel(
        typeof c === 'object' && c != null ? c.classNumber ?? c : c
      );
      if (n) classes.push(n);
    });
  }
  const cn =
    exam?.classNumber != null && String(exam.classNumber).trim() !== ''
      ? normalizeClassNumberLabel(exam.classNumber)
      : '';
  if (cn) classes.push(cn);
  return [...new Set(classes.filter(Boolean))];
}

/** Student may only take exams explicitly assigned to their class. */
export function examMatchesStudentAssignedClass(exam, studentClassNumber) {
  const want = studentClassNumber ? normalizeClassNumberLabel(studentClassNumber) : '';
  // No class on the student → deny class-targeted exams (do not treat as "see all").
  if (!want) return false;
  const examClasses = getExamAssignedClassNumbers(exam);
  if (examClasses.length === 0) return false;
  return examClasses.some((c) => classLabelsMatch(c, want));
}
