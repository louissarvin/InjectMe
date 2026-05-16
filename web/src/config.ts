interface ContractAddresses {
  challengeFactory: `0x${string}`
  agentNFT: `0x${string}`
  teeOracle: `0x${string}`
  reputationRegistry: `0x${string}`
  oracleStaking: `0x${string}`
  challengeFactoryERC20: `0x${string}`
  wrapped0GBase: `0x${string}`
  backendOracle: `0x${string}`
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
  chainId: 16661, // 0G Mainnet (Aristotle)

  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:3700',

  contracts: {
    challengeFactory: '0x8B16b1AF11B8b927290c6C69a24ed12002030eF0',
    agentNFT: '0x535e47b2D4409Cab1AB1325BC6fC4C9F9ef106C1',
    teeOracle: '0xD1F2FA31E221EBeF13Fac259123aCd7B79C23018',
    reputationRegistry: '0x1c6838de56aDe21a8eEcd125b273F8cBF17f881f',
    oracleStaking: '0x064378fdC30bF7f9A9B79D6f70e889384545b7A9',
    challengeFactoryERC20: '0x3a725eA9c69094550F6Df4C897400B9379d0aD83',
    wrapped0GBase: '0x0000000000000000000000000000000000001002',
    backendOracle: '0x66D3108798E113a8Ecb677e886ec9a9E3f5cA0cD',
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
