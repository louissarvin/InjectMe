interface ContractAddresses {
  challengeFactory: `0x${string}`
  agentNFT: `0x${string}`
  teeOracle: `0x${string}`
  reputationRegistry: `0x${string}`
  oracleStaking: `0x${string}`
  challengeFactoryERC20: `0x${string}`
  wrapped0GBase: `0x${string}`
}

interface AppConfig {
  appName: string
  appDescription: string
  chainId: number
  apiUrl: string
  contracts: ContractAddresses
  links: {
    twitter: string
    github: string
    telegram: string
    discord: string
    docs: string
  }
  features: {
    smoothScroll: boolean
    dataMarketplace: boolean
    testSuite: boolean
    emergencyWithdrawal: boolean
    prizePoolSeeding: boolean
    agentAnalysis: boolean
    onchainAnalytics: boolean
    alignmentChallenges: boolean
    fineTuning: boolean
    oracleStaking: boolean
    iNFT: boolean
  }
}

export const config: AppConfig = {
  appName: 'InjectMe',
  appDescription: 'AI adversarial testing platform on 0G Chain',
  chainId: 16602, // 0G Galileo Testnet

  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3700',

  contracts: {
    challengeFactory: '0xb2497B0D68fDf4AEb638D0c2ecFE15bbFA5D8560',
    agentNFT: '0xa778b7705c15573d900428a5F34EE26FCFE0AB67',
    teeOracle: '0x1e73A6b71308b41d683FD77bBA43BD3C0bF20ee8',
    reputationRegistry: '0x97b7B855fA6988a0F7F66cf27C28Bb8B09286fB4',
    oracleStaking: '0x99D77A1A2a2e8599d67aaaaFcbce7776264B4c17',
    challengeFactoryERC20: '0x7F24560254958F4A7C9F39eDd32b56b05B6b6D74',
    wrapped0GBase: '0x0000000000000000000000000000000000001002',
  },

  links: {
    twitter: 'https://x.com/injectme',
    github: 'https://github.com/injectme',
    telegram: 'https://t.me/injectme',
    discord: 'https://discord.gg/injectme',
    docs: 'https://docs.injectme.xyz',
  },

  features: {
    smoothScroll: true,
    dataMarketplace: false,
    testSuite: false,
    emergencyWithdrawal: false,
    prizePoolSeeding: false,
    agentAnalysis: false,
    onchainAnalytics: false,
    alignmentChallenges: true,
    fineTuning: false,
    oracleStaking: true,
    iNFT: true,
  },
}

export type Config = AppConfig
