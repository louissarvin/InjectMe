import { config } from '@/config'

export const CONTRACT_ADDRESSES = {
  challengeFactory: config.contracts.challengeFactory,
  agentNFT: config.contracts.agentNFT,
  teeOracle: config.contracts.teeOracle,
  reputationRegistry: config.contracts.reputationRegistry,
  oracleStaking: config.contracts.oracleStaking,
  challengeFactoryERC20: config.contracts.challengeFactoryERC20,
  wrapped0GBase: config.contracts.wrapped0GBase,
  backendOracle: config.contracts.backendOracle,
} as const

export type ContractName = keyof typeof CONTRACT_ADDRESSES
