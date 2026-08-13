import mongoose from 'mongoose';
import Teacher from '../../models/Teacher.js';
import User from '../../models/User.js';
import Subject from '../../models/Subject.js';

/** YYYY-MM-DD -> UTC midnight for that calendar day */
export function parseDateKeyToUtc(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

// Get teacher's assigned classes
export async function getTeacherClassesHandler(req, res) {
  try {
    const teacherId = req.teacherId;
    console.log('=== FETCHING TEACHER CLASSES ===');
    console.log('Teacher ID:', teacherId);
    
    if (!teacherId) {
      return res.status(400).json({ success: false, message: 'Teacher ID not found' });
    }
    
    // Get teacher with assigned classes
    const teacher = await Teacher.findById(teacherId);
    if (!teacher) {
      return res.status(404).json({ success: false, message: 'Teacher not found' });
    }
    
    if (!teacher.assignedClassIds || teacher.assignedClassIds.length === 0) {
      console.log('Teacher has no assigned classes');
      return res.json({ success: true, data: [] });
    }
    
    // Get Class model
    const Class = (await import('../../models/Class.js')).default;
    
    // Fetch actual Class documents from database
    const classIdSet = new Set((teacher.assignedClassIds || []).map(String));
    (teacher.assignments || []).forEach((a) => {
      if (a.classId) classIdSet.add(String(a.classId));
    });

    const classDocuments = await Class.find({
      $or: [
        { _id: { $in: [...classIdSet].filter((id) => mongoose.Types.ObjectId.isValid(id)) } },
        { classNumber: { $in: teacher.assignedClassIds || [] } },
      ],
      isActive: true,
      ...(teacher.adminId ? { assignedAdmin: teacher.adminId } : {}),
    })
    .populate('assignedSubjects', '_id name description code board')
    .select('_id classNumber section description assignedSubjects name');
    
    // Get student counts for each class
    const classObjectIds = classDocuments.map(c => c._id);
    const students = await User.find({ 
      role: 'student',
      assignedClass: { $in: classObjectIds },
      assignedAdmin: teacher.adminId
    })
    .populate('assignedClass', '_id classNumber section')
    .select('fullName email classNumber assignedClass');
    
    // Map classes with student counts
    const classesWithStudents = classDocuments.map(classDoc => {
      const classStudents = students.filter(s => 
        s.assignedClass && s.assignedClass._id.toString() === classDoc._id.toString()
      );
      
      const assignmentSubjects = (teacher.assignments || [])
        .filter((a) => String(a.classId) === String(classDoc._id))
        .map((a) => a.subjectId);

      const subjectsFromClass = classDoc.assignedSubjects || [];
      const subjectMap = new Map();
      subjectsFromClass.forEach((s) => {
        const id = String(s._id || s);
        subjectMap.set(id, {
          id,
          name: s.name || 'Subject',
          description: s.description || '',
        });
      });

      return {
        _id: classDoc._id,
        id: classDoc._id,
        className: classDoc.name || `Class ${classDoc.classNumber}${classDoc.section || ''}`,
        name: classDoc.name || `Class ${classDoc.classNumber}${classDoc.section ? ` - ${classDoc.section}` : ''}`,
        classNumber: classDoc.classNumber,
        section: classDoc.section,
        description: classDoc.description,
        subjects: [...subjectMap.values()],
        subject: [...subjectMap.values()].map((s) => s.name).join(', ') || 'N/A',
        assignmentSubjectIds: assignmentSubjects.map(String),
        studentCount: classStudents.length,
        students: classStudents.map(s => ({
          id: s._id,
          name: s.fullName || s.email,
          email: s.email,
          status: 'active'
        })),
        schedule: 'Not scheduled',
        room: classDoc.name
          ? `Room ${classDoc.classNumber}${classDoc.section || ''}`
          : '—',
      };
    });

    const { getClassScheduleAndRoomMap } = await import('../../utils/teacherClassSchedule.js');
    const scheduleMap = await getClassScheduleAndRoomMap(
      teacherId,
      classesWithStudents.map((c) => c._id)
    );
    const classesWithSchedule = classesWithStudents.map((c) => {
      const fromTimetable = scheduleMap.get(String(c._id));
      const fallbackRoom = `Room ${c.classNumber}${c.section || ''}`;
      return {
        ...c,
        schedule: fromTimetable?.schedule || c.schedule,
        room: fromTimetable?.room || fallbackRoom,
      };
    });
    
    console.log(`Found ${classesWithSchedule.length} classes for teacher`);
    res.json({ success: true, data: classesWithSchedule });
  } catch (error) {
    console.error('Error fetching teacher classes:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch classes', error: error.message });
  }
}

