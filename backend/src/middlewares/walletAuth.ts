import { ethers } from 'ethers';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { handleUnauthorizedError } from '../utils/errorHandler.ts';

/**
 * Wallet Signature Authentication Middleware
 *
 * Verifies that the request is signed by the claimed wallet address.
 * Prevents impersonation + signature replay.
 *
 * Expected headers:
 *   x-wallet-address: "0x..." (the claimed wallet address)
 *   x-signature: "0x..." (ethers personal_sign over the message)
 *   x-message: "InjectMe:attack:<challengeAddress>:<timestamp>" (the signed message)
 *
 * Security:
 *   - Timestamp must be within 5 minutes (prevents old signature reuse)
 *   - Signature is bound to a specific wallet address (prevents cross-wallet replay)
 */

export async function walletAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const walletAddress = request.headers['x-wallet-address'] as string;
  const signature = request.headers['x-signature'] as string;
  const message = request.headers['x-message'] as string;

  if (!walletAddress || !signature || !message) {
    await handleUnauthorizedError(reply, 'Missing wallet auth headers (x-wallet-address, x-signature, x-message)');
    return;
  }

  // Verify timestamp is recent (within 5 minutes)
  const parts = message.split(':');
  if (parts.length < 4 || parts[0] !== 'InjectMe') {
    await handleUnauthorizedError(reply, 'Invalid message format. Expected: InjectMe:attack:<challengeAddress>:<timestamp>');
    return;
  }

  const timestamp = Number(parts[3]);
  const now = Date.now();
  const fiveMinutes = 5 * 60 * 1000;

  if (isNaN(timestamp) || Math.abs(now - timestamp) > fiveMinutes) {
    await handleUnauthorizedError(reply, 'Message timestamp expired. Must be within 5 minutes.');
    return;
  }

  // Recover signer from signature
  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);

    if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
      await handleUnauthorizedError(reply, 'Signature does not match wallet address');
      return;
    }

    // Attach verified wallet to request for downstream use
    (request as any).verifiedWallet = recoveredAddress;
  } catch (err) {
    await handleUnauthorizedError(reply, 'Invalid signature');
    return;
  }
}
