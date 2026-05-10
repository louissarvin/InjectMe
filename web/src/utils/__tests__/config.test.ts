import { describe, expect, it } from 'vitest'
import { config } from '@/config'

describe('config', () => {
  it('has correct app name', () => {
    expect(config.appName).toBe('InjectMe')
  })

  it('has 0G Galileo testnet chain ID', () => {
    expect(config.chainId).toBe(16602)
  })

  it('has all required contract addresses as hex strings', () => {
    const { contracts } = config
    const addresses = [
      contracts.challengeFactory,
      contracts.agentNFT,
      contracts.teeOracle,
      contracts.reputationRegistry,
      contracts.oracleStaking,
      contracts.challengeFactoryERC20,
      contracts.wrapped0GBase,
    ]
    for (const addr of addresses) {
      expect(addr).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
  })

  it('has all social links defined', () => {
    expect(config.links.twitter).toContain('x.com')
    expect(config.links.github).toContain('github.com')
    expect(config.links.telegram).toContain('t.me')
    expect(config.links.discord).toContain('discord.gg')
    expect(config.links.docs).toContain('injectme')
  })

  it('has feature flags as booleans', () => {
    for (const [, val] of Object.entries(config.features)) {
      expect(typeof val).toBe('boolean')
    }
  })

  it('has expected enabled features', () => {
    expect(config.features.smoothScroll).toBe(true)
    expect(config.features.alignmentChallenges).toBe(true)
    expect(config.features.oracleStaking).toBe(true)
    expect(config.features.iNFT).toBe(true)
  })

  it('has expected disabled features', () => {
    expect(config.features.dataMarketplace).toBe(false)
    expect(config.features.testSuite).toBe(false)
  })
})
