import express from 'express';
import { protect } from '../middleware/auth.middleware.js';
import { requireTeacher } from '../middleware/role.middleware.js';
import {
  getTeacherCourses,
  createCourse,
  getCourseDetails,
  enrollStudent,
  bulkEnrollStudents,
  removeStudent,
} from '../controllers/course.controller.js';

const router = express.Router();

router.get('/teacher', protect, requireTeacher, getTeacherCourses);
router.post('/', protect, requireTeacher, createCourse);
router.get('/:courseId', protect, getCourseDetails);
router.post('/:courseId/students', protect, requireTeacher, enrollStudent);
router.post('/:courseId/students/bulk', protect, requireTeacher, bulkEnrollStudents);
router.delete('/:courseId/students/:identifier', protect, requireTeacher, removeStudent);

export default router;
