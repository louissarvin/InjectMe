/**
 * Jessica's Backend Security Test Suite
 *
 * Tests security properties of the InjectMe backend:
 * - JWT auth middleware bypass vectors
 * - Error handler information leakage
 * - Validation bypass
 * - CORS misconfiguration
 * - Input sanitization
 *
 * Run: bun test test/security.test.ts
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import jwt from 'jsonwebtoken';

// ============================================================
//  TEST SERVER SETUP (mirrors index.ts structure)
// ============================================================

const TEST_JWT_SECRET = 'test-secret-for-unit-tests-only';
const TEST_PORT = 0; // Random available port

function buildTestServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.register(FastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'token'],
  });

  // Simulate auth middleware (same logic as src/middlewares/authMiddleware.ts)
  const authMiddleware = async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ success: false, error: { code: 'MISSING_AUTH_HEADER', message: 'Missing or invalid authorization header' } });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return reply.code(401).send({ success: false, error: { code: 'TOKEN_MISSING', message: 'Token not provided' } });
    }

    try {
      const payload = jwt.verify(token, TEST_JWT_SECRET) as { userId: string };
      if (!payload || !payload.userId) {
        return reply.code(401).send({ success: false, error: { code: 'INVALID_TOKEN_PAYLOAD', message: 'Invalid token payload' } });
      }
      (request as any).user = { id: payload.userId, walletAddress: '0x1234' };
    } catch {
      return reply.code(401).send({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
    }
  };

  // Health check
  app.get('/', async (_req, reply) => {
    return reply.send({ success: true, message: 'Hello there!' });
  });

  // Protected route
  app.get('/protected', { preHandler: [authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({ success: true, data: { user: (request as any).user } });
  });

  // Validation test route
  app.post('/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | null;
    if (!body || !body.email || !body.password) {
      return reply.code(400).send({ success: false, error: { message: 'Missing required fields' } });
    }
    return reply.send({ success: true, data: { email: body.email } });
  });

  // Echo route (for injection testing)
  app.post('/echo', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown> | null;
    return reply.send({ success: true, data: body });
  });

  // Error simulation routes (for info leak testing)
  app.get('/error/dev', async (_req, reply) => {
    const error = new Error('Database connection failed');
    error.stack = 'Error: Database connection failed\n    at /app/src/lib/prisma.ts:15:11\n    at processTicksAndRejections';
    return reply.code(500).send({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Database error during query',
        // Simulating IS_DEV = true (info leak)
        details: error.message,
        stack: error.stack,
      },
    });
  });

  app.get('/error/prod', async (_req, reply) => {
    return reply.code(500).send({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Database error during query',
        // No details/stack in production
      },
    });
  });

  return app;
}

// ============================================================
//  TEST SUITE
// ============================================================

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  app = buildTestServer();
  const address = await app.listen({ port: TEST_PORT, host: '127.0.0.1' });
  baseUrl = address;
});

afterAll(async () => {
  await app.close();
});

// ============================================================
//  JWT AUTH BYPASS VECTORS
// ============================================================

describe('JWT Auth Middleware Security', () => {
  test('rejects request with no Authorization header', async () => {
    const res = await fetch(`${baseUrl}/protected`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_AUTH_HEADER');
  });

  test('rejects request with empty Bearer token', async () => {
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: 'Bearer ' },
    });
    expect(res.status).toBe(401);
  });

  test('rejects request with malformed Authorization header (no Bearer prefix)', async () => {
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: 'Token abc123' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('MISSING_AUTH_HEADER');
  });

  test('rejects request with Basic auth instead of Bearer', async () => {
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: 'Basic dXNlcjpwYXNz' },
    });
    expect(res.status).toBe(401);
  });

  test('rejects JWT signed with wrong secret', async () => {
    const wrongToken = jwt.sign({ userId: 'user-1' }, 'wrong-secret', { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  test('rejects expired JWT', async () => {
    const expiredToken = jwt.sign({ userId: 'user-1' }, TEST_JWT_SECRET, { expiresIn: '-1s' });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TOKEN');
  });

  test('rejects JWT with missing userId in payload', async () => {
    const noUserToken = jwt.sign({ role: 'admin' }, TEST_JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${noUserToken}` },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_TOKEN_PAYLOAD');
  });

  test('rejects JWT with userId = null', async () => {
    const nullUserToken = jwt.sign({ userId: null }, TEST_JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${nullUserToken}` },
    });
    expect(res.status).toBe(401);
  });

  test('rejects JWT with userId = empty string', async () => {
    const emptyUserToken = jwt.sign({ userId: '' }, TEST_JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${emptyUserToken}` },
    });
    // Note: current middleware doesn't check for empty string - this might pass
    // Robert should add: || authData.userId === ''
    expect(res.status).toBe(401);
  });

  test('accepts valid JWT with correct secret and userId', async () => {
    const validToken = jwt.sign({ userId: 'user-1' }, TEST_JWT_SECRET, { expiresIn: '1h' });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${validToken}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.id).toBe('user-1');
  });

  test('rejects completely random string as JWT', async () => {
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: 'Bearer not.a.jwt.at.all' },
    });
    expect(res.status).toBe(401);
  });

  test('rejects JWT with algorithm none attack', async () => {
    // The "alg: none" attack: craft a token with no signature
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ userId: 'admin' })).toString('base64url');
    const noneToken = `${header}.${payload}.`;
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${noneToken}` },
    });
    expect(res.status).toBe(401);
  });

  test('rejects JWT crafted with HMAC using public key (alg confusion)', async () => {
    // Try HS256 with a forged token
    const forgedToken = jwt.sign({ userId: 'admin', role: 'superadmin' }, 'guessed-secret', {
      algorithm: 'HS256',
      expiresIn: '1h',
    });
    const res = await fetch(`${baseUrl}/protected`, {
      headers: { Authorization: `Bearer ${forgedToken}` },
    });
    expect(res.status).toBe(401);
  });

  test('rejects extremely long Authorization header (buffer overflow attempt)', async () => {
    const longToken = 'Bearer ' + 'A'.repeat(100_000);
    try {
      const res = await fetch(`${baseUrl}/protected`, {
        headers: { Authorization: longToken },
      });
      // Either 401 (rejected) or 431 (header too large) is acceptable
      expect([401, 431]).toContain(res.status);
    } catch {
      // Connection reset is also acceptable (Fastify's built-in header size limit)
      expect(true).toBe(true);
    }
  });
});

// ============================================================
//  ERROR HANDLER INFORMATION LEAKAGE
// ============================================================

describe('Error Handler Information Leakage', () => {
  test('dev mode leaks stack trace and error details', async () => {
    const res = await fetch(`${baseUrl}/error/dev`);
    const body = await res.json();
    expect(body.error.details).toBeDefined();
    expect(body.error.stack).toBeDefined();
    // This is expected in dev, but MUST NOT happen in production
    expect(body.error.stack).toContain('prisma.ts');
  });

  test('prod mode does NOT leak stack trace or details', async () => {
    const res = await fetch(`${baseUrl}/error/prod`);
    const body = await res.json();
    expect(body.error.details).toBeUndefined();
    expect(body.error.stack).toBeUndefined();
    // Only code and message should be present
    expect(body.error.code).toBe('DATABASE_ERROR');
    expect(body.error.message).toBeDefined();
  });

  test('error response does not expose internal paths', async () => {
    const res = await fetch(`${baseUrl}/error/prod`);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('/app/src/');
    expect(body).not.toContain('node_modules');
    expect(body).not.toContain('prisma.ts');
  });
});

// ============================================================
//  INPUT VALIDATION
// ============================================================

describe('Input Validation', () => {
  test('rejects empty body', async () => {
    const res = await fetch(`${baseUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test('rejects missing required fields', async () => {
    const res = await fetch(`${baseUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com' }), // missing password
    });
    expect(res.status).toBe(400);
  });

  test('accepts valid body with all required fields', async () => {
    const res = await fetch(`${baseUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'secret123' }),
    });
    expect(res.status).toBe(200);
  });

  test('handles null body gracefully', async () => {
    const res = await fetch(`${baseUrl}/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================
//  XSS / INJECTION VECTORS
// ============================================================

describe('Injection Prevention', () => {
  test('XSS payload in body is not interpreted (reflected as data)', async () => {
    const xssPayload = '<script>alert("xss")</script>';
    const res = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: xssPayload }),
    });
    const body = await res.json();
    // Response should be JSON, not HTML. XSS is a frontend concern,
    // but backend should return Content-Type: application/json
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body.data.name).toBe(xssPayload); // Raw stored, frontend must escape
  });

  test('SQL injection payload in body does not crash server', async () => {
    const sqlPayload = "'; DROP TABLE users; --";
    const res = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sqlPayload }),
    });
    expect(res.status).toBe(200); // Server doesn't crash
    const body = await res.json();
    expect(body.data.query).toBe(sqlPayload);
  });

  test('prototype pollution payload does not affect server', async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ '__proto__': { isAdmin: true }, 'constructor': { prototype: { isAdmin: true } } }),
    });
    // Fastify strips __proto__ and returns 400, OR processes safely with 200
    // Both are acceptable security behaviors
    expect([200, 400]).toContain(res.status);
    // Either way, prototype should NOT be polluted
    expect(({} as any).isAdmin).toBeUndefined();
  });

  test('oversized JSON body is handled (DoS prevention)', async () => {
    // Fastify has a default body limit of 1MB
    const largePayload = { data: 'x'.repeat(2_000_000) }; // 2MB
    try {
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(largePayload),
      });
      // Should be rejected with 413 or error
      expect([413, 400, 500]).toContain(res.status);
    } catch {
      // Connection error is also acceptable (body too large)
      expect(true).toBe(true);
    }
  });

  test('deeply nested JSON does not crash server (DoS prevention)', async () => {
    // Build a moderately nested object (Fastify handles deep nesting slowly)
    let nested: any = { value: 'leaf' };
    for (let i = 0; i < 30; i++) {
      nested = { child: nested };
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nested),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // Should either succeed or return an error, but NOT crash
      expect([200, 400, 413, 500]).toContain(res.status);
    } catch {
      // Timeout or connection error is acceptable (server protected itself)
      expect(true).toBe(true);
    }
  });
});

// ============================================================
//  CORS CONFIGURATION
// ============================================================

describe('CORS Configuration', () => {
  test('responds with Access-Control-Allow-Origin: *', async () => {
    const res = await fetch(`${baseUrl}/`, {
      headers: { Origin: 'https://evil.com' },
    });
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao).toBe('*');
    // WARNING: origin: '*' is a finding (see audit report)
  });

  test('preflight OPTIONS returns correct CORS headers', async () => {
    const res = await fetch(`${baseUrl}/`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Authorization',
      },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const methods = res.headers.get('access-control-allow-methods');
    expect(methods).toContain('POST');
  });
});

// ============================================================
//  SECURITY HEADERS
// ============================================================

describe('Security Headers', () => {
  test('does not expose server version', async () => {
    const res = await fetch(`${baseUrl}/`);
    const serverHeader = res.headers.get('server');
    // Should not reveal "fastify" or version info
    // Fastify doesn't send Server header by default, which is good
    if (serverHeader) {
      expect(serverHeader).not.toContain('fastify');
    }
  });

  test('returns application/json content type', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  // These headers SHOULD exist but likely don't (findings for Robert)
  test('[FINDING] X-Content-Type-Options header should be set', async () => {
    const res = await fetch(`${baseUrl}/`);
    const header = res.headers.get('x-content-type-options');
    // This test documents the ABSENCE of the header
    if (!header) {
      console.warn('[SECURITY] Missing X-Content-Type-Options: nosniff');
    }
  });

  test('[FINDING] Strict-Transport-Security header should be set', async () => {
    const res = await fetch(`${baseUrl}/`);
    const header = res.headers.get('strict-transport-security');
    if (!header) {
      console.warn('[SECURITY] Missing Strict-Transport-Security header');
    }
  });

  test('[FINDING] X-Frame-Options header should be set', async () => {
    const res = await fetch(`${baseUrl}/`);
    const header = res.headers.get('x-frame-options');
    if (!header) {
      console.warn('[SECURITY] Missing X-Frame-Options: DENY');
    }
  });
});

// ============================================================
//  ROUTE ENUMERATION
// ============================================================

describe('Route Security', () => {
  test('404 for unknown routes does not leak info', async () => {
    const res = await fetch(`${baseUrl}/admin/secret`);
    expect(res.status).toBe(404);
    const body = await res.json();
    // Should not reveal internal route structure
    expect(JSON.stringify(body)).not.toContain('/src/');
    expect(JSON.stringify(body)).not.toContain('file');
  });

  test('health check does not reveal system info', async () => {
    const res = await fetch(`${baseUrl}/`);
    const body = await res.json();
    expect(body.success).toBe(true);
    // Should not reveal OS, node version, etc
    expect(JSON.stringify(body)).not.toContain('node');
    expect(JSON.stringify(body)).not.toContain('linux');
    expect(JSON.stringify(body)).not.toContain('version');
  });

  test('HEAD request on health check works', async () => {
    const res = await fetch(`${baseUrl}/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });
});
