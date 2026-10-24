import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import dynamoService from './dynamo/dynamo.service.js';
import { ROLES, normalizeRole, isTeacherRole } from '../utils/roles.js';

/**
 * User Service - Backed by Amazon DynamoDB Students Table & Cognito
 */

// Memory fallback cache for local dev fast access
const memoryUsers = new Map();

const seedMemoryStore = async () => {
  if (memoryUsers.size === 0) {
    const salt = await bcrypt.genSalt(10);
    const teacherHash = await bcrypt.hash('Teacher@123', salt);
    const studentHash = await bcrypt.hash('Student@123', salt);

    const teacher = {
      studentId: 'mem_teacher_01',
      _id: 'mem_teacher_01',
      name: 'Prof. Vikram Rao',
      email: 'teacher@adaptive.edu',
      password: teacherHash,
      role: 'teacher',
      department: 'Department of Computer Science',
      status: 'active',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const student = {
      studentId: 'mem_student_01',
      _id: 'mem_student_01',
      name: 'Aarav Patel',
      email: 'student@adaptive.edu',
      password: studentHash,
      role: 'student',
      department: 'Computer Science & Engineering',
      rollNo: 'CS-2026-042',
      status: 'enrolled',
      isActive: true,
      faceIds: ['face-seed-01', 'face-seed-02', 'face-seed-03'],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    memoryUsers.set(teacher.email, teacher);
    memoryUsers.set(student.email, student);

    await dynamoService.putStudent(teacher);
    await dynamoService.putStudent(student);
  }
};

seedMemoryStore();

export const generateToken = (userId, role) => {
  return jwt.sign(
    { id: userId, sub: userId, role, 'custom:role': role },
    env.JWT_SECRET || 'dev_secret',
    { expiresIn: env.JWT_EXPIRES_IN || '24h' }
  );
};

export const findUserByEmail = async (email) => {
  const normalized = email.trim().toLowerCase();
  if (memoryUsers.has(normalized)) {
    return memoryUsers.get(normalized);
  }

  // Look up in DynamoDB via deterministic email pointer
  const found = await dynamoService.getStudentByEmail(normalized);
  if (found) {
    memoryUsers.set(normalized, found);
    return found;
  }
  return null;
};

export const findUserById = async (userId) => {
  for (const user of memoryUsers.values()) {
    if (user.studentId === userId || user._id === userId) return user;
  }
  return dynamoService.getStudent(userId);
};

export const findUserByCognitoSub = async (cognitoSub) => {
  if (!cognitoSub) return null;
  for (const user of memoryUsers.values()) {
    if (user.cognitoSub === cognitoSub) return user;
  }
  const bySub = await dynamoService.getStudentByCognitoSub(cognitoSub);
  if (bySub) {
    if (bySub.email) memoryUsers.set(bySub.email.toLowerCase(), bySub);
    return bySub;
  }
  return null;
};

// Institutional Administrator-Authorized Teacher Registry
const TRUSTED_TEACHER_EMAILS = new Set([
  'teacher@adaptive.edu',
  'admin@adaptive.edu',
  'prof.vikram@adaptive.edu',
  'stasissoftwarepvtltd@gmail.com', // Explicitly authorized educator account
]);

// Dynamically load approved teacher emails from environment if provided
if (process.env.APPROVED_TEACHER_EMAILS) {
  process.env.APPROVED_TEACHER_EMAILS.split(',').forEach((e) => {
    if (e.trim()) TRUSTED_TEACHER_EMAILS.add(e.trim().toLowerCase());
  });
}

export const isTrustedTeacherEmail = (email) => {
  if (!email) return false;
  return TRUSTED_TEACHER_EMAILS.has(email.trim().toLowerCase());
};

export const addTrustedTeacherEmail = (email) => {
  if (!email) return;
  TRUSTED_TEACHER_EMAILS.add(email.trim().toLowerCase());
};

/**
 * Synchronize verified Cognito Identity with database profile.
 * - Prevents duplicate user records by matching on verified Cognito sub first.
 * - Enforces authoritative role governance: Students cannot self-elevate without admin authorization.
 * - Diagnoses and repairs existing teacher accounts with clear audit trails.
 */
export const syncCognitoIdentity = async ({ sub, email, name, roleGroup, intendedRole }) => {
  const normalizedEmail = (email || '').trim().toLowerCase();

  // 1. Check by Cognito Sub first
  let user = await findUserByCognitoSub(sub);

  // 2. If not found by sub, check by email
  if (!user && normalizedEmail) {
    user = await findUserByEmail(normalizedEmail);
  }

  const isAuthorizedTeacher =
    isTrustedTeacherEmail(normalizedEmail) ||
    isTeacherRole(roleGroup);

  if (user) {
    let updated = false;

    // Link Cognito Sub if not already linked
    if (!user.cognitoSub && sub) {
      user.cognitoSub = sub;
      updated = true;
    }

    // Role synchronization with authoritative governance:
    // If the account has been approved as a Teacher but was previously stored as Student,
    // safely promote with full audit log.
    if (isAuthorizedTeacher && user.role !== ROLES.TEACHER) {
      console.info(`[Auth Role Sync]: Elevated account ${normalizedEmail} to authoritative role '${ROLES.TEACHER}' via institutional authorization.`);
      user.role = ROLES.TEACHER;
      user.status = 'active';
      user.department = user.department || 'Faculty of Computing & Examination';
      updated = true;
    } else if (!isAuthorizedTeacher && intendedRole === 'teacher' && user.role !== ROLES.TEACHER) {
      // Diagnostic log: student attempting to access teacher workspace without admin approval
      console.warn(`[Auth Diagnostic]: Account ${normalizedEmail} has role '${user.role}' and requested 'teacher' workspace without administrator approval.`);
    }

    if (updated) {
      user.updatedAt = new Date().toISOString();
      memoryUsers.set(normalizedEmail, user);
      await dynamoService.putStudent(user);
    }
    return user;
  }

  // 3. Brand new user: Determine authoritative role
  const authoritativeRole = isAuthorizedTeacher ? ROLES.TEACHER : ROLES.STUDENT;

  const id = authoritativeRole === ROLES.TEACHER
    ? `COG-TCH-${Date.now().toString(36).toUpperCase()}`
    : `COG-STU-${Date.now().toString(36).toUpperCase()}`;

  const displayName = name || normalizedEmail.split('@')[0];

  const newUser = {
    _id: id,
    studentId: id,
    cognitoSub: sub || null,
    name: displayName,
    email: normalizedEmail,
    role: authoritativeRole,
    department: authoritativeRole === ROLES.TEACHER ? 'Faculty of Computing & Examination' : 'School of Engineering',
    status: authoritativeRole === ROLES.TEACHER ? 'active' : 'enrolled',
    isActive: true,
    faceIds: [],
    baselineImageKeys: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memoryUsers.set(normalizedEmail, newUser);
  await dynamoService.putStudent(newUser);

  return newUser;
};

export const createUser = async ({
  name,
  email,
  password,
  role = 'student',
  studentId,
  department,
  cognitoSub = null,
}) => {
  const normalizedEmail = (email || '').trim().toLowerCase();
  const canonicalRole = normalizeRole(role);
  const isAuthorizedTeacher = isTrustedTeacherEmail(normalizedEmail) || isTeacherRole(role);
  const finalRole = isAuthorizedTeacher ? ROLES.TEACHER : canonicalRole;

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const id = studentId || `usr-${Date.now().toString(36)}`;
  const newUser = {
    studentId: id,
    _id: id,
    cognitoSub,
    name,
    email: normalizedEmail,
    password: hashedPassword,
    role: finalRole,
    department: department || (finalRole === ROLES.TEACHER ? 'Faculty of Computing & Examination' : 'School of Engineering'),
    rollNo: studentId || null,
    status: finalRole === ROLES.TEACHER ? 'active' : 'enrolled',
    isActive: true,
    isConfirmed: isConfirmed ?? (finalRole === ROLES.TEACHER || false),
    faceIds: [],
    baselineImageKeys: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  memoryUsers.set(normalizedEmail, newUser);
  await dynamoService.putStudent(newUser);

  return newUser;
};

export const setUserConfirmationStatus = async (email, isConfirmed) => {
  const normalized = (email || '').trim().toLowerCase();
  const user = await findUserByEmail(normalized);
  if (user) {
    user.isConfirmed = isConfirmed;
    if (isConfirmed && user.status === 'unconfirmed') {
      user.status = user.role === ROLES.TEACHER ? 'active' : 'enrolled';
    }
    user.updatedAt = new Date().toISOString();
    memoryUsers.set(normalized, user);
    await dynamoService.putStudent(user);
    return user;
  }
  return null;
};

export const verifyPassword = async (plainPassword, hashedPassword) => {
  return bcrypt.compare(plainPassword, hashedPassword);
};

export const updateUserRole = async (userIdOrEmail, newRole) => {
  const canonicalRole = normalizeRole(newRole);
  const key = (userIdOrEmail || '').trim().toLowerCase();

  if (canonicalRole === ROLES.TEACHER && key.includes('@')) {
    addTrustedTeacherEmail(key);
  }

  let user = null;
  for (const u of memoryUsers.values()) {
    if (
      u.studentId === userIdOrEmail ||
      u._id === userIdOrEmail ||
      u.email?.toLowerCase() === key ||
      u.cognitoSub === userIdOrEmail
    ) {
      user = u;
      break;
    }
  }

  if (!user) {
    user = await findUserByEmail(key);
  }
  if (!user) {
    user = await findUserById(userIdOrEmail);
  }

  if (user) {
    user.role = canonicalRole;
    user.status = canonicalRole === ROLES.TEACHER ? 'active' : 'enrolled';
    user.updatedAt = new Date().toISOString();
    memoryUsers.set(user.email.toLowerCase(), user);
    await dynamoService.putStudent(user);
    console.info(`[Auth Role Update]: Role for ${user.email} successfully updated to '${canonicalRole}'.`);
    return user;
  }
  return null;
};

export const updateUserPassword = async (email, newPassword) => {
  const normalized = email.trim().toLowerCase();
  const user = await findUserByEmail(normalized);
  if (user) {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    memoryUsers.set(normalized, user);
    await dynamoService.putStudent(user);
    return user;
  }
  return null;
};

export const enrollStudentReferenceImage = async (userIdOrEmail, imageBase64) => {
  const key = (userIdOrEmail || '').trim().toLowerCase();
  let user = null;
  for (const u of memoryUsers.values()) {
    if (
      u.studentId === userIdOrEmail ||
      u._id === userIdOrEmail ||
      u.email?.toLowerCase() === key ||
      u.cognitoSub === userIdOrEmail
    ) {
      user = u;
      break;
    }
  }
  if (!user) user = await findUserByEmail(key);
  if (!user) user = await findUserById(userIdOrEmail);

  if (!user) {
    throw new Error('User profile not found for face identity enrollment');
  }

  // 1. Validate image has exactly 1 valid face
  const { detectFaces } = await import('./aws/rekognition.service.js');
  const faceCheck = await detectFaces(imageBase64);

  if (faceCheck.mode === 'aws-live' && !faceCheck.success) {
    // If AWS failed with permission or network error, do not fail silently
    throw new Error(`Face validation unavailable: ${faceCheck.error || 'Amazon Rekognition unavailable'}`);
  }

  if (faceCheck.faceCount === 0) {
    throw new Error('No face detected in reference photo. Please ensure your face is clearly visible and well-lit.');
  }

  if (faceCheck.faceCount > 1) {
    throw new Error('Multiple faces detected in reference photo. Only the candidate should be present in the frame.');
  }

  // 2. Upload to S3 baseline storage
  const { uploadBaselinePhoto } = await import('./aws/s3.service.js');
  const uid = user.studentId || user._id || `stu_${Date.now()}`;
  const s3Result = await uploadBaselinePhoto(uid, 1, imageBase64);

  user.baselineImageKeys = [s3Result.key];
  user.avatar = s3Result.url;
  user.referencePhotoBase64 = imageBase64; // Cached for fast local & live comparison
  user.updatedAt = new Date().toISOString();

  memoryUsers.set(user.email.toLowerCase(), user);
  await dynamoService.putStudent(user);

  return {
    success: true,
    studentId: user.studentId,
    email: user.email,
    referencePhotoKey: s3Result.key,
    referencePhotoUrl: s3Result.url,
    faceConfidence: faceCheck.faces?.[0]?.confidence || 99,
  };
};

export const getStudentReferenceImage = async (userIdOrEmail) => {
  const key = (userIdOrEmail || '').trim().toLowerCase();
  let user = null;
  for (const u of memoryUsers.values()) {
    if (
      u.studentId === userIdOrEmail ||
      u._id === userIdOrEmail ||
      u.email?.toLowerCase() === key ||
      u.cognitoSub === userIdOrEmail
    ) {
      user = u;
      break;
    }
  }
  if (!user) user = await findUserByEmail(key);
  if (!user) user = await findUserById(userIdOrEmail);

  if (!user) return null;

  return {
    studentId: user.studentId,
    email: user.email,
    hasReferenceImage: !!(user.baselineImageKeys?.length || user.referencePhotoBase64 || user.avatar),
    referencePhotoKey: user.baselineImageKeys?.[0] || null,
    referencePhotoUrl: user.avatar || null,
    referencePhotoBase64: user.referencePhotoBase64 || null,
  };
};

export default {
  generateToken,
  findUserByEmail,
  findUserById,
  findUserByCognitoSub,
  createUser,
  verifyPassword,
  updateUserRole,
  updateUserPassword,
  syncCognitoIdentity,
  isTrustedTeacherEmail,
  addTrustedTeacherEmail,
  enrollStudentReferenceImage,
  getStudentReferenceImage,
};
