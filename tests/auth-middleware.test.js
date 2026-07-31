/**
 * Auth middleware regression (no DB required).
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'ci-test-secret-at-least-16-chars';

let verifyToken;
let authorizeRoles;
let verifyAdmin;
let verifyTeacher;

before(async () => {
  const auth = await import('../middleware/auth.js');
  verifyToken = auth.verifyToken;
  authorizeRoles = auth.authorizeRoles;
  verifyAdmin = auth.verifyAdmin;
  verifyTeacher = auth.verifyTeacher;
});

function mockRes() {
  const res = {
    statusCode: 0,
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
  return res;
}

describe('verifyToken', () => {
  it('rejects missing token', () => {
    const req = { headers: {}, cookies: {} };
    const res = mockRes();
    let next = false;
    verifyToken(req, res, () => {
      next = true;
    });
    assert.equal(next, false);
    assert.equal(res.statusCode, 401);
  });

  it('accepts valid Bearer token', () => {
    const token = jwt.sign(
      { userId: '507f1f77bcf86cd799439011', role: 'student' },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' },
    );
    const req = { headers: { authorization: `Bearer ${token}` }, cookies: {} };
    const res = mockRes();
    let next = false;
    verifyToken(req, res, () => {
      next = true;
    });
    assert.equal(next, true);
    assert.equal(req.user.role, 'student');
    assert.ok(req.userId);
  });

  it('rejects garbage token', () => {
    const req = { headers: { authorization: 'Bearer not.a.jwt' }, cookies: {} };
    const res = mockRes();
    verifyToken(req, res, () => {
      throw new Error('should not next');
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('authorizeRoles', () => {
  it('allows matching role', () => {
    const mw = authorizeRoles('admin', 'super-admin');
    const req = { user: { role: 'admin' } };
    const res = mockRes();
    let next = false;
    mw(req, res, () => {
      next = true;
    });
    assert.equal(next, true);
  });

  it('blocks non-matching role', () => {
    const mw = authorizeRoles('admin');
    const req = { user: { role: 'student' } };
    const res = mockRes();
    mw(req, res, () => {
      throw new Error('should not next');
    });
    assert.equal(res.statusCode, 403);
  });
});

describe('verifyAdmin / verifyTeacher', () => {
  it('verifyAdmin allows admin', () => {
    const req = { user: { role: 'admin' } };
    const res = mockRes();
    let next = false;
    verifyAdmin(req, res, () => {
      next = true;
    });
    assert.equal(next, true);
  });

  it('verifyTeacher blocks student', () => {
    const req = { user: { role: 'student' } };
    const res = mockRes();
    verifyTeacher(req, res, () => {
      throw new Error('should not next');
    });
    assert.equal(res.statusCode, 403);
  });
});
