/**
 * Class-scoped content visibility for students.
 */

export function normalizeClassNumberLabel(value) {
  if (value == null) return '';
  const s = String(value).trim().replace(/^class\s+/i, '');
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

export function classLabelFromContent(doc) {
  const cn = doc?.classNumber;
  if (cn != null && String(cn).trim() !== '') return String(cn).trim();
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
  if (!want) return true;
  const examClasses = getExamAssignedClassNumbers(exam);
  if (examClasses.length === 0) return false;
  return examClasses.some((c) => classLabelsMatch(c, want));
}
