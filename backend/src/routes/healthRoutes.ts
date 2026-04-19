import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { OG_RPC_URL, FACTORY_ADDRESS, AGENT_NFT_ADDRESS, OG_COMPUTE_PROVIDER, OG_STORAGE_INDEXER } from '../config/main-config.ts';
import { ethers } from 'ethers';

/**
 * Health and monitoring endpoints.
 * Shows judges (and operators) the system status at a glance.
 */
export const healthRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  /** Detailed health check with all 0G pillar statuses */
  app.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const checks: Record<string, { status: string; latency?: number; detail?: string }> = {};

    // 0G Chain
    try {
      const start = Date.now();
      const provider = new ethers.JsonRpcProvider(OG_RPC_URL);
      const blockNumber = await provider.getBlockNumber();
      checks['0g_chain'] = {
        status: 'ok',
        latency: Date.now() - start,
        detail: `Block #${blockNumber}`,
      };
    } catch (err) {
      checks['0g_chain'] = { status: 'error', detail: (err as Error).message };
    }

    // 0G Storage Indexer
    try {
      const start = Date.now();
      const res = await fetch(OG_STORAGE_INDEXER, { method: 'GET', signal: AbortSignal.timeout(5000) });
      checks['0g_storage'] = {
        status: res.ok || res.status === 405 ? 'ok' : 'degraded',
        latency: Date.now() - start,
        detail: `HTTP ${res.status}`,
      };
    } catch (err) {
      checks['0g_storage'] = { status: 'error', detail: (err as Error).message };
    }

    // Contract configuration
    checks['contracts'] = {
      status: FACTORY_ADDRESS && AGENT_NFT_ADDRESS ? 'ok' : 'not_configured',
      detail: FACTORY_ADDRESS ? `Factory: ${FACTORY_ADDRESS.slice(0, 10)}...` : 'FACTORY_ADDRESS missing',
    };

    // Compute provider
    checks['0g_compute'] = {
      status: OG_COMPUTE_PROVIDER ? 'configured' : 'not_configured',
      detail: OG_COMPUTE_PROVIDER ? `Provider: ${OG_COMPUTE_PROVIDER.slice(0, 10)}...` : 'OG_COMPUTE_PROVIDER missing',
    };

    const allOk = Object.values(checks).every(c => c.status === 'ok' || c.status === 'configured');

    return reply.code(allOk ? 200 : 503).send({
      success: true,
      error: null,
      data: {
        status: allOk ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        network: OG_RPC_URL.includes('testnet') ? 'testnet' : 'mainnet',
        checks,
      },
    });
  });

  done();
};
