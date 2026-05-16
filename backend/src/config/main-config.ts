/**
 * Centralized configuration for the application
 * All commonly used environment variables should be defined here
 */

// Validate required environment variables on startup
const requiredEnvVars: string[] = ['DATABASE_URL', 'JWT_SECRET'];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`FATAL: Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// App Configuration
export const APP_PORT: number = Number(process.env.APP_PORT) || 3700;
export const NODE_ENV: string = process.env.NODE_ENV || 'development';
export const IS_DEV: boolean = NODE_ENV === 'development';
export const IS_PROD: boolean = NODE_ENV === 'production';

// Database
export const DATABASE_URL: string = process.env.DATABASE_URL as string;

// Authentication
export const JWT_SECRET: string = process.env.JWT_SECRET as string;
export const JWT_EXPIRES_IN: string = process.env.JWT_EXPIRES_IN || '7d';

// Error Log Configuration
export const ERROR_LOG_MAX_RECORDS: number = 10000;
export const ERROR_LOG_CLEANUP_INTERVAL: string = '0 * * * *'; // Every hour

// 0G Chain
export const OG_RPC_URL: string = process.env.OG_RPC_URL || 'https://evmrpc.0g.ai';
export const OG_CHAIN_ID: number = Number(process.env.OG_CHAIN_ID) || 16661;
export const ORACLE_PRIVATE_KEY: string = process.env.ORACLE_PRIVATE_KEY || '';
export const FACTORY_ADDRESS: string = process.env.FACTORY_ADDRESS || '';
export const AGENT_NFT_ADDRESS: string = process.env.AGENT_NFT_ADDRESS || '';

// 0G Compute
export const OG_COMPUTE_PROVIDER: string = process.env.OG_COMPUTE_PROVIDER || '';
export const EVALUATOR_PRIVATE_KEY: string = process.env.EVALUATOR_PRIVATE_KEY || ORACLE_PRIVATE_KEY;

// 0G Storage
export const OG_STORAGE_INDEXER: string = process.env.OG_STORAGE_INDEXER || 'https://indexer-storage-turbo.0g.ai';
export const OG_FLOW_CONTRACT: string = process.env.OG_FLOW_CONTRACT || '0x62D4144dB0F0a6fBBaeb6296c785C71B3D57C526';
export const OG_KV_STREAM_ID: string = process.env.OG_KV_STREAM_ID || '';
export const STORAGE_PRIVATE_KEY: string = process.env.STORAGE_PRIVATE_KEY || ORACLE_PRIVATE_KEY;

// Oracle Staking
export const ORACLE_STAKING_ADDRESS: string = process.env.ORACLE_STAKING_ADDRESS || '';

// Wrapped 0G Base (ERC-20 precompile for native wrapping)
export const WRAPPED_0G_ADDRESS: string = process.env.WRAPPED_0G_ADDRESS || '';

// Reputation Registry
export const REPUTATION_REGISTRY_ADDRESS: string = process.env.REPUTATION_REGISTRY_ADDRESS || '';

// ERC-20 Challenge Factory
export const ERC20_FACTORY_ADDRESS: string = process.env.ERC20_FACTORY_ADDRESS || '';

// Fine-Tuning
export const FINE_TUNING_ENABLED: boolean = process.env.FINE_TUNING_ENABLED === 'true';
export const FINE_TUNING_MAX_SAMPLES: number = Number(process.env.FINE_TUNING_MAX_SAMPLES) || 1000;
export const FINE_TUNING_MAX_EPOCHS: number = Number(process.env.FINE_TUNING_MAX_EPOCHS) || 10;

export default {
  APP_PORT,
  NODE_ENV,
  IS_DEV,
  IS_PROD,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ERROR_LOG_MAX_RECORDS,
  ERROR_LOG_CLEANUP_INTERVAL,
  OG_RPC_URL,
  OG_CHAIN_ID,
  ORACLE_PRIVATE_KEY,
  FACTORY_ADDRESS,
  AGENT_NFT_ADDRESS,
  OG_COMPUTE_PROVIDER,
  OG_STORAGE_INDEXER,
  OG_FLOW_CONTRACT,
  OG_KV_STREAM_ID,
  ORACLE_STAKING_ADDRESS,
  WRAPPED_0G_ADDRESS,
  REPUTATION_REGISTRY_ADDRESS,
  ERC20_FACTORY_ADDRESS,
  FINE_TUNING_ENABLED,
  FINE_TUNING_MAX_SAMPLES,
  FINE_TUNING_MAX_EPOCHS,
};
