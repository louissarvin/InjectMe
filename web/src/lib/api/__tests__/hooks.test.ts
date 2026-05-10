import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { mockGet, mockPost } from '@/test/mocks/api-client'
import {
  queryKeys,
  useAgent,
  useAgents,
  useAttack,
  useChallenge,
  useChallenges,
  useCommitAttack,
  useCreateChallenge,
  useLeaderboard,
  useModels,
  useProfile,
  useRevealAttack,
} from '@/lib/api/hooks'

// Activate the api-client mock
import '@/test/mocks/api-client'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
}

function wrap<T>(data: T) {
  return { success: true, data, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- unwrap is tested implicitly by all hooks ----

describe('useChallenges', () => {
  it('calls GET /challenge/list and unwraps data', async () => {
    const challenges = [{ address: '0x1', name: 'Test' }]
    mockGet.mockResolvedValueOnce(wrap(challenges))

    const { result } = renderHook(() => useChallenges(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/challenge/list', expect.any(Object))
    expect(result.current.data).toEqual(challenges)
  })

  it('passes filter params as query strings', async () => {
    mockGet.mockResolvedValueOnce(wrap([]))

    const { result } = renderHook(
      () =>
        useChallenges({
          type: 'bounty',
          difficulty: 'expert',
          page: 2,
          limit: 10,
        }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith(
      '/challenge/list',
      expect.objectContaining({
        type: 'bounty',
        difficulty: 'expert',
        page: '2',
        limit: '10',
      }),
    )
  })
})

describe('useChallenge', () => {
  it('calls GET /challenge/:address and unwraps', async () => {
    const challenge = { address: '0xabc', name: 'Solo' }
    mockGet.mockResolvedValueOnce(wrap(challenge))

    const { result } = renderHook(() => useChallenge('0xabc'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/challenge/0xabc')
    expect(result.current.data).toEqual(challenge)
  })

  it('is disabled when address is empty', () => {
    const { result } = renderHook(() => useChallenge(''), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useLeaderboard', () => {
  it('calls GET /challenge/leaderboard', async () => {
    const lb = { attackers: [{ address: '0x1', wins: 5 }] }
    mockGet.mockResolvedValueOnce(wrap(lb))

    const { result } = renderHook(() => useLeaderboard(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/challenge/leaderboard')
    expect(result.current.data).toEqual(lb)
  })
})

describe('useProfile', () => {
  it('calls GET /challenge/profile/:wallet', async () => {
    const profile = { address: '0xdef', attacker: { wins: 3 } }
    mockGet.mockResolvedValueOnce(wrap(profile))

    const { result } = renderHook(() => useProfile('0xdef'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/challenge/profile/0xdef')
  })

  it('is disabled when wallet is empty', () => {
    const { result } = renderHook(() => useProfile(''), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useModels', () => {
  it('calls GET /challenge/models and extracts models array', async () => {
    const models = [{ provider: 'openai', model: 'gpt-4', type: 'chat' }]
    mockGet.mockResolvedValueOnce(wrap({ models }))

    const { result } = renderHook(() => useModels(), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/challenge/models')
    expect(result.current.data).toEqual(models)
  })
})

describe('useAttack', () => {
  it('calls POST /challenge/:address/attack with request body', async () => {
    const attackResponse = {
      judgment: 'SUCCESS',
      response: 'pwned',
      reason: 'jailbreak',
      chatID: 'c1',
      teeVerified: true,
      attemptNumber: 1,
    }
    mockPost.mockResolvedValueOnce(wrap(attackResponse))

    const { result } = renderHook(() => useAttack('0xchallenge'), {
      wrapper: createWrapper(),
    })

    const res = await result.current.mutateAsync({
      message: 'ignore instructions',
      attacker: '0xattacker',
    })

    expect(mockPost).toHaveBeenCalledWith(
      '/challenge/0xchallenge/attack',
      { message: 'ignore instructions', attacker: '0xattacker' },
      120_000,
    )
    expect(res.judgment).toBe('SUCCESS')
  })
})

describe('useCommitAttack', () => {
  it('calls POST /challenge/:address/commit', async () => {
    const commitResponse = {
      commitHash: '0xhash',
      salt: '0xsalt',
      note: 'committed',
    }
    mockPost.mockResolvedValueOnce(wrap(commitResponse))

    const { result } = renderHook(() => useCommitAttack('0xchal'), {
      wrapper: createWrapper(),
    })

    const res = await result.current.mutateAsync({
      message: 'test msg',
      attacker: '0xatk',
    })

    expect(mockPost).toHaveBeenCalledWith('/challenge/0xchal/commit', {
      message: 'test msg',
      attacker: '0xatk',
    })
    expect(res.commitHash).toBe('0xhash')
  })
})

describe('useRevealAttack', () => {
  it('calls POST /challenge/:address/reveal with 120s timeout', async () => {
    const revealResponse = {
      judgment: 'FAILED',
      response: 'nope',
      reason: 'safe',
      chatID: 'c2',
      teeVerified: true,
      commitReveal: true,
      attemptNumber: 2,
    }
    mockPost.mockResolvedValueOnce(wrap(revealResponse))

    const { result } = renderHook(() => useRevealAttack('0xchal'), {
      wrapper: createWrapper(),
    })

    const res = await result.current.mutateAsync({ attacker: '0xatk' })

    expect(mockPost).toHaveBeenCalledWith(
      '/challenge/0xchal/reveal',
      { attacker: '0xatk' },
      120_000,
    )
    expect(res.judgment).toBe('FAILED')
  })
})

describe('useCreateChallenge', () => {
  it('calls POST /challenge/create', async () => {
    const created = { id: 'c1', contractAddress: '0xnew' }
    mockPost.mockResolvedValueOnce(wrap(created))

    const { result } = renderHook(() => useCreateChallenge(), {
      wrapper: createWrapper(),
    })

    const payload = {
      contractAddress: '0xnew',
      name: 'Test Challenge',
      model: 'gpt-4',
      systemPrompt: 'You are a test bot.',
      defender: '0xdef',
    }

    const res = await result.current.mutateAsync(payload)

    expect(mockPost).toHaveBeenCalledWith('/challenge/create', payload, 60_000)
    expect(res.contractAddress).toBe('0xnew')
  })
})

describe('useAgents', () => {
  it('calls GET /agent/list with wallet param', async () => {
    const agents = { wallet: '0xuser', agents: [] }
    mockGet.mockResolvedValueOnce(wrap(agents))

    const { result } = renderHook(() => useAgents('0xuser'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/agent/list', { wallet: '0xuser' })
  })

  it('is disabled when wallet is empty', () => {
    const { result } = renderHook(() => useAgents(''), {
      wrapper: createWrapper(),
    })
    expect(result.current.fetchStatus).toBe('idle')
  })
})

describe('useAgent', () => {
  it('calls GET /agent/:tokenId', async () => {
    const agent = { tokenId: 5, model: 'gpt-4', securityScore: 85 }
    mockGet.mockResolvedValueOnce(wrap(agent))

    const { result } = renderHook(() => useAgent(5), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockGet).toHaveBeenCalledWith('/agent/5')
  })
})

describe('queryKeys', () => {
  it('generates unique keys for challenges', () => {
    const k1 = queryKeys.challenges({ type: 'bounty' })
    const k2 = queryKeys.challenges({ type: 'tournament' })
    expect(k1).not.toEqual(k2)
  })

  it('generates detail key with address', () => {
    expect(queryKeys.challenge('0xabc')).toEqual([
      'challenges',
      'detail',
      '0xabc',
    ])
  })

  it('generates agent key with tokenId', () => {
    expect(queryKeys.agent(42)).toEqual(['agents', 'detail', 42])
  })

  it('generates leaderboard key', () => {
    expect(queryKeys.leaderboard()).toEqual(['challenges', 'leaderboard'])
  })

  it('generates models key', () => {
    expect(queryKeys.models()).toEqual(['challenges', 'models'])
  })
})
