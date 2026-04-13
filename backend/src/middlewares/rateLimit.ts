import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * In-memory rate limiter per IP and per verified wallet.
 *
 * C-3 fix:
 * - IP: uses only request.ip (Fastify trustProxy handles x-forwarded-for safely)
 * - Wallet: uses ONLY verifiedWallet from walletAuth middleware (no body.attacker fallback)
 */

interface RateEntry {
  count: number;
  resetAt: number;
}

const ipLimits = new Map<string, RateEntry>();
const walletLimits = new Map<string, RateEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of ipLimits) {
    if (now > entry.resetAt) ipLimits.delete(key);
  }
  for (const [key, entry] of walletLimits) {
    if (now > entry.resetAt) walletLimits.delete(key);
  }
}, 5 * 60 * 1000);

function checkLimit(
  store: Map<string, RateEntry>,
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count++;

  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt,
  };
}

/** General rate limit: 30 req/min per IP */
export async function rateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // C-3 fix: only use request.ip (Fastify trustProxy handles forwarded headers)
  const ip = request.ip || 'unknown';
  const { allowed, remaining, resetAt } = checkLimit(ipLimits, ip, 30, 60_000);

  reply.header('X-RateLimit-Remaining', remaining);
  reply.header('X-RateLimit-Reset', Math.ceil(resetAt / 1000));

  if (!allowed) {
    reply.code(429).send({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' },
      data: null,
    });
  }
}

/** Attack-specific rate limit: 10 attacks/min per verified wallet */
export async function attackRateLimitMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // C-3 fix: ONLY use verifiedWallet from walletAuth middleware
  // Never fall back to body.attacker (user-controlled, trivially spoofed)
  const wallet = (request as any).verifiedWallet;
  if (!wallet) {
    reply.code(401).send({
      success: false,
      error: { code: 'WALLET_REQUIRED', message: 'Wallet authentication required for attacks' },
      data: null,
    });
    return;
  }

  const { allowed, remaining, resetAt } = checkLimit(walletLimits, wallet.toLowerCase(), 10, 60_000);

  reply.header('X-Attack-RateLimit-Remaining', remaining);
  reply.header('X-Attack-RateLimit-Reset', Math.ceil(resetAt / 1000));

  if (!allowed) {
    reply.code(429).send({
      success: false,
      error: { code: 'ATTACK_RATE_LIMITED', message: 'Too many attacks. Wait before trying again.' },
      data: null,
    });
  }
}
