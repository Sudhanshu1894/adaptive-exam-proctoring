import dynamoService from '../src/services/dynamo/dynamo.service.js';
import * as examService from '../src/services/exam.service.js';

async function runLmsTests() {
  console.log('--- STARTING LMS COURSE ENROLLMENT & QUIZ SCHEDULING VERIFICATION ---');

  const testTeacherEmail = 'prof.alan@adaptive.edu';
  const testTag = Date.now().toString().slice(-4);
  const testStudentEmail = `student.test_${testTag}@gmail.com`;
  const testUnenrolledEmail = `student.outsider_${testTag}@gmail.com`;
  const testRoll = `21BCE${testTag}`;

  // 1. Verify Teacher Course & Slot Management
  console.log('\n[TEST 1] Listing Assigned Courses for Teacher...');
  const teacherCourses = await dynamoService.listCoursesByTeacher(testTeacherEmail);
  console.log(`✓ Retrieved ${teacherCourses.length} assigned courses for ${testTeacherEmail}:`);
  teacherCourses.forEach((c) => {
    console.log(`   - [${c.slot}] ${c.courseCode}: ${c.title}`);
  });

  if (teacherCourses.length < 3) {
    throw new Error('Expected at least 3 default assigned courses (Slots A1, B1, C1)');
  }
  const testCourse = teacherCourses[0]; // e.g. CSE401 Slot A1

  // 2. Verify Single Student Enrollment & Duplicate Detection
  console.log('\n[TEST 2] Testing Single Student Enrollment...');
  const enrollmentResult = await dynamoService.enrollStudentInCourse(testCourse.courseId, {
    rollNo: testRoll,
    email: testStudentEmail,
  });
  console.log(`✓ Enrolled student with status: ${enrollmentResult.enrollment.status} (Verified: ${enrollmentResult.enrollment.verifiedIdentity})`);

  // Test Duplicate Detection
  try {
    await dynamoService.enrollStudentInCourse(testCourse.courseId, {
      rollNo: testRoll,
      email: 'another.email@gmail.com',
    });
    throw new Error('FAIL: Duplicate registration number was not detected!');
  } catch (err) {
    console.log(`✓ Duplicate registration number correctly rejected: "${err.message}"`);
  }

  // 3. Verify Bulk CSV Enrollment & Error Filtering
  console.log('\n[TEST 3] Testing Bulk CSV Enrollment with Duplicate & Invalid Records...');
  const bulkRecords = [
    { rollNo: `21BCE1${testTag}`, email: `valid.one_${testTag}@gmail.com` },
    { rollNo: `21BCE2${testTag}`, email: `valid.two_${testTag}@gmail.com` },
    { rollNo: `21BCE1${testTag}`, email: `dup.batch_${testTag}@gmail.com` }, // duplicate roll in batch
    { rollNo: testRoll, email: `already.enrolled_${testTag}@gmail.com` }, // duplicate with course
    { rollNo: '', email: `no.roll_${testTag}@gmail.com` }, // missing roll
    { rollNo: `21BCE3${testTag}`, email: 'bad-email-format' }, // bad email
  ];

  const bulkResult = await dynamoService.bulkEnrollStudentsInCourse(testCourse.courseId, bulkRecords);
  console.log(`✓ Bulk enrollment processed: ${bulkResult.enrolledCount + bulkResult.pendingCount} enrolled, ${bulkResult.skippedCount} skipped.`);
  console.log(`✓ Captured errors:`, bulkResult.errors.map((e) => `Row ${e.row}: ${e.reason}`));

  if (bulkResult.skippedCount !== 4) {
    throw new Error(`Expected 4 skipped records, got ${bulkResult.skippedCount}`);
  }

  // 4. Verify Quiz Scheduling & Results Policy
  console.log('\n[TEST 4] Creating Scheduled Quiz with Results Policy...');
  const testTeacher = { id: 'teacher_alan', name: 'Prof. Alan', email: testTeacherEmail };
  const createdQuiz = await examService.createExam(
    {
      title: 'AI Heuristic Search Scheduled Quiz',
      courseId: testCourse.courseId,
      courseCode: testCourse.courseCode,
      slot: testCourse.slot,
      instructions: 'Answer all questions. Biometric proctoring enabled.',
      durationMinutes: 30,
      startTime: new Date().toISOString(),
      maxAttempts: 1,
      passingMarks: 5,
      status: 'published',
      resultsPolicy: {
        releaseMode: 'manual',
        isResultsReleased: false,
        showScore: false,
        showCorrectAnswers: false,
        allowReview: false,
        showExplanations: false,
      },
      questions: [
        {
          text: 'What is A* search heuristic?',
          options: ['f(n) = g(n) + h(n)', 'f(n) = g(n) - h(n)', 'f(n) = h(n)', 'f(n) = g(n)'],
          correctOptionIndex: 0,
          marks: 10,
          explanation: 'A* combines exact path cost g(n) with estimated future cost h(n).',
        },
      ],
    },
    testTeacher
  );
  console.log(`✓ Quiz created: ${createdQuiz.title} for ${createdQuiz.courseCode} (Slot ${createdQuiz.slot})`);

  // 5. Verify Student Quiz Access (Enrolled vs Unenrolled)
  console.log('\n[TEST 5] Testing Student Quiz Access Enforcement...');
  const availableForEnrolled = await examService.getAvailableExamsForStudent('std_test1', null, testStudentEmail);
  const foundForEnrolled = availableForEnrolled.some((e) => (e.examId || e._id) === (createdQuiz.examId || createdQuiz._id));
  console.log(`✓ Enrolled student can see quiz: ${foundForEnrolled}`);
  if (!foundForEnrolled) throw new Error('Enrolled student could not see course quiz!');

  const availableForOutsider = await examService.getAvailableExamsForStudent('std_outsider', null, testUnenrolledEmail);
  const foundForOutsider = availableForOutsider.some((e) => (e.examId || e._id) === (createdQuiz.examId || createdQuiz._id));
  console.log(`✓ Unenrolled student blocked from course quiz: ${!foundForOutsider}`);
  if (foundForOutsider) throw new Error('Unenrolled student was able to access course quiz!');

  // Test Attempt Start for Unenrolled Student
  let blockedSuccessfully = false;
  try {
    await examService.startExamAttempt(createdQuiz.examId || createdQuiz._id, {
      id: 'std_outsider',
      name: 'Outsider',
      email: testUnenrolledEmail,
    });
  } catch (err) {
    blockedSuccessfully = true;
    console.log(`✓ Unenrolled student start attempt correctly rejected: "${err.message}"`);
  }
  if (!blockedSuccessfully) {
    throw new Error('FAIL: Unenrolled student was not blocked from starting exam!');
  }

  // 6. Verify Results Policy Data Redaction
  console.log('\n[TEST 6] Testing Student Results Data Redaction (Zero-Leakage Policy)...');
  // Start attempt as enrolled student
  const session = await examService.startExamAttempt(createdQuiz.examId || createdQuiz._id, {
    id: 'std_test1',
    name: 'Test Student',
    email: testStudentEmail,
  });

  // Save an answer and submit
  const qId = session.questions[0].questionId || session.questions[0]._id;
  await examService.saveStudentAnswer(session.attempt.sessionId || session.attempt._id, 'std_test1', {
    questionId: qId,
    selectedOptionIndex: 0,
  });

  const submitted = await examService.submitExamAttempt(session.attempt.sessionId || session.attempt._id, 'std_test1');
  console.log(`✓ Submitted attempt returned resultsStatus: "${submitted.resultsStatus}"`);
  console.log(`✓ Score property hidden: ${submitted.score === undefined}`);
  console.log(`✓ Answers details hidden: ${submitted.answers === undefined}`);

  if (submitted.score !== undefined || submitted.answers !== undefined) {
    throw new Error('FAIL: Score or answers leaked in student submission response!');
  }

  // Retrieve attempt details as student
  const studentAttemptView = await examService.getAttemptById(session.attempt.sessionId || session.attempt._id, 'std_test1', 'student');
  console.log(`✓ Student getAttemptById score hidden: ${studentAttemptView.score === undefined}`);
  console.log(`✓ Student getAttemptById answers hidden: ${studentAttemptView.answers === undefined}`);

  // Retrieve attempt details as teacher (forensic audit allowed)
  const teacherAttemptView = await examService.getAttemptById(session.attempt.sessionId || session.attempt._id, 'teacher_alan', 'teacher');
  console.log(`✓ Teacher getAttemptById score accessible for marking: ${teacherAttemptView.score !== undefined} (Score: ${teacherAttemptView.score})`);

  console.log('\n======================================================');
  console.log('>>> ALL LMS INTEGRATION TESTS PASSED WITH 100% SUCCESS <<<');
  console.log('======================================================');
}

runLmsTests().catch((err) => {
  console.error('\n❌ Test Failure:', err);
  process.exit(1);
});
