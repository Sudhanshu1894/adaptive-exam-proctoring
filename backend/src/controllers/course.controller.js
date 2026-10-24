import dynamoService from '../services/dynamo/dynamo.service.js';

/**
 * Teacher: List assigned courses and slots
 */
export const getTeacherCourses = async (req, res, next) => {
  try {
    const teacherEmail = (req.user?.email || 'teacher@adaptive.edu').toLowerCase().trim();
    const courses = await dynamoService.listCoursesByTeacher(teacherEmail);

    res.status(200).json({
      success: true,
      data: { courses },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Teacher: Create or assign a course & slot
 */
export const createCourse = async (req, res, next) => {
  try {
    const { courseCode, title, slot, description } = req.body;
    const teacherEmail = (req.user?.email || 'teacher@adaptive.edu').toLowerCase().trim();
    const teacherId = req.user?.id || req.user?._id || teacherEmail;

    if (!courseCode || !title || !slot) {
      return res.status(400).json({
        success: false,
        error: { message: 'Course code, title, and slot are required.' },
      });
    }

    const courseId = `crs_${courseCode.toLowerCase().replace(/[^a-z0-9]/g, '')}_${slot.toLowerCase()}_${Date.now()}`;

    const newCourse = await dynamoService.putCourse({
      courseId,
      courseCode: courseCode.toUpperCase().trim(),
      title: title.trim(),
      slot: slot.toUpperCase().trim(),
      teacherEmail,
      teacherId,
      description: description || '',
      studentRoster: [],
    });

    res.status(201).json({
      success: true,
      message: 'Course created and slot assigned successfully.',
      data: { course: newCourse },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Common: Get single course details with roster
 */
export const getCourseDetails = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const course = await dynamoService.getCourse(courseId);

    if (!course) {
      return res.status(404).json({
        success: false,
        error: { message: 'Course not found.' },
      });
    }

    res.status(200).json({
      success: true,
      data: { course },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Teacher: Enroll single student into course
 */
export const enrollStudent = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const { rollNo, email } = req.body;

    if (!rollNo || !email) {
      return res.status(400).json({
        success: false,
        error: { message: 'Registration number (rollNo) and email address are required.' },
      });
    }

    const result = await dynamoService.enrollStudentInCourse(courseId, { rollNo, email });

    res.status(200).json({
      success: true,
      message: result.isNewlyVerified
        ? `Student verified and enrolled successfully!`
        : `Student identity is pending registration. Enrollment invitation recorded.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Teacher: Bulk enroll students from CSV data
 */
export const bulkEnrollStudents = async (req, res, next) => {
  try {
    const { courseId } = req.params;
    const { students } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'A non-empty array of student enrollment records is required.' },
      });
    }

    const result = await dynamoService.bulkEnrollStudentsInCourse(courseId, students);

    res.status(200).json({
      success: true,
      message: `Bulk enrollment completed. ${result.enrolledCount} active students enrolled, ${result.pendingCount} pending verification, ${result.skippedCount} skipped.`,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Teacher: Remove student enrollment from course
 */
export const removeStudent = async (req, res, next) => {
  try {
    const { courseId, identifier } = req.params;

    const updatedCourse = await dynamoService.removeStudentFromCourse(courseId, identifier);

    res.status(200).json({
      success: true,
      message: 'Student removed from course enrollment roster.',
      data: { course: updatedCourse },
    });
  } catch (error) {
    next(error);
  }
};
