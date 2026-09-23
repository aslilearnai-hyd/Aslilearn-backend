/**
 * Create → soft-delete → recreate same email, plus active duplicate still blocked.
 * Uses in-memory User/Class mocks (no live MongoDB).
 * Run: node --experimental-test-module-mocks --test tests/student-recreate-after-delete.test.js
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-at-least-16-chars';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/aslilearn_student_recreate_test';
process.env.WEEKLY_IMPACT_CRON = 'off';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const users = [];
const classes = [];

function thenable(value) {
  const p = Promise.resolve(value);
  const q = {
    select: () => q,
    lean: () => q,
    then: (resolve, reject) => p.then(resolve, reject),
    catch: (reject) => p.catch(reject),
  };
  return q;
}

function matches(doc, filter = {}) {
  for (const [key, value] of Object.entries(filter)) {
    if (key === 'deletedAt' && (value === null || value === undefined)) {
      if (doc.deletedAt) return false;
      continue;
    }
    if (String(doc[key] ?? '') !== String(value ?? '')) return false;
  }
  return true;
}

class FakeUser {
  constructor(data = {}) {
    Object.assign(this, data);
    this._id = data._id || new mongoose.Types.ObjectId();
  }

  async save() {
    const idx = users.findIndex((u) => String(u._id) === String(this._id));
    if (idx >= 0) users[idx] = this;
    else users.push(this);
    return this;
  }

  static findById(id) {
    return thenable(users.find((u) => String(u._id) === String(id)) || null);
  }

  static findOne(filter) {
    return thenable(users.find((u) => matches(u, filter)) || null);
  }

  static async findOneAndUpdate(filter, update) {
    const doc = users.find((u) => matches(u, filter));
    if (!doc) return null;
    Object.assign(doc, update.$set || update);
    return doc;
  }

  static async countDocuments(filter) {
    return users.filter((u) => matches(u, filter)).length;
  }
}

mock.module('../models/User.js', { defaultExport: FakeUser });
mock.module('../models/School.js', {
  defaultExport: {
    findOne: () => thenable(null),
    findById: () => thenable(null),
  },
});
mock.module('../models/Teacher.js', {
  defaultExport: {
    countDocuments: async () => 0,
    findById: () => thenable(null),
  },
});
mock.module('../models/Class.js', {
  defaultExport: {
    findOne: async (filter) => classes.find((c) => matches(c, filter)) || null,
    create: async (data) => {
      const doc = { ...data, _id: new mongoose.Types.ObjectId() };
      classes.push(doc);
      return doc;
    },
  },
});

const { createStudent, deleteStudent } = await import('../controllers/adminController.js');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function seedAdmin() {
  users.length = 0;
  classes.length = 0;
  const admin = new FakeUser({
    role: 'admin',
    email: 'school-admin@example.com',
    fullName: 'School Admin',
    board: 'CBSE',
    schoolName: 'Test School',
    isActive: true,
    deletedAt: null,
    licensedStudents: 0,
  });
  await admin.save();
  return admin;
}

function studentReq(admin, body, params = {}) {
  return {
    adminId: String(admin._id),
    userId: String(admin._id),
    user: { id: String(admin._id), role: 'admin', email: admin.email },
    body,
    params,
  };
}

describe('POST /students after DELETE /students', () => {
  it('Create A → Delete A → Create A with the same email succeeds', async () => {
    const admin = await seedAdmin();
    const email = 'student-a@example.com';
    const createBody = {
      email,
      password: 'secret12',
      fullName: 'Student A',
      classNumber: '7',
      section: 'A',
      phone: '9876543210',
    };

    const createdRes = mockRes();
    await createStudent(studentReq(admin, createBody), createdRes);
    assert.equal(createdRes.statusCode, 201, createdRes.body?.message);
    assert.equal(createdRes.body.success, true);
    const studentId = createdRes.body.data.id;

    const deletedRes = mockRes();
    await deleteStudent(studentReq(admin, {}, { id: String(studentId) }), deletedRes);
    assert.equal(deletedRes.statusCode, 200, deletedRes.body?.message);
    const stored = users.find((u) => String(u._id) === String(studentId));
    assert.ok(stored.deletedAt, 'delete must be a soft delete');
    assert.equal(stored.isActive, false);

    const recreatedRes = mockRes();
    await createStudent(
      studentReq(admin, { ...createBody, fullName: 'Student A Restored' }),
      recreatedRes,
    );
    assert.equal(recreatedRes.statusCode, 201, recreatedRes.body?.message);
    assert.equal(recreatedRes.body.success, true);
    assert.equal(recreatedRes.body.data.email, email);
    assert.equal(recreatedRes.body.data.fullName, 'Student A Restored');
    assert.equal(recreatedRes.body.data.isActive, true);
    assert.equal(String(recreatedRes.body.data.id), String(studentId));
    assert.equal(users.filter((u) => u.email === email).length, 1);
    assert.equal(stored.deletedAt, null);
  });

  it('Create B → Create B again without deleting still returns 400', async () => {
    const admin = await seedAdmin();
    const createBody = {
      email: 'student-b@example.com',
      password: 'secret12',
      fullName: 'Student B',
      classNumber: '8',
      section: 'A',
    };

    const first = mockRes();
    await createStudent(studentReq(admin, createBody), first);
    assert.equal(first.statusCode, 201, first.body?.message);

    const second = mockRes();
    await createStudent(studentReq(admin, createBody), second);
    assert.equal(second.statusCode, 400);
    assert.equal(second.body.success, false);
    assert.equal(second.body.message, 'Student with this email already exists');
    assert.equal(users.filter((u) => u.email === createBody.email).length, 1);
  });
});
