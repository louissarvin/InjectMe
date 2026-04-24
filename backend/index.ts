import './dotenv.ts';

import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import FastifyCors from '@fastify/cors';
import FastifyHelmet from '@fastify/helmet';
import { APP_PORT, IS_PROD } from './src/config/main-config.ts';

// Routes
import { exampletRoute } from './src/routes/exampleRoutes.ts';
import { challengeRoutes } from './src/routes/challengeRoutes.ts';
import { healthRoutes } from './src/routes/healthRoutes.ts';
import { agentRoutes } from './src/routes/agentRoutes.ts';
import { oracleRoutes } from './src/routes/oracleRoutes.ts';
import { trainingRoutes } from './src/routes/trainingRoutes.ts';

// Workers
import { startErrorLogCleanupWorker } from './src/workers/errorLogCleanup.ts';
import { startEventIndexer } from './src/workers/eventIndexer.ts';
import { startChallengeExpiryWorker } from './src/workers/challengeExpiry.ts';
import { startFineTuningMonitor } from './src/workers/fineTuningMonitor.ts';

console.log(
  '======================\n======================\nINJECTME BACKEND STARTED!\n======================\n======================\n'
);

const fastify = Fastify({
  logger: IS_PROD, // Audit fix: enable logger in production for audit trail
  trustProxy: true, // C-3 fix: trust reverse proxy for correct request.ip
});

// Security headers (audit fix: adds X-Content-Type-Options, X-Frame-Options, etc.)
fastify.register(FastifyHelmet, {
  contentSecurityPolicy: false, // Disable CSP for API server
});

// CORS (audit fix: restrict origin in production)
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['*'];

fastify.register(FastifyCors, {
  origin: IS_PROD ? ALLOWED_ORIGINS : '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'token',
    'x-wallet-address', 'x-signature', 'x-message', // Wallet auth headers
  ],
});

// Health check endpoint
fastify.get('/', async (_request: FastifyRequest, reply: FastifyReply) => {
  return reply.status(200).send({
    success: true,
    message: 'InjectMe API',
    error: null,
    data: null,
  });
});

// Register routes
fastify.register(exampletRoute, { prefix: '/example' });
fastify.register(challengeRoutes, { prefix: '/challenge' });
fastify.register(healthRoutes, { prefix: '/health' });
fastify.register(agentRoutes, { prefix: '/agent' });
fastify.register(oracleRoutes, { prefix: '/oracle' });
fastify.register(trainingRoutes, { prefix: '/training' });

const start = async (): Promise<void> => {
  try {
    // Start workers
    startErrorLogCleanupWorker();
    startEventIndexer();
    startChallengeExpiryWorker();
    startFineTuningMonitor();

    await fastify.listen({
      port: APP_PORT,
      host: '0.0.0.0',
    });

    const address = fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : APP_PORT;

    console.log(`Server started successfully on port ${port}`);
    console.log(`http://localhost:${port}`);
    console.log(`Environment: ${IS_PROD ? 'production' : 'development'}`);
    console.log(`CORS: ${IS_PROD ? ALLOWED_ORIGINS.join(', ') : '*'}`);
  } catch (error) {
    console.log('Error starting server: ', error);
    process.exit(1);
  }
};

start();
