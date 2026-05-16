import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  ExternalLink,
  Key,
  XCircle,
} from 'lucide-react'
import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Spinner,
  Tooltip,
} from '@heroui/react'
import { useAccount } from 'wagmi'
import { useAuth } from '@/hooks/useAuth'
import {
  useAgent,
  useAgentAttestations,
  useAgentExecutors,
  useAgentPrompt,
  useAgentScore,
  useAuthorizeAgent,
  useCloneAgent,
  useRevokeAgent,
  useTransferAgent,
} from '@/lib/api/hooks'
import { cnm } from '@/utils/style'
import GlassCard from '@/components/GlassCard'

export const Route = createFileRoute('/agent/$tokenId')({
  component: AgentDetailPage,
})

// ============================================================
//  Helpers
// ============================================================

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function truncateHash(hash: string): string {
  return `${hash.slice(0, 10)}...${hash.slice(-8)}`
}

function scoreColor(pct: number): string {
  if (pct >= 70) return 'bg-[#098551]'
  if (pct >= 40) return 'bg-[#ED702F]'
  return 'bg-[#CF202F]'
}

function scoreTextColor(pct: number): string {
  if (pct >= 70) return 'text-[#098551]'
  if (pct >= 40) return 'text-[#ED702F]'
  return 'text-[#CF202F]'
}

function formatDate(ts: number): string {
  if (!ts || ts === 0) return 'N/A'
  const ms = ts > 1e12 ? ts : ts * 1000
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

function isHexHash(value: string): boolean {
  return /^(0x)?[0-9a-fA-F]+$/.test(value)
}

// ============================================================
//  Inline feedback banner
// ============================================================

type FeedbackState =
  | { type: 'idle' }
  | { type: 'success'; msg: string; txHash?: string }
  | { type: 'error'; msg: string }

function FeedbackBanner({ state }: { state: FeedbackState }) {
  if (state.type === 'idle') return null
  const isSuccess = state.type === 'success'
  const txHash = state.type === 'success' ? state.txHash : undefined
  return (
    <div
      className={cnm(
        'flex items-start gap-2 rounded-xl px-4 py-3 border text-[13px]',
        isSuccess
          ? 'bg-[#098551]/10 border-[#098551]/20 text-[#098551]'
          : 'bg-[#CF202F]/10 border-[#CF202F]/20 text-[#CF202F]',
      )}
    >
      {isSuccess ? (
        <CheckCircle size={14} className="mt-px shrink-0" />
      ) : (
        <XCircle size={14} className="mt-px shrink-0" />
      )}
      <span>
        {state.msg}
        {txHash && (
          <>
            {' '}
            <a
              href={`https://chainscan.0g.ai/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono underline underline-offset-2 hover:text-[#AF69EE] transition-colors"
            >
              {truncateHash(txHash)}
              <ExternalLink size={11} className="inline shrink-0" />
            </a>
          </>
        )}
      </span>
    </div>
  )
}

// ============================================================
//  CopyButton
// ============================================================

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <Tooltip content={copied ? 'Copied!' : 'Copy'}>
      <button
        onClick={handleCopy}
        className="text-[#6B7280] hover:text-[#AF69EE] transition-colors"
        aria-label="Copy hash"
      >
        <Copy size={12} />
      </button>
    </Tooltip>
  )
}

// ============================================================
//  Transfer card
// ============================================================

function TransferCard({
  tokenId,
  ensureFreshCredentials,
}: {
  tokenId: number
  ensureFreshCredentials: () => Promise<void>
}) {
  const [to, setTo] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackState>({ type: 'idle' })
  const { mutateAsync, isPending } = useTransferAgent(tokenId)

  const isValid = isValidAddress(to)

  async function handleTransfer() {
    setShowConfirm(false)
    setFeedback({ type: 'idle' })
    try {
      await ensureFreshCredentials()
      const res = await mutateAsync({ to })
      setFeedback({
        type: 'success',
        msg: `Transferred.${res.reencrypted ? ' TEE re-encrypted.' : ''} Tx:`,
        txHash: res.txHash,
      })
      setTo('')
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Transfer failed.',
      })
    }
  }

  return (
    <>
      <GlassCard className="p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold">
            Transfer
          </span>
        </div>

        <div className="text-[12px] text-[#ED702F] bg-[#ED702F]/8 border border-[#ED702F]/20 rounded-xl px-3 py-2 leading-relaxed">
          Transferring this agent triggers a TEE re-encryption of the system
          prompt for the new owner. This action is irreversible.
        </div>

        <Input
          value={to}
          onValueChange={setTo}
          placeholder="0x... recipient address"
          variant="bordered"
          size="sm"
          classNames={{
            input:
              'text-[#0A0B0D] dark:text-[#F9FAFB] font-mono text-[13px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#6B7280]',
            inputWrapper:
              'border-[#E5E7EB] dark:border-[#2D2F36] bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl data-[focus=true]:border-[#AF69EE]',
          }}
        />

        <FeedbackBanner state={feedback} />

        <Button
          onPress={() => setShowConfirm(true)}
          isDisabled={!isValid || isPending}
          isLoading={isPending}
          className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white text-[14px] font-semibold rounded-xl h-10 transition-colors"
        >
          {isPending ? <Spinner size="sm" color="white" /> : 'Transfer Agent'}
        </Button>
      </GlassCard>

      <Modal
        isOpen={showConfirm}
        onClose={() => setShowConfirm(false)}
        placement="center"
      >
        <ModalContent className="bg-[#141518] border border-[#2D2F36]">
          <ModalHeader className="text-[#F9FAFB] text-[16px] font-semibold">
            Confirm Transfer
          </ModalHeader>
          <ModalBody>
            <p className="text-[#9CA3AF] text-[14px] leading-relaxed">
              You are about to transfer agent{' '}
              <span className="text-[#F9FAFB] font-mono font-semibold">
                #{tokenId}
              </span>{' '}
              to:
            </p>
            <p className="text-[#AF69EE] font-mono text-[13px] break-all mt-1">
              {to}
            </p>
            <p className="text-[#ED702F] text-[13px] mt-3">
              This cannot be undone. The system prompt will be re-encrypted for
              the new owner.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => setShowConfirm(false)}
              className="text-[#9CA3AF] hover:text-[#F9FAFB]"
            >
              Cancel
            </Button>
            <Button
              onPress={handleTransfer}
              className="bg-[#CF202F] hover:bg-[#991B1B] text-white font-semibold rounded-xl"
            >
              Confirm Transfer
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

// ============================================================
//  Clone card
// ============================================================

function CloneCard({
  tokenId,
  ensureFreshCredentials,
}: {
  tokenId: number
  ensureFreshCredentials: () => Promise<void>
}) {
  const [to, setTo] = useState('')
  const [feedback, setFeedback] = useState<FeedbackState>({ type: 'idle' })
  const { mutateAsync, isPending } = useCloneAgent(tokenId)

  const isValid = isValidAddress(to)

  async function handleClone() {
    setFeedback({ type: 'idle' })
    try {
      await ensureFreshCredentials()
      const res = await mutateAsync({ to })
      setFeedback({
        type: 'success',
        msg: `Cloned to token #${res.newTokenId}. Tx:`,
        txHash: res.txHash,
      })
      setTo('')
    } catch (err) {
      setFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Clone failed.',
      })
    }
  }

  return (
    <GlassCard className="p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold">
          Clone
        </span>
      </div>

      <p className="text-[12px] text-[#6B7280]">
        Creates a new iNFT with a TEE re-encrypted copy of this agent for the
        recipient. Your original remains intact.
      </p>

      <Input
        value={to}
        onValueChange={setTo}
        placeholder="0x... recipient address"
        variant="bordered"
        size="sm"
        classNames={{
          input:
            'text-[#0A0B0D] dark:text-[#F9FAFB] font-mono text-[13px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#6B7280]',
          inputWrapper:
            'border-[#E5E7EB] dark:border-[#2D2F36] bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl data-[focus=true]:border-[#AF69EE]',
        }}
      />

      <FeedbackBanner state={feedback} />

      <Button
        onPress={handleClone}
        isDisabled={!isValid || isPending}
        isLoading={isPending}
        className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white text-[14px] font-semibold rounded-xl h-10 transition-colors"
      >
        {isPending ? <Spinner size="sm" color="white" /> : 'Clone Agent'}
      </Button>
    </GlassCard>
  )
}

// ============================================================
//  Authorization card
// ============================================================

function AuthorizationCard({
  tokenId,
  ensureFreshCredentials,
}: {
  tokenId: number
  ensureFreshCredentials: () => Promise<void>
}) {
  const [executor, setExecutor] = useState('')
  const [permissions, setPermissions] = useState('')
  const [revokeExecutor, setRevokeExecutor] = useState('')
  const [authFeedback, setAuthFeedback] = useState<FeedbackState>({
    type: 'idle',
  })
  const [revokeFeedback, setRevokeFeedback] = useState<FeedbackState>({
    type: 'idle',
  })

  const { mutateAsync: authorize, isPending: isAuthorizing } =
    useAuthorizeAgent(tokenId)
  const { mutateAsync: revoke, isPending: isRevoking } = useRevokeAgent(tokenId)

  const canAuthorize = isValidAddress(executor) && permissions.trim().length > 0
  const canRevoke = isValidAddress(revokeExecutor)

  async function handleAuthorize() {
    setAuthFeedback({ type: 'idle' })
    try {
      await ensureFreshCredentials()
      const res = await authorize({ executor, permissions: permissions.trim() })
      setAuthFeedback({
        type: 'success',
        msg: 'Authorized. Tx:',
        txHash: res.txHash,
      })
      setExecutor('')
      setPermissions('')
    } catch (err) {
      setAuthFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Authorization failed.',
      })
    }
  }

  async function handleRevoke() {
    setRevokeFeedback({ type: 'idle' })
    try {
      await ensureFreshCredentials()
      const res = await revoke({ executor: revokeExecutor })
      setRevokeFeedback({
        type: 'success',
        msg: 'Revoked. Tx:',
        txHash: res.txHash,
      })
      setRevokeExecutor('')
    } catch (err) {
      setRevokeFeedback({
        type: 'error',
        msg: err instanceof Error ? err.message : 'Revoke failed.',
      })
    }
  }

  return (
    <GlassCard className="p-5 flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold">
          Authorization
        </span>
      </div>

      {/* Authorize section */}
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-[#9CA3AF] dark:text-[#6B7280] font-semibold uppercase tracking-[0.4px]">
          Grant Access
        </p>
        <Input
          value={executor}
          onValueChange={setExecutor}
          placeholder="0x... executor address"
          variant="bordered"
          size="sm"
          classNames={{
            input:
              'text-[#0A0B0D] dark:text-[#F9FAFB] font-mono text-[13px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#6B7280]',
            inputWrapper:
              'border-[#E5E7EB] dark:border-[#2D2F36] bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl data-[focus=true]:border-[#AF69EE]',
          }}
        />
        <Input
          value={permissions}
          onValueChange={setPermissions}
          placeholder="Permissions (e.g. read,execute)"
          variant="bordered"
          size="sm"
          classNames={{
            input:
              'text-[#0A0B0D] dark:text-[#F9FAFB] text-[13px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#6B7280]',
            inputWrapper:
              'border-[#E5E7EB] dark:border-[#2D2F36] bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl data-[focus=true]:border-[#AF69EE]',
          }}
        />
        <FeedbackBanner state={authFeedback} />
        <Button
          onPress={handleAuthorize}
          isDisabled={!canAuthorize || isAuthorizing}
          isLoading={isAuthorizing}
          className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white text-[14px] font-semibold rounded-xl h-10 transition-colors"
        >
          {isAuthorizing ? <Spinner size="sm" color="white" /> : 'Authorize'}
        </Button>
      </div>

      <div className="h-px bg-black/[0.06] dark:bg-white/[0.06]" />

      {/* Revoke section */}
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-[#9CA3AF] dark:text-[#6B7280] font-semibold uppercase tracking-[0.4px]">
          Revoke Access
        </p>
        <Input
          value={revokeExecutor}
          onValueChange={setRevokeExecutor}
          placeholder="0x... executor to revoke"
          variant="bordered"
          size="sm"
          classNames={{
            input:
              'text-[#0A0B0D] dark:text-[#F9FAFB] font-mono text-[13px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#6B7280]',
            inputWrapper:
              'border-[#E5E7EB] dark:border-[#2D2F36] bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl data-[focus=true]:border-[#AF69EE]',
          }}
        />
        <FeedbackBanner state={revokeFeedback} />
        <Button
          onPress={handleRevoke}
          isDisabled={!canRevoke || isRevoking}
          isLoading={isRevoking}
          variant="bordered"
          className="border-[#CF202F]/40 text-[#CF202F] hover:bg-[#CF202F]/8 text-[14px] font-semibold rounded-xl h-10 transition-colors"
        >
          {isRevoking ? <Spinner size="sm" color="danger" /> : 'Revoke'}
        </Button>
      </div>
    </GlassCard>
  )
}

// ============================================================
//  System prompt card
// ============================================================

function SystemPromptCard({ tokenId }: { tokenId: number }) {
  const { ensureFreshCredentials } = useAuth()
  const [prompt, setPrompt] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const { mutateAsync, isPending } = useAgentPrompt(tokenId)

  async function handleDecrypt() {
    setErrorMsg(null)
    setPrompt(null)
    try {
      await ensureFreshCredentials()
      const res = await mutateAsync()
      setPrompt(res.systemPrompt)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed.'
      if (
        msg.includes('403') ||
        msg.toLowerCase().includes('forbidden') ||
        msg.toLowerCase().includes('not authorized')
      ) {
        setErrorMsg('You are not authorized to view this prompt.')
      } else {
        setErrorMsg(msg)
      }
    }
  }

  function handleHide() {
    setPrompt(null)
    setErrorMsg(null)
  }

  return (
    <GlassCard className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key size={13} className="text-[#AF69EE]" />
          <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px]">
            System Prompt
          </p>
        </div>
        {prompt && (
          <button
            onClick={handleHide}
            className="text-[11px] text-[#AF69EE] hover:text-[#C28FF3] font-medium transition-colors"
          >
            Hide
          </button>
        )}
      </div>

      {!prompt && !errorMsg && (
        <Button
          onPress={handleDecrypt}
          isDisabled={isPending}
          variant="bordered"
          size="sm"
          className="border-[#E5E7EB] dark:border-[#2D2F36] text-[#4B5563] dark:text-[#9CA3AF] hover:border-[#AF69EE] hover:text-[#AF69EE] text-[13px] font-medium rounded-xl h-9 transition-colors"
          startContent={isPending ? <Spinner size="sm" /> : <Key size={13} />}
        >
          {isPending ? 'Decrypting...' : 'Decrypt System Prompt'}
        </Button>
      )}

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-xl px-3 py-2.5 border bg-[#CF202F]/10 border-[#CF202F]/20 text-[#CF202F] text-[12px] leading-relaxed">
          <XCircle size={13} className="mt-px shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {prompt && (
        <div className="bg-[#F9FAFB] dark:bg-[#0A0B0D]/60 border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl px-3.5 py-3 max-h-64 overflow-y-auto">
          <pre className="text-[13px] text-[#0A0B0D] dark:text-[#F9FAFB] font-mono leading-relaxed whitespace-pre-wrap break-words">
            {prompt}
          </pre>
        </div>
      )}
    </GlassCard>
  )
}

// ============================================================
//  Loading skeleton
// ============================================================

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-10">
      <div className="max-w-[1000px] mx-auto">
        <Skeleton className="h-5 w-28 mb-8 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]" />
        <Skeleton className="h-8 w-64 mb-2 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]" />
        <Skeleton className="h-5 w-40 mb-10 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
            <Skeleton className="h-48 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
            <Skeleton className="h-40 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-44 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
            <Skeleton className="h-44 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
            <Skeleton className="h-64 rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
//  Main page
// ============================================================

function AgentDetailPage() {
  const { tokenId } = Route.useParams()
  const tokenIdNum = parseInt(tokenId, 10)

  const { address: userAddress } = useAccount()
  const { ensureFreshCredentials } = useAuth()

  const { data: agent, isLoading, isError } = useAgent(tokenIdNum)
  const { data: scoreData } = useAgentScore(tokenIdNum)
  const { data: attestationData } = useAgentAttestations(tokenIdNum)
  const { data: executorsData } = useAgentExecutors(tokenIdNum)

  if (isLoading) return <PageSkeleton />

  if (isError || !agent) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-20 flex items-center justify-center">
        <GlassCard className="text-center max-w-sm p-8">
          <p className="text-[#CF202F] text-[17px] font-medium mb-2">
            Agent not found
          </p>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-sm mb-6">
            Token #{tokenId} does not exist or could not be loaded.
          </p>
          <Link to="/agent">
            <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-6 text-sm font-semibold">
              Back to Agents
            </Button>
          </Link>
        </GlassCard>
      </div>
    )
  }

  const isOwner =
    !!userAddress && agent.owner.toLowerCase() === userAddress.toLowerCase()

  const isClone =
    agent.challengeAddress === '0x0000000000000000000000000000000000000000'

  // Security score: BPS (0-10000) -> percentage (0-100)
  const livScore = scoreData?.securityScore ?? agent.securityScore
  const scorePct = Math.min(100, Math.max(0, livScore / 100))

  const survivalRate =
    agent.totalAttempts > 0
      ? ((agent.attemptsSurvived / agent.totalAttempts) * 100).toFixed(1)
      : '100.0'

  const attestations = attestationData?.attestationHashes ?? []
  const attestationCount = attestationData?.count ?? agent.attestationCount ?? 0
  const executors = executorsData?.executors ?? []

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-10">
      <div className="max-w-[1000px] mx-auto">
        {/* Back nav */}
        <Link
          to="/agent"
          className="inline-flex items-center gap-2 text-[#4B5563] dark:text-[#D1D5DB] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] text-sm mb-8 transition-colors"
        >
          <ArrowLeft size={14} />
          My Agents
        </Link>

        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2.5 mb-3">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#AF69EE]/8 text-[#AF69EE] border border-[#AF69EE]/15 font-mono">
              #{agent.tokenId}
            </span>

            <span
              className={cnm(
                'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12px] font-semibold border',
                agent.breached
                  ? 'bg-[#CF202F]/10 text-[#CF202F] border-[#CF202F]/20'
                  : 'bg-[#098551]/10 text-[#098551] border-[#098551]/20',
              )}
            >
              {agent.breached ? 'Breached' : 'Active'}
            </span>

            {isOwner && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold bg-[#F3F4F6] dark:bg-[#1F2937] text-[#6B7280] dark:text-[#9CA3AF]">
                You own this
              </span>
            )}
          </div>

          <h1 className="text-[30px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.15] mb-1">
            Agent NFT #{agent.tokenId}
          </h1>
          <p className="text-[#4B5563] dark:text-[#9CA3AF] text-[15px]">
            {agent.model}
          </p>
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">
          {/* Left column */}
          <div className="flex flex-col gap-5">
            {/* Security score */}
            <GlassCard variant="accent" className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px]">
                    Security Score
                  </span>
                </div>
                <span
                  className={cnm(
                    'text-[28px] font-semibold tabular-nums tracking-[-0.02em]',
                    scoreTextColor(scorePct),
                  )}
                >
                  {scorePct.toFixed(1)}
                  <span className="text-[16px] font-normal text-[#9CA3AF] ml-0.5">
                    %
                  </span>
                </span>
              </div>

              <div className="h-2 rounded-full bg-[#F3F4F6] dark:bg-[#0A0B0D]/60 overflow-hidden mb-2">
                <div
                  className={cnm(
                    'h-full rounded-full transition-all duration-700',
                    scoreColor(scorePct),
                  )}
                  style={{ width: `${scorePct}%` }}
                />
              </div>

              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-[#9CA3AF] dark:text-[#6B7280]">
                  {livScore.toLocaleString()} / 10,000 BPS
                </span>
                <span
                  className={cnm(
                    'text-[11px] font-semibold',
                    scoreTextColor(scorePct),
                  )}
                >
                  {scorePct >= 70
                    ? 'Strong'
                    : scorePct >= 40
                      ? 'Moderate'
                      : 'Vulnerable'}
                </span>
              </div>
            </GlassCard>

            {/* Stats */}
            <GlassCard className="p-5">
              <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-4">
                Stats
              </p>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl p-3">
                  <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-wide mb-0.5">
                    Total Attempts
                  </p>
                  <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[22px] font-semibold tabular-nums">
                    {agent.totalAttempts}
                  </p>
                </div>
                <div className="bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl p-3">
                  <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-wide mb-0.5">
                    Survived
                  </p>
                  <p className="text-[#098551] text-[22px] font-semibold tabular-nums">
                    {agent.attemptsSurvived}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between py-2 border-t border-black/[0.05] dark:border-white/[0.05]">
                  <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                    Survival rate
                  </span>
                  <span
                    className={cnm(
                      'text-[14px] font-semibold tabular-nums',
                      parseFloat(survivalRate) >= 70
                        ? 'text-[#098551]'
                        : parseFloat(survivalRate) >= 40
                          ? 'text-[#ED702F]'
                          : 'text-[#CF202F]',
                    )}
                  >
                    {survivalRate}%
                  </span>
                </div>

                <div className="flex items-center justify-between py-2 border-t border-black/[0.05] dark:border-white/[0.05]">
                  <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                    Created
                  </span>
                  <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[13px] font-medium">
                    {formatDate(agent.createdAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between py-2 border-t border-black/[0.05] dark:border-white/[0.05]">
                  <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px]">
                    Resolved
                  </span>
                  <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[13px] font-medium">
                    {agent.resolvedAt && agent.resolvedAt > 0
                      ? formatDate(agent.resolvedAt)
                      : 'Ongoing'}
                  </span>
                </div>
              </div>
            </GlassCard>

            {/* Attestations */}
            <GlassCard className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px]">
                  TEE Attestations
                </p>
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#AF69EE] bg-[#AF69EE]/8 border border-[#AF69EE]/15 px-2 py-0.5 rounded-full">
                  {attestationCount}
                </span>
              </div>

              {attestations.length === 0 ? (
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[13px]">
                  No attestation hashes recorded yet.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {attestations.map((hash) => {
                    const explorerUrl = isHexHash(hash)
                      ? `https://chainscan.0g.ai/tx/${hash}`
                      : undefined
                    return (
                      <div
                        key={hash}
                        className="flex items-center gap-2 bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl px-3 py-2"
                      >
                        <span className="font-mono text-[12px] text-[#4B5563] dark:text-[#D1D5DB] flex-1 truncate">
                          {truncateHash(hash)}
                        </span>
                        <CopyButton text={hash} />
                        {explorerUrl && (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#6B7280] hover:text-[#AF69EE] transition-colors"
                            aria-label="View on explorer"
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </GlassCard>

            {/* Authorized Executors */}
            <GlassCard className="p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px]">
                  Authorized Executors
                </p>
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#ED702F] bg-[#ED702F]/8 border border-[#ED702F]/15 px-2 py-0.5 rounded-full">
                  <Key size={10} />
                  {executors.length}
                </span>
              </div>

              {executors.length === 0 ? (
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[13px]">
                  No authorized executors.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {executors.map((entry) => (
                    <div
                      key={entry.executor}
                      className="flex items-center gap-2 bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl px-3 py-2"
                    >
                      <span className="font-mono text-[12px] text-[#4B5563] dark:text-[#D1D5DB] flex-1 truncate">
                        {truncateAddress(entry.executor)}
                      </span>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[#ED702F]/10 text-[#ED702F] border border-[#ED702F]/20 uppercase tracking-[0.3px] shrink-0">
                        {entry.permissions}
                      </span>
                      <CopyButton text={entry.executor} />
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-5">
            {/* Owner info */}
            <GlassCard variant="subtle" className="p-4">
              <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-2">
                Owner
              </p>
              <p className="text-[#AF69EE] font-mono text-[14px] font-medium break-all">
                {isOwner ? 'You' : truncateAddress(agent.owner)}
              </p>
              {!isOwner && (
                <p className="text-[#9CA3AF] dark:text-[#6B7280] font-mono text-[11px] mt-0.5 break-all">
                  {agent.owner}
                </p>
              )}
            </GlassCard>

            {/* Challenge link / Clone badge */}
            {isClone ? (
              <>
                <GlassCard className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-1">
                        Origin
                      </p>
                      <p className="text-[#6B7280] dark:text-[#9CA3AF] text-[13px] font-medium">
                        Cloned Agent
                      </p>
                      <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[11px] mt-0.5">
                        This agent was cloned from another agent
                      </p>
                    </div>
                    <Copy size={14} className="text-[#6B7280] shrink-0" />
                  </div>
                </GlassCard>

                {isOwner && (
                  <Link
                    to="/challenges/create"
                    search={{ fromAgent: tokenIdNum }}
                    className="block"
                  >
                    <Button className="w-full bg-[#AF69EE] hover:bg-[#C28FF3] text-white text-[14px] font-semibold rounded-xl h-11 transition-colors">
                      Deploy to Challenge
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <Link
                to="/challenges/$id"
                params={{ id: agent.challengeAddress }}
                className="block"
              >
                <GlassCard hover className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] mb-1">
                        Challenge
                      </p>
                      <p className="text-[#AF69EE] font-mono text-[13px] font-medium">
                        {truncateAddress(agent.challengeAddress)}
                      </p>
                    </div>
                    <ExternalLink
                      size={14}
                      className="text-[#AF69EE] shrink-0"
                    />
                  </div>
                </GlassCard>
              </Link>
            )}

            {/* System prompt */}
            {!!userAddress && <SystemPromptCard tokenId={tokenIdNum} />}

            {/* Explorer link */}
            {!isClone && (
              <a
                href={`https://chainscan.0g.ai/address/${agent.challengeAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 text-[#6B7280] hover:text-[#AF69EE] text-[13px] py-2 transition-colors"
              >
                <ExternalLink size={13} />
                View on 0G Chain Explorer
              </a>
            )}

            {/* Owner-only actions */}
            {isOwner && (
              <>
                <div className="h-px bg-black/[0.06] dark:bg-white/[0.06]" />
                <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] font-semibold uppercase tracking-[0.5px] -mb-1">
                  Owner Actions
                </p>
                <TransferCard
                  tokenId={tokenIdNum}
                  ensureFreshCredentials={ensureFreshCredentials}
                />
                <CloneCard
                  tokenId={tokenIdNum}
                  ensureFreshCredentials={ensureFreshCredentials}
                />
                <AuthorizationCard
                  tokenId={tokenIdNum}
                  ensureFreshCredentials={ensureFreshCredentials}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
