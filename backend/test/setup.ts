// Test environment setup - runs before any test imports
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY || '0x' + 'ab'.repeat(32);
process.env.NODE_ENV = 'test';
