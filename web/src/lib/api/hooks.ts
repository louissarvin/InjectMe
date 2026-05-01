import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { UseQueryOptions } from '@tanstack/react-query'
import { apiClient } from '@/lib/api/client'
import { config } from '@/config'

// --- API wrapper ---

interface ApiResponse<T> {
  success: boolean
  data: T
  error: string | null
}

function unwrap<T>(res: ApiResponse<T>): T {
  return res.data
}

// ============================================================
//                        TYPES
// ============================================================

// Challenge (on-chain + DB metadata merged by backend)
export interface Challenge {
  address: string
  contractAddress?: string
  name: string
  description?: string
  model: string
  defender: string
  messagePrice: string
  expiresAt: string
  challengeType: number // 0=TOURNAMENT, 1=BOUNTY, 2=ALIGNMENT
  prizePool: string
  totalAttempts: number
  active: boolean
  winner?: string
  difficulty?: string
  challengeLabel?: string
  defenderEarnings?: string
  visibility?: string
  tokenAddress?: string
  tokenSymbol?: string
  prizeType?: 'native' | 'erc20'
  isEncrypted?: boolean
  dataSource?: string
  systemPromptHash?: string
  alignmentData?: {
    totalSamples: number
    rewardPerAttempt: string
  } | null
  tokenInfo?: {
    address: string
    name: string
    symbol: string
    decimals: number
  } | null
}

export interface Attempt {
  id: string
  challengeAddress: string
  attacker: string
  message: string
  response: string
  judgment: 'SUCCESS' | 'FAILED'
  chatID: string
  teeVerified: boolean
  storageRoot?: string
  owaspCategory?: string
  createdAt: string
}

// iNFT agent
export interface Agent {
  tokenId: number
  challengeAddress: string
  model: string
  totalAttempts: number
  attemptsSurvived: number
  breached: boolean
  createdAt: number
  resolvedAt: number
  securityScore: number
  owner: string
  encryptedURI?: string
  attestationCount?: number
}

// Reputation (on-chain ReputationRegistry)
export interface AttackerReputation {
  totalAttempts: number
  successfulBreaches: number
  challengesParticipated: number
  totalEarnings: string
  lastActiveAt: number
  score: number
}

export interface DefenderReputation {
  totalChallengesCreated: number
  challengesSurvived: number
  challengesBreached: number
  totalPrizeDefended: string
  totalPrizeLost: string
  lastActiveAt: number
  score: number
}

export interface ReputationResponse {
  address: string
  onChain: {
    attacker: AttackerReputation | null
    defender: DefenderReputation | null
    attackerScore: number | null
    defenderScore: number | null
    source: string
  }
  offChain: {
    kvReputation: unknown
    dbStats: {
      wins: number
      totalAttempts: number
      winRate: string
      owaspBreakdown: Record<string, number>
    }
  }
}

export interface PlayerProfile {
  address: string
  attacker: {
    wins: number
    totalAttempts: number
    winRate: string
    owaspBreakdown: Record<string, number>
  }
  defender: {
    challengesCreated: number
    challenges: Array<{
      contractAddress: string
      name: string
      description: string
    }>
    defenderChallenges: Array<string>
  }
  kvReputation: unknown
  onChainReputation: {
    attacker: AttackerReputation | null
    defender: DefenderReputation | null
    attackerScore: number | null
    defenderScore: number | null
  }
}

export interface LeaderboardEntry {
  address: string
  wins: number
  totalAttempts: number
  winRate: string
}

export interface LeaderboardResponse {
  attackers: Array<LeaderboardEntry>
}

// Model from 0G Compute
export interface ComputeModel {
  provider: string
  model: string
  type: string
}

// Create challenge request (tournament / bounty native)
export interface CreateChallengeRequest {
  contractAddress: string
  name: string
  model: string
  systemPrompt: string
  defender: string
  description?: string
  visibility?: 'public' | 'unlisted'
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | 'expert'
  challengeLabel?: string
}

export interface CreateChallengeResponse {
  id: string
  contractAddress: string
}

// Create alignment challenge request (native)
export interface CreateAlignmentRequest {
  name: string
  rewardPerAttempt: string
  duration: number
  secretHash: string
  model: string
  systemPrompt: string
  description?: string
  difficulty?: string
  prizePool?: string
}

export interface CreateAlignmentResponse {
  id: string
  contractAddress: string
  txHash: string
  challengeType: string
  rewardPerAttempt: string
}

// Commit-reveal
export interface CommitRequest {
  message: string
  attacker: string
}

export interface CommitResponse {
  commitHash: string
  salt: string
  note: string
}

export interface RevealRequest {
  attacker: string
}

export interface RevealResponse {
  judgment: 'SUCCESS' | 'FAILED'
  response: string
  reason: string
  chatID: string
  teeVerified: boolean
  commitReveal: boolean
  prizePool?: string
  attemptNumber: number
}

// Direct attack (legacy)
export interface AttackRequest {
  message: string
  attacker: string
}

export interface AttackResponse {
  judgment: 'SUCCESS' | 'FAILED'
  response: string
  reason: string
  chatID: string
  teeVerified: boolean
  attemptNumber: number
  prizePool?: string
  prizeWon?: string
}

// SSE stream event types from backend
export interface StreamResultEvent {
  type: 'result'
  judgment: 'SUCCESS' | 'FAILED'
  reason: string
  chatID: string
  teeVerified: boolean
  prizePool?: string
}

// Chat / conversation history
export interface ConversationMessage {
  role: string
  content: string
}

export interface ChatHistoryResponse {
  messages: Array<ConversationMessage>
}

export interface ConversationResponse {
  challengeAddress: string
  attacker: string
  messages: Array<ConversationMessage>
  source: string
}

// TEE verification
export interface AttestationVerification {
  chatID: string
  judgment: 'SUCCESS' | 'FAILED'
  teeVerified: boolean
  liveVerification: boolean
  challengeAddress: string
  attacker: string
  owaspCategory: string
  timestamp: string
}

export interface ProofVerification extends AttestationVerification {
  storageVerified: boolean
  storageRoot: string | null
  archivedData: unknown
}

// Vulnerability report
export interface VulnerabilityReport {
  report: unknown
  storageRootHash: string
}

// Alignment datasets
export interface AlignmentDataset {
  id: string
  challengeAddress: string
  storageRootHash: string
  totalSamples: number
  breachRate: number
  model: string
  datasetVersion: string
  publishedBy: string
  publishedAt: string
  challengeName: string
  challengeDescription: string
  difficulty: string
}

export interface AlignmentDatasetsResponse {
  datasets: Array<AlignmentDataset>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface PublishAlignmentResponse {
  storageRootHash: string
  totalSamples: number
  breachRate: number
  model: string
  challengeAddress: string
}

// Compute services
export interface ComputeService {
  providerAddress: string
  model: string
  serviceType: string
}

export interface ComputeServicesResponse {
  services: Array<ComputeService>
}

// Compute balance
export interface ComputeBalance {
  balance: string | number
}

// Oracle
export interface OracleOperator {
  address: string
  stakedAmount: string
  isActive: boolean
  judgmentsSubmitted: number
  judgmentsSlashed: number
  rewards: string
  slashRate: number
}

export interface StakingInfo {
  contractAddress: string
  minimumStake?: string
  activeOperators?: number
  [key: string]: unknown
}

export interface JudgmentStatus {
  judgmentId: number
  confirmations: number
  required: number
  executed: boolean
  progress: string
}

// Training / fine-tuning
export interface TrainingPair {
  prompt: string
  response: string
  label: 'REJECT' | 'SAFE'
}

export interface SubmitTrainingRequest {
  baseModel: string
  trainingData: Array<TrainingPair>
  epochs?: number
  learningRate?: number
  providerAddress?: string
}

export interface SubmitTrainingResponse {
  jobId: string
  status: string
  message: string
}

export interface TrainingJob {
  id: string
  baseModel: string
  taskId: string | null
  status: 'PENDING' | 'TRAINING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'
  fineTunedModel: string | null
  epochs: number
  trainingPairs: number
  providerAddress: string
  errorMessage: string | null
  hyperparameters?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  liveStatus?: unknown
}

export interface TrainingJobsResponse {
  jobs: Array<TrainingJob>
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

export interface TrainingModelsResponse {
  fineTunedModels: Array<{
    id: string
    baseModel: string
    fineTunedModel: string | null
    epochs: number
    trainingPairs: number
    defender: string
    createdAt: string
    updatedAt: string
  }>
  availableBaseModels: {
    standard: Array<string>
    customized: Array<string>
  }
}

export interface GenerateTrainingDataResponse {
  challengeAddress: string
  trainingData: Array<TrainingPair>
  stats: {
    total: number
    rejectSamples: number
    safeSamples: number
    sourceAttempts: number
  }
  note: string
}

export interface TrainingProvidersResponse {
  providers: Array<unknown>
}

// Health
export interface HealthStatus {
  status: 'healthy' | 'degraded'
  timestamp: string
  version: string
  network: string
  checks: Record<string, { status: string; latency?: number; detail?: string }>
}

// Challenge list params
export interface ChallengeListParams {
  type?: string
  difficulty?: string
  model?: string
  minPrize?: string
  label?: string
  all?: string
  page?: number
  limit?: number
}

export interface PaginatedChallenges {
  challenges: Array<Challenge>
  pagination?: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// ============================================================
//                      QUERY KEYS
// ============================================================

export const queryKeys = {
  // Challenges
  challenges: (params?: ChallengeListParams) =>
    ['challenges', 'list', params] as const,
  challenge: (address: string) => ['challenges', 'detail', address] as const,
  chatHistory: (challengeAddress: string, attacker: string) =>
    ['challenges', 'history', challengeAddress, attacker] as const,
  conversation: (challengeAddress: string, attacker: string) =>
    ['challenges', 'conversation', challengeAddress, attacker] as const,
  leaderboard: () => ['challenges', 'leaderboard'] as const,
  profile: (wallet: string) => ['challenges', 'profile', wallet] as const,
  reputation: (wallet: string) => ['challenges', 'reputation', wallet] as const,
  verifyAttestation: (chatID: string) =>
    ['challenges', 'verify', chatID] as const,
  verifyProof: (chatID: string) =>
    ['challenges', 'verify', chatID, 'proof'] as const,
  report: (challengeAddress: string) =>
    ['challenges', 'report', challengeAddress] as const,
  models: () => ['challenges', 'models'] as const,
  alignmentDatasets: (params?: {
    page?: number
    limit?: number
    model?: string
  }) => ['challenges', 'alignment', 'datasets', params] as const,
  computeServices: () => ['challenges', 'compute', 'services'] as const,
  computeBalance: () => ['challenges', 'compute', 'balance'] as const,

  // Agents (iNFT)
  agents: (wallet: string) => ['agents', 'list', wallet] as const,
  agent: (tokenId: number) => ['agents', 'detail', tokenId] as const,
  agentScore: (tokenId: number) => ['agents', 'score', tokenId] as const,
  agentAttestations: (tokenId: number) =>
    ['agents', 'attestations', tokenId] as const,
  agentExecutors: (tokenId: number) =>
    ['agents', tokenId, 'executors'] as const,

  // Oracle
  activeOracles: () => ['oracle', 'active'] as const,
  operatorInfo: (address: string) => ['oracle', 'operator', address] as const,
  stakingInfo: () => ['oracle', 'staking', 'info'] as const,
  judgmentStatus: (id: number) => ['oracle', 'judgment', id] as const,

  // Training
  trainingJobs: () => ['training', 'jobs'] as const,
  trainingJob: (jobId: string) => ['training', 'jobs', jobId] as const,
  trainingModels: () => ['training', 'models'] as const,
  trainingProviders: () => ['training', 'providers'] as const,

  // Health
  healthStatus: () => ['health', 'status'] as const,
} as const

// ============================================================
//                  CHALLENGE HOOKS
// ============================================================

export function useChallenges(
  params?: ChallengeListParams,
  options?: Partial<UseQueryOptions<Array<Challenge> | PaginatedChallenges>>,
) {
  const queryParams: Record<string, string> = {}
  if (params?.type) queryParams.type = params.type
  if (params?.difficulty) queryParams.difficulty = params.difficulty
  if (params?.model) queryParams.model = params.model
  if (params?.minPrize) queryParams.minPrize = params.minPrize
  if (params?.label) queryParams.label = params.label
  if (params?.all) queryParams.all = params.all
  if (params?.page !== undefined) queryParams.page = String(params.page)
  if (params?.limit !== undefined) queryParams.limit = String(params.limit)

  return useQuery({
    queryKey: queryKeys.challenges(params),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<Array<Challenge> | PaginatedChallenges>
        >('/challenge/list', queryParams)
        .then(unwrap),
    staleTime: 15_000,
    ...options,
  })
}

export function useChallenge(
  address: string,
  options?: Partial<UseQueryOptions<Challenge>>,
) {
  return useQuery({
    queryKey: queryKeys.challenge(address),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<Challenge>
        >(`/challenge/${encodeURIComponent(address)}`)
        .then(unwrap),
    enabled: !!address,
    staleTime: 10_000,
    refetchInterval: 15_000,
    ...options,
  })
}

export function useModels(
  options?: Partial<UseQueryOptions<Array<ComputeModel>>>,
) {
  return useQuery({
    queryKey: queryKeys.models(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<{ models: Array<ComputeModel> }>>('/challenge/models')
        .then(unwrap)
        .then((d) => d.models),
    staleTime: 300_000,
    ...options,
  })
}

export function useCreateChallenge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateChallengeRequest) =>
      apiClient
        .post<
          ApiResponse<CreateChallengeResponse>
        >('/challenge/create', data, 60_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenges', 'list'] })
    },
  })
}

export function useCreateAlignmentChallenge() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateAlignmentRequest) =>
      apiClient
        .post<
          ApiResponse<CreateAlignmentResponse>
        >('/challenge/create/alignment', data, 60_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenges', 'list'] })
    },
  })
}

export function useCommitAttack(challengeAddress: string) {
  return useMutation({
    mutationFn: (data: CommitRequest) =>
      apiClient
        .post<
          ApiResponse<CommitResponse>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/commit`, data)
        .then(unwrap),
  })
}

export function useRevealAttack(challengeAddress: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: RevealRequest) =>
      apiClient
        .post<
          ApiResponse<RevealResponse>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/reveal`, data, 120_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.challenge(challengeAddress),
      })
      queryClient.invalidateQueries({ queryKey: ['challenges', 'list'] })
      queryClient.invalidateQueries({ queryKey: ['challenges', 'leaderboard'] })
    },
  })
}

export function useAttack(challengeAddress: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: AttackRequest) =>
      apiClient
        .post<
          ApiResponse<AttackResponse>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/attack`, data, 120_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.challenge(challengeAddress),
      })
      queryClient.invalidateQueries({ queryKey: ['challenges', 'leaderboard'] })
    },
  })
}

/**
 * SSE streaming attack hook.
 * Returns `startStream` which opens an EventSource-like connection via fetch+ReadableStream.
 * The backend uses raw SSE over Fastify's `reply.raw`. We use fetch with a ReadableStream
 * reader since EventSource does not support POST with a body.
 *
 * Usage:
 *   const { startStream, abort } = useStreamAttack(address)
 *   startStream({ message, attacker }, {
 *     onChunk: (text) => { ... },
 *     onResult: (result) => { ... },
 *     onError: (err) => { ... },
 *   })
 */
export function useStreamAttack(challengeAddress: string) {
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  function abort() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  async function startStream(
    data: AttackRequest,
    callbacks: {
      onChunk?: (text: string) => void
      onResult?: (result: StreamResultEvent) => void
      onError?: (err: Error) => void
      onDone?: () => void
    },
  ) {
    abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const url = new URL(
        `${config.apiUrl}/challenge/${encodeURIComponent(challengeAddress)}/attack/stream`,
      )
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: apiClient.getHeaders(),
        body: JSON.stringify(data),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error(`Stream failed: ${res.status} ${res.statusText}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        // Parse SSE events from buffer
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim()
            if (!raw) continue
            try {
              const parsed = JSON.parse(raw) as StreamResultEvent
              if (parsed.type === 'result') {
                callbacks.onResult?.(parsed)
              }
            } catch {
              // Not JSON, treat as plain text chunk
              callbacks.onChunk?.(line)
            }
          } else if (line.trim()) {
            callbacks.onChunk?.(line)
          }
        }
      }

      callbacks.onDone?.()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        callbacks.onError?.(err as Error)
      }
    }
  }

  return { startStream, abort }
}

export function useChatHistory(
  challengeAddress: string,
  attacker: string,
  options?: Partial<UseQueryOptions<ChatHistoryResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.chatHistory(challengeAddress, attacker),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<ChatHistoryResponse>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/history/${encodeURIComponent(attacker)}`)
        .then(unwrap),
    enabled: !!challengeAddress && !!attacker,
    staleTime: 5_000,
    ...options,
  })
}

export function useConversation(
  challengeAddress: string,
  attacker: string,
  options?: Partial<UseQueryOptions<ConversationResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.conversation(challengeAddress, attacker),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<ConversationResponse>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/conversation/${encodeURIComponent(attacker)}`)
        .then(unwrap),
    enabled: !!challengeAddress && !!attacker,
    staleTime: 10_000,
    ...options,
  })
}

export function useLeaderboard(
  options?: Partial<UseQueryOptions<LeaderboardResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.leaderboard(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<LeaderboardResponse>>('/challenge/leaderboard')
        .then(unwrap),
    staleTime: 30_000,
    ...options,
  })
}

export function useProfile(
  wallet: string,
  options?: Partial<UseQueryOptions<PlayerProfile>>,
) {
  return useQuery({
    queryKey: queryKeys.profile(wallet),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<PlayerProfile>
        >(`/challenge/profile/${encodeURIComponent(wallet)}`)
        .then(unwrap),
    enabled: !!wallet,
    staleTime: 30_000,
    ...options,
  })
}

export function useReputation(
  wallet: string,
  options?: Partial<UseQueryOptions<ReputationResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.reputation(wallet),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<ReputationResponse>
        >(`/challenge/reputation/${encodeURIComponent(wallet)}`)
        .then(unwrap),
    enabled: !!wallet,
    staleTime: 60_000,
    ...options,
  })
}

export function useVerifyAttestation(
  chatID: string,
  options?: Partial<UseQueryOptions<AttestationVerification>>,
) {
  return useQuery({
    queryKey: queryKeys.verifyAttestation(chatID),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<AttestationVerification>
        >(`/challenge/verify/${encodeURIComponent(chatID)}`)
        .then(unwrap),
    enabled: !!chatID,
    staleTime: 300_000,
    ...options,
  })
}

export function useVerifyProof(
  chatID: string,
  options?: Partial<UseQueryOptions<ProofVerification>>,
) {
  return useQuery({
    queryKey: queryKeys.verifyProof(chatID),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<ProofVerification>
        >(`/challenge/verify/${encodeURIComponent(chatID)}/proof`, undefined, 60_000)
        .then(unwrap),
    enabled: !!chatID,
    staleTime: 300_000,
    ...options,
  })
}

export function useReport(
  challengeAddress: string,
  options?: Partial<UseQueryOptions<VulnerabilityReport>>,
) {
  return useQuery({
    queryKey: queryKeys.report(challengeAddress),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<VulnerabilityReport>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/report`, undefined, 60_000)
        .then(unwrap),
    enabled: !!challengeAddress,
    staleTime: 300_000,
    ...options,
  })
}

export function useAlignmentDatasets(
  params?: { page?: number; limit?: number; model?: string },
  options?: Partial<UseQueryOptions<AlignmentDatasetsResponse>>,
) {
  const queryParams: Record<string, string> = {}
  if (params?.page !== undefined) queryParams.page = String(params.page)
  if (params?.limit !== undefined) queryParams.limit = String(params.limit)
  if (params?.model) queryParams.model = params.model

  return useQuery({
    queryKey: queryKeys.alignmentDatasets(params),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<AlignmentDatasetsResponse>
        >('/challenge/alignment/datasets', queryParams)
        .then(unwrap),
    staleTime: 60_000,
    ...options,
  })
}

export function usePublishAlignmentData(challengeAddress: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient
        .post<
          ApiResponse<PublishAlignmentResponse>
        >(`/challenge/${encodeURIComponent(challengeAddress)}/publish-alignment-data`, undefined, 60_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['challenges', 'alignment'] })
    },
  })
}

export function useComputeServices(
  options?: Partial<UseQueryOptions<ComputeServicesResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.computeServices(),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<ComputeServicesResponse>
        >('/challenge/compute/services')
        .then(unwrap),
    staleTime: 60_000,
    ...options,
  })
}

export function useComputeBalance(
  options?: Partial<UseQueryOptions<ComputeBalance>>,
) {
  return useQuery({
    queryKey: queryKeys.computeBalance(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<ComputeBalance>>('/challenge/compute/balance')
        .then(unwrap),
    staleTime: 30_000,
    ...options,
  })
}

// ============================================================
//                  AGENT (iNFT) HOOKS
// ============================================================

export function useAgents(
  wallet: string,
  options?: Partial<UseQueryOptions<{ wallet: string; agents: Array<Agent> }>>,
) {
  return useQuery({
    queryKey: queryKeys.agents(wallet),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<{ wallet: string; agents: Array<Agent> }>
        >('/agent/list', { wallet })
        .then(unwrap),
    enabled: !!wallet,
    staleTime: 30_000,
    ...options,
  })
}

export function useAgent(
  tokenId: number,
  options?: Partial<
    UseQueryOptions<Agent & { encryptedURI: string; attestationCount: number }>
  >,
) {
  return useQuery({
    queryKey: queryKeys.agent(tokenId),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<
            Agent & { encryptedURI: string; attestationCount: number }
          >
        >(`/agent/${tokenId}`)
        .then(unwrap),
    enabled: tokenId >= 0,
    staleTime: 30_000,
    ...options,
  })
}

export function useTransferAgent(tokenId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { to: string }) =>
      apiClient
        .post<
          ApiResponse<{
            txHash: string
            tokenId: number
            from: string
            to: string
            reencrypted: boolean
          }>
        >(`/agent/${tokenId}/transfer`, data, 60_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useCloneAgent(tokenId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { to: string }) =>
      apiClient
        .post<
          ApiResponse<{
            txHash: string
            originalTokenId: number
            newTokenId: number
            to: string
            reencrypted: boolean
          }>
        >(`/agent/${tokenId}/clone`, data, 60_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useAuthorizeAgent(tokenId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { executor: string; permissions: string }) =>
      apiClient
        .post<
          ApiResponse<{
            txHash: string
            tokenId: number
            executor: string
            permissions: string
          }>
        >(`/agent/${tokenId}/authorize`, data)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent(tokenId) })
    },
  })
}

export function useRevokeAgent(tokenId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { executor: string }) =>
      apiClient
        .post<
          ApiResponse<{ txHash: string; tokenId: number; executor: string }>
        >(`/agent/${tokenId}/revoke`, data)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.agent(tokenId) })
    },
  })
}

export function useAgentScore(
  tokenId: number,
  options?: Partial<
    UseQueryOptions<{ tokenId: number; securityScore: number }>
  >,
) {
  return useQuery({
    queryKey: queryKeys.agentScore(tokenId),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<{ tokenId: number; securityScore: number }>
        >(`/agent/${tokenId}/score`)
        .then(unwrap),
    enabled: tokenId >= 0,
    staleTime: 60_000,
    ...options,
  })
}

export function useAgentAttestations(
  tokenId: number,
  options?: Partial<
    UseQueryOptions<{
      tokenId: number
      count: number
      attestationHashes: Array<string>
    }>
  >,
) {
  return useQuery({
    queryKey: queryKeys.agentAttestations(tokenId),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<{
            tokenId: number
            count: number
            attestationHashes: Array<string>
          }>
        >(`/agent/${tokenId}/attestations`)
        .then(unwrap),
    enabled: tokenId >= 0,
    staleTime: 60_000,
    ...options,
  })
}

export function useAgentExecutors(
  tokenId: number,
  options?: Partial<
    UseQueryOptions<{
      tokenId: number
      executors: Array<{ executor: string; permissions: string }>
    }>
  >,
) {
  return useQuery({
    queryKey: queryKeys.agentExecutors(tokenId),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<{
            tokenId: number
            executors: Array<{ executor: string; permissions: string }>
          }>
        >(`/agent/${tokenId}/executors`)
        .then(unwrap),
    enabled: tokenId >= 0,
    staleTime: 30_000,
    ...options,
  })
}

export function useAgentPrompt(tokenId: number) {
  return useMutation({
    mutationFn: () =>
      apiClient
        .get<
          ApiResponse<{ tokenId: number; systemPrompt: string }>
        >(`/agent/${tokenId}/prompt`)
        .then(unwrap),
  })
}

export function useDeployAgent(tokenId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      contractAddress: string
      name: string
      description?: string
      visibility?: string
      difficulty?: string
      challengeLabel?: string
    }) =>
      apiClient
        .post<
          ApiResponse<{
            id: string
            contractAddress: string
            tokenId: number
            linked: boolean
          }>
        >(`/agent/${tokenId}/deploy`, data, 60_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

// ============================================================
//                  ORACLE HOOKS
// ============================================================

export function useActiveOracles(
  options?: Partial<UseQueryOptions<{ oracles: Array<string>; count: number }>>,
) {
  return useQuery({
    queryKey: queryKeys.activeOracles(),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<{ oracles: Array<string>; count: number }>
        >('/oracle/active')
        .then(unwrap),
    staleTime: 60_000,
    ...options,
  })
}

export function useOperatorInfo(
  address: string,
  options?: Partial<UseQueryOptions<OracleOperator>>,
) {
  return useQuery({
    queryKey: queryKeys.operatorInfo(address),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<OracleOperator>
        >(`/oracle/operator/${encodeURIComponent(address)}`)
        .then(unwrap),
    enabled: !!address,
    staleTime: 30_000,
    ...options,
  })
}

export function useStakingInfo(
  options?: Partial<UseQueryOptions<StakingInfo>>,
) {
  return useQuery({
    queryKey: queryKeys.stakingInfo(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<StakingInfo>>('/oracle/staking/info')
        .then(unwrap),
    staleTime: 60_000,
    ...options,
  })
}

export function useJudgmentStatus(
  id: number,
  options?: Partial<UseQueryOptions<JudgmentStatus>>,
) {
  return useQuery({
    queryKey: queryKeys.judgmentStatus(id),
    queryFn: () =>
      apiClient
        .get<ApiResponse<JudgmentStatus>>(`/oracle/judgment/${id}`)
        .then(unwrap),
    enabled: id >= 0,
    staleTime: 10_000,
    ...options,
  })
}

// ============================================================
//                  TRAINING HOOKS
// ============================================================

export function useSubmitTraining() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: SubmitTrainingRequest) =>
      apiClient
        .post<
          ApiResponse<SubmitTrainingResponse>
        >('/training/submit', data, 300_000)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs() })
    },
  })
}

export function useTrainingJobs(
  params?: { page?: number; limit?: number },
  options?: Partial<UseQueryOptions<TrainingJobsResponse>>,
) {
  const queryParams: Record<string, string> = {}
  if (params?.page !== undefined) queryParams.page = String(params.page)
  if (params?.limit !== undefined) queryParams.limit = String(params.limit)

  return useQuery({
    queryKey: queryKeys.trainingJobs(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<TrainingJobsResponse>>('/training/jobs', queryParams)
        .then(unwrap),
    staleTime: 15_000,
    ...options,
  })
}

export function useTrainingJob(
  jobId: string,
  options?: Partial<UseQueryOptions<TrainingJob>>,
) {
  return useQuery({
    queryKey: queryKeys.trainingJob(jobId),
    queryFn: () =>
      apiClient
        .get<
          ApiResponse<TrainingJob>
        >(`/training/jobs/${encodeURIComponent(jobId)}`)
        .then(unwrap),
    enabled: !!jobId,
    staleTime: 10_000,
    ...options,
  })
}

export function useCancelTraining(jobId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () =>
      apiClient
        .post<
          ApiResponse<{ jobId: string; status: string }>
        >(`/training/jobs/${encodeURIComponent(jobId)}/cancel`)
        .then(unwrap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.trainingJobs() })
      queryClient.invalidateQueries({ queryKey: queryKeys.trainingJob(jobId) })
    },
  })
}

export function useTrainingModels(
  options?: Partial<UseQueryOptions<TrainingModelsResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.trainingModels(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<TrainingModelsResponse>>('/training/models')
        .then(unwrap),
    staleTime: 120_000,
    ...options,
  })
}

export function useGenerateTrainingData(challengeAddress: string) {
  return useMutation({
    mutationFn: async (params?: { maxSamples?: number }) => {
      const url = new URL(
        `${config.apiUrl}/training/generate-data/${encodeURIComponent(challengeAddress)}`,
      )
      if (params?.maxSamples !== undefined) {
        url.searchParams.set('maxSamples', String(params.maxSamples))
      }
      const controller = new AbortController()
      const timeout_id = setTimeout(() => controller.abort(), 60_000)
      try {
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: apiClient.getHeaders(),
          signal: controller.signal,
        })
        if (!res.ok) {
          throw new Error(
            `POST /training/generate-data failed: ${res.statusText}`,
          )
        }
        const json =
          (await res.json()) as ApiResponse<GenerateTrainingDataResponse>
        return unwrap(json)
      } finally {
        clearTimeout(timeout_id)
      }
    },
  })
}

export function useTrainingProviders(
  options?: Partial<UseQueryOptions<TrainingProvidersResponse>>,
) {
  return useQuery({
    queryKey: queryKeys.trainingProviders(),
    queryFn: () =>
      apiClient
        .get<ApiResponse<TrainingProvidersResponse>>('/training/providers')
        .then(unwrap),
    staleTime: 120_000,
    ...options,
  })
}

// ============================================================
//                  HEALTH HOOK
// ============================================================

export function useHealthStatus(
  options?: Partial<UseQueryOptions<HealthStatus>>,
) {
  return useQuery({
    queryKey: queryKeys.healthStatus(),
    queryFn: () =>
      apiClient.get<ApiResponse<HealthStatus>>('/health/status').then(unwrap),
    staleTime: 30_000,
    retry: 1,
    ...options,
  })
}
