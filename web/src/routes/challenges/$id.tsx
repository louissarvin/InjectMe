import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  ExternalLink,
  MessageSquare,
  Send,
  Shield,
  Trophy,
} from 'lucide-react'
import { Button, Skeleton, Spinner, Textarea, Tooltip } from '@heroui/react'
import { useAccount } from 'wagmi'
import { formatEther } from 'viem'
import type { Address } from 'viem'
import type { StreamResultEvent } from '@/lib/api/hooks'
import {
  useAttack,
  useChallenge,
  useChatHistory,
  useCommitAttack,
  useConversation,
  useRevealAttack,
  useStreamAttack,
} from '@/lib/api/hooks'
import { useAuth } from '@/hooks/useAuth'
import {
  useChallengePrizePool,
  useClaimExpiry,
  useCommitAttempt,
  usePendingWithdrawal,
  useWithdraw,
} from '@/lib/contracts/hooks'
import { cnm } from '@/utils/style'
import GlassCard from '@/components/GlassCard'
import StatusBadge from '@/components/StatusBadge'
import CountdownTimer from '@/components/CountdownTimer'

export const Route = createFileRoute('/challenges/$id')({
  component: ChallengePage,
})

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

const CHALLENGE_TYPE_LABELS: Record<number, string> = {
  0: 'Tournament',
  1: 'Bounty',
  2: 'Alignment',
}

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: 'bg-[#098551]/10 text-[#098551] border-[#098551]/20',
  intermediate: 'bg-[#ED702F]/10 text-[#ED702F] border-[#ED702F]/20',
  advanced: 'bg-[#CF202F]/10 text-[#CF202F] border-[#CF202F]/20',
  expert: 'bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20',
}

function truncateAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

// ============================================================
//  Chat message types used in the local UI
// ============================================================

interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface AttackResult {
  judgment: 'SUCCESS' | 'FAILED'
  reason: string
  chatID: string
  teeVerified: boolean
  prizePool?: string
}

// ============================================================
//  Commit-reveal state machine
// ============================================================

type CommitRevealStep =
  | 'idle'
  | 'committing'
  | 'confirming'
  | 'revealing'
  | 'done'
  | 'error'

const STEP_LABELS: Record<CommitRevealStep, string> = {
  idle: '',
  committing: 'Committing...',
  confirming: 'Confirming on-chain...',
  revealing: 'Revealing...',
  done: 'Done',
  error: 'Failed',
}

// ============================================================
//  ChatInput
// ============================================================

type SendState = 'idle' | 'sending' | 'done' | 'error'

function ChatInput({
  messagePriceWei,
  isActive,
  isConnected,
  isAuthenticated,
  onLogin,
  onMessageSent,
}: {
  challengeAddress?: string
  messagePriceWei: string
  isActive: boolean
  isConnected: boolean
  isAuthenticated: boolean
  onLogin: () => Promise<void>
  userAddress?: string
  onMessageSent: (
    userMsg: string,
    streamChunk: (chunk: string) => void,
    onResult: (result: AttackResult) => void,
    onError: (err: string) => void,
  ) => void
  commitRevealStep?: CommitRevealStep
}) {
  const [text, setText] = useState('')
  const [state, setState] = useState<SendState>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const priceInEther = formatEther(BigInt(messagePriceWei || '0'))

  if (!isActive) {
    return (
      <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06]">
        <p className="text-[#9CA3AF] dark:text-[#6B7280] text-sm text-center">
          This challenge is no longer active.
        </p>
      </div>
    )
  }

  if (!isConnected) {
    return (
      <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06] text-center">
        <p className="text-[#4B5563] dark:text-[#D1D5DB] text-sm mb-1">
          Connect your wallet to attack this challenge.
        </p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06] text-center">
        <p className="text-[#4B5563] dark:text-[#D1D5DB] text-sm mb-2">
          Sign in with your wallet to attack this challenge.
        </p>
        <Button
          onPress={async () => {
            setSigningIn(true)
            try {
              await onLogin()
            } catch {
              // user rejected signature
            } finally {
              setSigningIn(false)
            }
          }}
          isLoading={signingIn}
          isDisabled={signingIn}
          className="rounded-xl bg-[#AF69EE] hover:bg-[#C28FF3] text-white text-[13px] font-semibold px-6 h-9"
        >
          {signingIn ? 'Signing...' : 'Sign In'}
        </Button>
      </div>
    )
  }

  function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || state === 'sending') return
    setText('')
    setState('sending')
    setErrorMsg('')

    onMessageSent(
      trimmed,
      () => {},
      (_result) => {
        setState('done')
        setTimeout(() => setState('idle'), 2000)
      },
      (err) => {
        setState('error')
        setErrorMsg(err)
        setTimeout(() => setState('idle'), 4000)
      },
    )
  }

  const isLoading = state === 'sending'

  return (
    <div className="p-4 border-t border-black/[0.06] dark:border-white/[0.06]">
      {state === 'error' && (
        <div className="mb-3 flex items-center gap-2 bg-[#CF202F]/10 border border-[#CF202F]/20 rounded-xl px-4 py-2">
          <AlertCircle size={14} className="text-[#CF202F] shrink-0" />
          <p className="text-[#CF202F] text-[13px]">{errorMsg}</p>
        </div>
      )}

      {state === 'done' && (
        <div className="mb-3 flex items-center gap-2 bg-[#098551]/10 border border-[#098551]/20 rounded-xl px-4 py-2">
          <CheckCircle size={14} className="text-[#098551] shrink-0" />
          <p className="text-[#098551] text-[13px]">Message sent.</p>
        </div>
      )}

      <div className="flex gap-3">
        <Textarea
          value={text}
          onValueChange={setText}
          placeholder="Try to break the AI's instructions..."
          minRows={1}
          maxRows={4}
          isDisabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSend()
            }
          }}
          classNames={{
            input:
              'bg-[#F3F4F6] dark:bg-[#141518] text-[#0A0B0D] dark:text-[#F9FAFB] placeholder:text-[#D1D5DB] dark:placeholder:text-[#6B7280] text-[15px]',
            inputWrapper:
              'bg-[#F3F4F6] dark:bg-[#141518] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl focus-within:border-[#AF69EE] focus-within:ring-[3px] focus-within:ring-[rgba(175,105,238,0.15)] hover:border-[#9CA3AF] transition-all',
          }}
        />
        <Tooltip content={`Send — costs ${priceInEther} 0G`}>
          <Button
            isIconOnly
            onPress={handleSend}
            isDisabled={!text.trim() || isLoading}
            isLoading={isLoading}
            className="rounded-xl w-11 h-11 shrink-0 bg-[#AF69EE] hover:bg-[#C28FF3] text-white transition-colors duration-150"
          >
            {isLoading ? (
              <Spinner size="sm" color="white" />
            ) : (
              <Send size={16} />
            )}
          </Button>
        </Tooltip>
      </div>

      <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[11px] mt-2 text-center">
        Each message costs {priceInEther} 0G
      </p>
    </div>
  )
}

// ============================================================
//  CommitRevealStepIndicator
// ============================================================

function CommitRevealStepIndicator({ step }: { step: CommitRevealStep }) {
  if (step === 'idle' || step === 'done') return null

  const isError = step === 'error'
  const steps: Array<CommitRevealStep> = [
    'committing',
    'confirming',
    'revealing',
  ]
  const currentIdx = steps.indexOf(step)

  return (
    <div
      className={cnm(
        'mx-4 mb-3 rounded-xl px-4 py-3 border flex items-center gap-3',
        isError
          ? 'bg-[#CF202F]/8 border-[#CF202F]/20'
          : 'bg-[#AF69EE]/5 border-[#AF69EE]/15',
      )}
    >
      {isError ? (
        <>
          <AlertCircle size={13} className="text-[#CF202F] shrink-0" />
          <span className="text-[#CF202F] text-[12px]">
            Commit-reveal failed, falling back to direct attack...
          </span>
        </>
      ) : (
        <>
          <Spinner size="sm" color="primary" />
          <div className="flex items-center gap-2">
            {steps.map((s, i) => (
              <span
                key={s}
                className={cnm(
                  'text-[12px] font-medium',
                  i < currentIdx
                    ? 'text-[#098551]'
                    : i === currentIdx
                      ? 'text-[#AF69EE]'
                      : 'text-[#6B7280]',
                )}
              >
                {STEP_LABELS[s]}
                {i < steps.length - 1 && (
                  <span className="text-[#4B5563] ml-2">›</span>
                )}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================
//  JudgmentBadge
// ============================================================

function isHexId(value: string): boolean {
  return /^(0x)?[0-9a-fA-F]+$/.test(value)
}

function JudgmentBadge({
  judgment,
  teeVerified,
  chatID,
}: {
  judgment: 'SUCCESS' | 'FAILED'
  teeVerified: boolean
  chatID: string
}) {
  const isSuccess = judgment === 'SUCCESS'
  const safeLink =
    chatID && isHexId(chatID)
      ? `https://chainscan-galileo.0g.ai/tx/${chatID}`
      : undefined

  return (
    <div
      className={cnm(
        'rounded-2xl border overflow-hidden',
        isSuccess
          ? 'bg-gradient-to-r from-[#098551]/10 to-[#098551]/5 border-[#098551]/20'
          : 'bg-gradient-to-r from-[#F3F4F6] to-[#F9FAFB] dark:from-[#1F2937] dark:to-[#141518] border-black/[0.06] dark:border-[#2D2F36]',
      )}
    >
      {/* Main result row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex-1 min-w-0">
          <p
            className={cnm(
              'text-[14px] font-semibold leading-tight',
              isSuccess
                ? 'text-[#098551]'
                : 'text-[#0A0B0D] dark:text-[#D1D5DB]',
            )}
          >
            {isSuccess ? 'Prompt injection succeeded!' : 'Defense held'}
          </p>
          <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] mt-0.5">
            {isSuccess
              ? 'The AI broke its instructions.'
              : 'The AI maintained its boundaries.'}
          </p>
        </div>

        {/* Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {teeVerified && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[#AF69EE] bg-[#AF69EE]/8 border border-[#AF69EE]/15 px-2.5 py-1 rounded-full">
              TEE
            </span>
          )}
          {safeLink && (
            <a
              href={safeLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] font-medium text-[#6B7280] hover:text-[#AF69EE] bg-white dark:bg-[#1F2937] border border-black/[0.06] dark:border-[#2D2F36] px-2.5 py-1 rounded-full transition-colors"
            >
              <ExternalLink size={10} /> Verify
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  VictoryBanner
// ============================================================

function VictoryBanner({ prizePool }: { prizePool?: string }) {
  return (
    <div className="mx-5 mb-4 rounded-2xl bg-gradient-to-r from-[#098551]/15 to-[#AF69EE]/10 border border-[#098551]/30 px-5 py-5 text-center">
      <div className="w-12 h-12 rounded-full bg-[#098551]/15 flex items-center justify-center mx-auto mb-3">
        <Trophy size={22} className="text-[#098551]" />
      </div>
      <p className="text-[#098551] text-[18px] font-semibold mb-1">
        You broke it!
      </p>
      <p className="text-[#4B5563] dark:text-[#9CA3AF] text-[14px]">
        {prizePool
          ? `Prize pool of ${prizePool} 0G is being distributed.`
          : 'The challenge has been defeated.'}
      </p>
    </div>
  )
}

// ============================================================
//  WithdrawalCard
// ============================================================

function WithdrawalCard({
  challengeAddress,
  pendingAmount,
}: {
  challengeAddress: Address
  pendingAmount: bigint
}) {
  const [withdrawing, setWithdrawing] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const { withdrawAsync } = useWithdraw(challengeAddress)

  async function handleWithdraw() {
    setWithdrawing(true)
    setErr('')
    try {
      await withdrawAsync()
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Withdrawal failed.')
    } finally {
      setWithdrawing(false)
    }
  }

  const display = `${Number(formatEther(pendingAmount)).toFixed(4)} 0G`

  return (
    <GlassCard
      variant="accent"
      className="p-5 border border-[#098551]/30 bg-[#098551]/5"
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-full bg-[#098551]/15 flex items-center justify-center">
          <CheckCircle size={13} className="text-[#098551]" />
        </div>
        <span className="text-[#098551] text-[12px] font-semibold uppercase tracking-[0.5px]">
          Pending Withdrawal
        </span>
      </div>
      <p className="text-[28px] font-semibold text-[#098551] leading-tight tracking-[-0.02em] mb-3">
        {display}
      </p>
      {err && <p className="text-[#CF202F] text-[12px] mb-2">{err}</p>}
      {done ? (
        <p className="text-[#098551] text-[13px] font-medium">
          Withdrawn successfully.
        </p>
      ) : (
        <Button
          onPress={handleWithdraw}
          isLoading={withdrawing}
          isDisabled={withdrawing}
          className="w-full rounded-xl bg-[#098551] hover:bg-[#0a9e62] text-white text-[13px] font-semibold h-9"
        >
          {withdrawing ? 'Withdrawing...' : 'Withdraw'}
        </Button>
      )}
    </GlassCard>
  )
}

// ============================================================
//  ClaimExpiryCard
// ============================================================

function ClaimExpiryCard({ challengeAddress }: { challengeAddress: Address }) {
  const [claiming, setClaiming] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const { claimExpiryAsync } = useClaimExpiry(challengeAddress)

  async function handleClaim() {
    setClaiming(true)
    setErr('')
    try {
      await claimExpiryAsync()
      setDone(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Claim failed.')
    } finally {
      setClaiming(false)
    }
  }

  return (
    <GlassCard variant="subtle" className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <Clock size={13} className="text-[#6B7280]" />
        <span className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px]">
          Claim Expiry
        </span>
      </div>
      <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px] mb-3">
        This challenge expired with no winner. Reclaim your prize pool.
      </p>
      {err && <p className="text-[#CF202F] text-[12px] mb-2">{err}</p>}
      {done ? (
        <p className="text-[#098551] text-[13px] font-medium">
          Claimed successfully.
        </p>
      ) : (
        <Button
          onPress={handleClaim}
          isLoading={claiming}
          isDisabled={claiming}
          className="w-full rounded-xl bg-[#AF69EE] hover:bg-[#C28FF3] text-white text-[13px] font-semibold h-9"
        >
          {claiming ? 'Claiming...' : 'Claim Prize Pool'}
        </Button>
      )}
    </GlassCard>
  )
}

// ============================================================
//  Main page
// ============================================================

function ChallengePage() {
  const { id } = Route.useParams()
  const { address: userAddress, isConnected } = useAccount()
  const { isAuthenticated, login, ensureFreshCredentials } = useAuth()

  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [messages, setMessages] = useState<Array<LocalMessage>>([])
  const [latestResult, setLatestResult] = useState<AttackResult | null>(null)
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [commitRevealStep, setCommitRevealStep] =
    useState<CommitRevealStep>('idle')

  const { data: challenge, isLoading, isError } = useChallenge(id)

  const challengeAddress = challenge?.address as Address | undefined

  // On-chain prize pool (real-time)
  const { data: prizePoolOnChain } = useChallengePrizePool(challengeAddress)

  // Pending withdrawal for connected user
  const { data: pendingWithdrawal } = usePendingWithdrawal(
    challengeAddress,
    userAddress,
  )

  // Persistent conversation from 0G KV (primary)
  const { data: conversationData, isSuccess: conversationReady } =
    useConversation(id, userAddress ?? '', {
      enabled: !!userAddress && !!id,
    })

  // Ephemeral LRU history (fallback)
  const { data: historyData, isSuccess: historyReady } = useChatHistory(
    id,
    userAddress ?? '',
    {
      enabled:
        !!userAddress &&
        !!id &&
        conversationReady &&
        (conversationData?.messages?.length ?? 0) === 0,
    },
  )

  const { mutateAsync: attackAsync } = useAttack(id)
  const { startStream, abort: abortStream } = useStreamAttack(id)
  const { mutateAsync: commitAsync } = useCommitAttack(id)
  const { mutateAsync: revealAsync } = useRevealAttack(id)
  const { commitAttemptAsync } = useCommitAttempt(challengeAddress)

  // Load history into local state once — prefer conversation (0G KV), fall back to LRU
  useEffect(() => {
    if (historyLoaded) return

    if (conversationReady) {
      const msgs = conversationData?.messages ?? []
      if (msgs.length > 0) {
        setMessages(
          msgs.map((m, i) => ({
            id: `conv-${i}`,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          })),
        )
        setHistoryLoaded(true)
        return
      }
      // conversation returned empty, wait for history fallback
    }

    if (historyReady) {
      const msgs = historyData?.messages ?? []
      if (msgs.length > 0) {
        setMessages(
          msgs.map((m, i) => ({
            id: `history-${i}`,
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content,
          })),
        )
      }
      setHistoryLoaded(true)
    }
  }, [
    conversationReady,
    conversationData,
    historyReady,
    historyData,
    historyLoaded,
  ])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cleanup stream on unmount
  useEffect(() => {
    return () => abortStream()
  }, [abortStream])

  async function runCommitReveal(
    userMsg: string,
    asstMsgId: string,
    onResult: (result: AttackResult) => void,
    _onError: (err: string) => void,
  ): Promise<boolean> {
    if (!userAddress) return false

    try {
      // Step 1: backend commit
      setCommitRevealStep('committing')
      const commitRes = await commitAsync({
        message: userMsg,
        attacker: userAddress,
      })

      // Step 2: on-chain commitAttempt
      setCommitRevealStep('confirming')
      const messagePrice = BigInt(challenge?.messagePrice ?? '0')
      await commitAttemptAsync(
        commitRes.commitHash as `0x${string}`,
        messagePrice,
      )

      // Wait for the backend RPC node to index the on-chain tx.
      // Without this, hasValidCommit() often returns false on the backend.
      await new Promise((r) => setTimeout(r, 3000))

      // Step 3: backend reveal (retry up to 3 times with 2s gaps for RPC lag)
      setCommitRevealStep('revealing')
      let revealRes: Awaited<ReturnType<typeof revealAsync>> | null = null
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          revealRes = await revealAsync({ attacker: userAddress })
          break
        } catch (err) {
          const msg = err instanceof Error ? err.message : ''
          if (msg.includes('NO_ONCHAIN_COMMIT') && attempt < 2) {
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          throw err
        }
      }

      if (!revealRes) throw new Error('Reveal failed after retries')
      const reveal = revealRes

      setMessages((prev) =>
        prev.map((m) =>
          m.id === asstMsgId
            ? { ...m, content: reveal.response, streaming: false }
            : m,
        ),
      )

      const attackResult: AttackResult = {
        judgment: reveal.judgment,
        reason: reveal.reason,
        chatID: reveal.chatID,
        teeVerified: reveal.teeVerified,
        prizePool: reveal.prizePool,
      }
      setLatestResult(attackResult)
      setCommitRevealStep('done')
      onResult(attackResult)
      return true
    } catch {
      setCommitRevealStep('error')
      // Brief delay to show error state before fallback
      await new Promise((r) => setTimeout(r, 1200))
      setCommitRevealStep('idle')
      return false
    }
  }

  function runStreamFallback(
    userMsg: string,
    asstMsgId: string,
    onResult: (result: AttackResult) => void,
    onError: (err: string) => void,
  ) {
    let streamedContent = ''
    let streamSucceeded = false

    startStream(
      { message: userMsg, attacker: userAddress! },
      {
        onChunk: (chunk) => {
          streamedContent += chunk
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstMsgId ? { ...m, content: streamedContent } : m,
            ),
          )
        },
        onResult: (result: StreamResultEvent) => {
          streamSucceeded = true
          const attackResult: AttackResult = {
            judgment: result.judgment,
            reason: result.reason,
            chatID: result.chatID,
            teeVerified: result.teeVerified,
            prizePool: result.prizePool,
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstMsgId ? { ...m, streaming: false } : m,
            ),
          )
          setLatestResult(attackResult)
          onResult(attackResult)
        },
        onError: () => {
          if (streamSucceeded) return
          // Final fallback: non-streaming attack
          attackAsync({ message: userMsg, attacker: userAddress! })
            .then((res) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? { ...m, content: res.response, streaming: false }
                    : m,
                ),
              )
              const attackResult: AttackResult = {
                judgment: res.judgment,
                reason: res.reason,
                chatID: res.chatID,
                teeVerified: res.teeVerified,
                prizePool: res.prizePool,
              }
              setLatestResult(attackResult)
              onResult(attackResult)
            })
            .catch((err: unknown) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstMsgId
                    ? {
                        ...m,
                        content: 'Failed to get a response. Try again.',
                        streaming: false,
                      }
                    : m,
                ),
              )
              onError(err instanceof Error ? err.message : 'Attack failed.')
            })
        },
        onDone: () => {
          if (!streamSucceeded) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstMsgId ? { ...m, streaming: false } : m,
              ),
            )
          }
        },
      },
    )
  }

  async function handleMessageSent(
    userMsg: string,
    _onChunk: (chunk: string) => void,
    onResult: (result: AttackResult) => void,
    onError: (err: string) => void,
  ) {
    if (!userAddress) {
      onError('Wallet not connected.')
      return
    }

    // Ensure credentials are fresh (re-sign if close to 5-min backend window)
    try {
      await ensureFreshCredentials()
    } catch {
      onError('Failed to refresh wallet signature. Please sign in again.')
      return
    }

    const userMsgId = `user-${Date.now()}`
    const asstMsgId = `asst-${Date.now()}`

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: 'user', content: userMsg },
      { id: asstMsgId, role: 'assistant', content: '', streaming: true },
    ])
    setLatestResult(null)

    // Primary path: commit-reveal
    const crSuccess = await runCommitReveal(
      userMsg,
      asstMsgId,
      onResult,
      onError,
    )

    if (!crSuccess) {
      // Fallback to streaming attack
      runStreamFallback(userMsg, asstMsgId, onResult, onError)
    }
  }

  // ---- Loading state ----
  if (isLoading) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-10">
        <div className="max-w-[1000px] mx-auto">
          <Skeleton className="h-5 w-28 mb-8 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]" />
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
            <Skeleton className="h-[600px] rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
            <div className="flex flex-col gap-4">
              <Skeleton className="h-40 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
              <Skeleton className="h-48 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
              <Skeleton className="h-24 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- Error state ----
  if (isError || !challenge) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-20 flex items-center justify-center">
        <GlassCard className="text-center max-w-sm p-8">
          <p className="text-[#CF202F] text-[17px] font-medium mb-2">
            Challenge not found
          </p>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-sm mb-6">
            This challenge may not exist or the address is invalid.
          </p>
          <Link to="/challenges">
            <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-6 text-sm font-semibold">
              Back to Challenges
            </Button>
          </Link>
        </GlassCard>
      </div>
    )
  }

  // ---- Derived values ----
  const isActive = challenge.active === true
  const hasWinner = !!challenge.winner && challenge.winner !== ZERO_ADDRESS
  const isOwner =
    !!userAddress &&
    challenge.defender.toLowerCase() === userAddress.toLowerCase()

  // Prize pool: prefer on-chain bigint, fall back to backend ether string
  const prizePoolDisplay =
    prizePoolOnChain !== undefined
      ? `${Number(formatEther(prizePoolOnChain)).toFixed(4)} 0G`
      : `${parseFloat(challenge.prizePool).toFixed(4)} 0G`

  const messagePriceDisplay = `${formatEther(BigInt(challenge.messagePrice))} 0G`

  const challengeTypeLabel =
    CHALLENGE_TYPE_LABELS[challenge.challengeType] ?? 'Custom'

  const difficultyKey = (challenge.difficulty ?? '').toLowerCase()
  const difficultyColor =
    DIFFICULTY_COLORS[difficultyKey] ?? DIFFICULTY_COLORS.beginner

  const status: 'active' | 'resolved' | 'expired' | 'cancelled' = hasWinner
    ? 'resolved'
    : isActive
      ? 'active'
      : 'expired'

  const expiresAtUnix = parseInt(challenge.expiresAt, 10)

  // Show withdrawal card when user has pending funds
  const hasPendingWithdrawal =
    !!userAddress && !!pendingWithdrawal && pendingWithdrawal > 0n

  // Show claim expiry when: expired, defender, no winner
  const canClaimExpiry =
    isOwner && !isActive && !hasWinner && !!challengeAddress

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-10">
      <div className="max-w-[1000px] mx-auto">
        {/* Back nav */}
        <Link
          to="/challenges"
          className="inline-flex items-center gap-2 text-[#4B5563] dark:text-[#D1D5DB] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] text-sm mb-8 transition-colors"
        >
          <ArrowLeft size={14} />
          Challenges
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2.5 mb-3">
            <StatusBadge status={status} />

            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#AF69EE]/8 text-[#AF69EE] border border-[#AF69EE]/15">
              {challengeTypeLabel}
            </span>

            {challenge.difficulty && (
              <span
                className={cnm(
                  'inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium border capitalize',
                  difficultyColor,
                )}
              >
                {challenge.difficulty}
              </span>
            )}

            {challenge.model && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-medium bg-[#F3F4F6] dark:bg-[#1F2937] text-[#6B7280] dark:text-[#9CA3AF]">
                {challenge.model}
              </span>
            )}
          </div>

          <h1 className="text-[30px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.15] max-w-[680px]">
            {challenge.name}
          </h1>

          {challenge.description && (
            <p className="text-[#4B5563] dark:text-[#9CA3AF] text-[15px] leading-[1.55] mt-2 max-w-[660px]">
              {challenge.description}
            </p>
          )}
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* Left: Chat */}
          <GlassCard className="p-0 overflow-hidden flex flex-col min-h-[60vh] lg:min-h-[520px]">
            {/* Chat header */}
            <div className="px-5 py-4 border-b border-black/[0.06] dark:border-white/[0.06] flex items-center gap-3">
              <MessageSquare size={15} className="text-[#6B7280]" />
              <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold">
                Attack
              </span>
              <span className="text-[#9CA3AF] dark:text-[#6B7280] text-[13px]">
                {challenge.totalAttempts} attempt
                {challenge.totalAttempts !== 1 ? 's' : ''}
              </span>
              <a
                href={`https://chainscan-galileo.0g.ai/address/${challenge.address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-[12px] text-[#6B7280] hover:text-[#AF69EE] transition-colors"
              >
                <ExternalLink size={11} />
                0G Explorer
              </a>
            </div>

            {/* Victory banner */}
            {latestResult?.judgment === 'SUCCESS' && (
              <VictoryBanner prizePool={latestResult.prizePool} />
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 max-h-[420px] flex flex-col gap-4">
              {messages.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
                  <img
                    src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(id)}`}
                    alt=""
                    width={48}
                    height={48}
                    className="w-12 h-12 rounded-full mb-4"
                  />
                  <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-medium">
                    No attacks yet
                  </p>
                  <p className="text-[#9CA3AF] dark:text-[#6B7280] text-sm mt-1">
                    Be the first to challenge this AI agent.
                  </p>
                </div>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cnm(
                    'flex items-start gap-3',
                    msg.role === 'user' && 'justify-end',
                  )}
                >
                  {msg.role === 'assistant' && (
                    <img
                      src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(id)}`}
                      alt=""
                      width={28}
                      height={28}
                      className="w-7 h-7 rounded-full shrink-0 mt-0.5"
                    />
                  )}

                  <div
                    className={cnm(
                      'max-w-[82%] rounded-2xl px-4 py-2.5 text-[15px] leading-[1.5] break-words',
                      msg.role === 'user'
                        ? 'bg-[#AF69EE] text-white rounded-tr-sm'
                        : 'bg-[#F3F4F6] dark:bg-[#1F2937] text-[#0A0B0D] dark:text-[#F9FAFB] rounded-tl-sm',
                    )}
                  >
                    {msg.streaming && !msg.content ? (
                      <span className="flex gap-1 items-center py-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#6B7280] animate-bounce [animation-delay:0ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#6B7280] animate-bounce [animation-delay:150ms]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-[#6B7280] animate-bounce [animation-delay:300ms]" />
                      </span>
                    ) : (
                      msg.content
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-full bg-[#AF69EE]/10 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-[#AF69EE] text-[11px] font-bold">
                        {userAddress
                          ? userAddress.slice(2, 4).toUpperCase()
                          : 'U'}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Judgment result */}
              {latestResult && (
                <JudgmentBadge
                  judgment={latestResult.judgment}
                  teeVerified={latestResult.teeVerified}
                  chatID={latestResult.chatID}
                />
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Commit-reveal step indicator */}
            <CommitRevealStepIndicator step={commitRevealStep} />

            {/* Input */}
            <ChatInput
              challengeAddress={id}
              messagePriceWei={challenge.messagePrice}
              isActive={isActive}
              isConnected={isConnected}
              isAuthenticated={isAuthenticated}
              onLogin={login}
              userAddress={userAddress}
              onMessageSent={handleMessageSent}
              commitRevealStep={commitRevealStep}
            />
          </GlassCard>

          {/* Right: Sidebar */}
          <div className="flex flex-col gap-4">
            {/* Pending withdrawal */}
            {hasPendingWithdrawal && challengeAddress && (
              <WithdrawalCard
                challengeAddress={challengeAddress}
                pendingAmount={pendingWithdrawal}
              />
            )}

            {/* Claim expiry (defender only, expired, no winner) */}
            {canClaimExpiry && challengeAddress && (
              <ClaimExpiryCard challengeAddress={challengeAddress} />
            )}

            {/* Prize Pool */}
            <GlassCard variant="accent" className="p-5">
              <div className="flex items-center gap-2 mb-2">
                <Trophy size={15} className="text-[#AF69EE]" />
                <span className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px]">
                  Prize Pool
                </span>
              </div>
              <p className="text-[38px] font-semibold text-[#AF69EE] leading-tight tracking-[-0.02em]">
                {prizePoolDisplay}
              </p>
              <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] mt-1">
                Paid in native 0G tokens
              </p>
            </GlassCard>

            {/* Winner */}
            {hasWinner && (
              <GlassCard className="p-5 border border-[#098551]/25 bg-[#098551]/5">
                <div className="flex items-center gap-2 mb-2">
                  <Trophy size={14} className="text-[#098551]" />
                  <span className="text-[#098551] text-[12px] font-semibold uppercase tracking-[0.5px]">
                    Won by
                  </span>
                </div>
                <p className="text-[#AF69EE] font-mono text-[14px] font-medium break-all">
                  {challenge.winner &&
                    (challenge.winner === userAddress
                      ? 'You'
                      : truncateAddress(challenge.winner))}
                </p>
              </GlassCard>
            )}

            {/* Stats */}
            <GlassCard className="p-5">
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                    <MessageSquare size={13} />
                    Message price
                  </div>
                  <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[14px] font-semibold">
                    {messagePriceDisplay}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                    <Shield size={13} />
                    Total attempts
                  </div>
                  <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[14px] font-semibold">
                    {challenge.totalAttempts}
                  </span>
                </div>

                {challenge.defenderEarnings &&
                  parseFloat(challenge.defenderEarnings) > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                        <Trophy size={13} />
                        Defender earned
                      </div>
                      <span className="text-[#098551] text-[14px] font-semibold">
                        {parseFloat(challenge.defenderEarnings).toFixed(4)} 0G
                      </span>
                    </div>
                  )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                    <Clock size={13} />
                    {isActive ? 'Ends in' : 'Ended'}
                  </div>
                  {isActive ? (
                    <CountdownTimer endTime={expiresAtUnix} />
                  ) : (
                    <span className="text-[#9CA3AF] dark:text-[#6B7280] text-[13px]">
                      {new Date(expiresAtUnix * 1000).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            </GlassCard>

            {/* Defender */}
            <GlassCard variant="subtle" className="p-4">
              <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-2">
                Defender
              </p>
              <p className="text-[#AF69EE] font-mono text-[14px] font-medium break-all">
                {isOwner ? 'You' : truncateAddress(challenge.defender)}
              </p>
            </GlassCard>

            {/* Alignment data */}
            {challenge.challengeType === 2 && challenge.alignmentData && (
              <GlassCard variant="subtle" className="p-4">
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-3">
                  Alignment
                </p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                      Total samples
                    </span>
                    <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[13px] font-semibold">
                      {challenge.alignmentData.totalSamples}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                      Reward / attempt
                    </span>
                    <span className="text-[#098551] text-[13px] font-semibold">
                      {formatEther(
                        BigInt(challenge.alignmentData.rewardPerAttempt),
                      )}{' '}
                      0G
                    </span>
                  </div>
                </div>
              </GlassCard>
            )}

            {/* System prompt hash */}
            {challenge.systemPromptHash && (
              <GlassCard variant="subtle" className="p-4">
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-2">
                  System Prompt Hash
                </p>
                <a
                  href={`https://chainscan-galileo.0g.ai/address/${challenge.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-1.5"
                >
                  <p className="text-[#4B5563] dark:text-[#D1D5DB] font-mono text-[11px] break-all group-hover:text-[#AF69EE] transition-colors">
                    {challenge.systemPromptHash}
                  </p>
                  <ExternalLink
                    size={11}
                    className="text-[#9CA3AF] group-hover:text-[#AF69EE] shrink-0 mt-0.5 transition-colors"
                  />
                </a>
              </GlassCard>
            )}

            {/* Explorer link */}
            <a
              href={`https://chainscan-galileo.0g.ai/address/${challenge.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 text-[#6B7280] hover:text-[#AF69EE] text-[13px] py-2 transition-colors"
            >
              <ExternalLink size={13} />
              View on 0G Chain Explorer
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
