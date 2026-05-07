import { Link, createFileRoute } from '@tanstack/react-router'
import { Skeleton } from '@heroui/react'
import { ExternalLink, ShieldCheck, ShieldX } from 'lucide-react'
import { useAccount } from 'wagmi'
import type { Agent } from '@/lib/api/hooks'
import { useAgents } from '@/lib/api/hooks'
import { cnm } from '@/utils/style'
import GlassCard from '@/components/GlassCard'

export const Route = createFileRoute('/agent/')({ component: AgentPage })

function scoreColor(score: number): string {
  if (score >= 70) return 'bg-[#098551]'
  if (score >= 40) return 'bg-[#ED702F]'
  return 'bg-[#CF202F]'
}

function scoreTextColor(score: number): string {
  if (score >= 70) return 'text-[#098551]'
  if (score >= 40) return 'text-[#ED702F]'
  return 'text-[#CF202F]'
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function AgentCard({ agent }: { agent: Agent }) {
  const createdDate = new Date(
    agent.createdAt > 1e12 ? agent.createdAt : agent.createdAt * 1000,
  ).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  const scoreBarWidth = Math.min(100, Math.max(0, agent.securityScore))

  return (
    <Link
      to="/agent/$tokenId"
      params={{ tokenId: String(agent.tokenId) }}
      className="block group"
    >
      <GlassCard hover className="p-5 flex flex-col gap-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[#AF69EE]/10 text-[#AF69EE] font-mono">
              #{agent.tokenId}
            </span>
            <span className="text-[12px] text-[#9CA3AF] dark:text-[#6B7280] font-mono truncate max-w-[120px]">
              {truncateAddress(agent.challengeAddress)}
            </span>
          </div>
          <span
            className={cnm(
              'text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0',
              agent.breached
                ? 'bg-[#FEF2F2] dark:bg-[#CF202F]/10 text-[#991B1B] dark:text-[#CF202F]'
                : 'bg-[#ECFDF5] dark:bg-[#098551]/10 text-[#065F46] dark:text-[#098551]',
            )}
          >
            {agent.breached ? <ShieldX size={10} /> : <ShieldCheck size={10} />}
            {agent.breached ? 'Breached' : 'Survived'}
          </span>
        </div>

        {/* Model */}
        <div>
          <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold truncate">
            {agent.model}
          </p>
          <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] mt-0.5">
            Created {createdDate}
          </p>
        </div>

        {/* Security score */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px]">
              Security Score
            </span>
            <span
              className={cnm(
                'text-[13px] font-semibold tabular-nums',
                scoreTextColor(agent.securityScore),
              )}
            >
              {agent.securityScore}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-[#F3F4F6] dark:bg-[#2D2F36] overflow-hidden">
            <div
              className={cnm(
                'h-full rounded-full transition-all duration-500',
                scoreColor(agent.securityScore),
              )}
              style={{ width: `${scoreBarWidth}%` }}
            />
          </div>
        </div>

        {/* Attempts */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl p-3">
            <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-wide mb-0.5">
              Total
            </p>
            <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[18px] font-semibold tabular-nums">
              {agent.totalAttempts}
            </p>
          </div>
          <div className="bg-[#F9FAFB] dark:bg-[#0A0B0D]/40 rounded-xl p-3">
            <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-wide mb-0.5">
              Survived
            </p>
            <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[18px] font-semibold tabular-nums">
              {agent.attemptsSurvived}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-1 border-t border-black/[0.05] dark:border-white/[0.05]">
          {agent.attestationCount !== undefined && (
            <span className="text-[12px] text-[#9CA3AF] dark:text-[#6B7280]">
              {agent.attestationCount} attestation
              {agent.attestationCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-[12px] text-[#AF69EE] flex items-center gap-1 ml-auto group-hover:underline">
            View agent <ExternalLink size={11} />
          </span>
        </div>
      </GlassCard>
    </Link>
  )
}

function SkeletonCard() {
  return (
    <GlassCard className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-20 rounded-full bg-[#F3F4F6] dark:bg-[#1F2125]" />
        <Skeleton className="h-5 w-16 rounded-full bg-[#F3F4F6] dark:bg-[#1F2125]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-3/4 rounded-lg bg-[#F3F4F6] dark:bg-[#1F2125]" />
        <Skeleton className="h-4 w-1/2 rounded-lg bg-[#F3F4F6] dark:bg-[#1F2125]" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex justify-between">
          <Skeleton className="h-4 w-24 rounded-lg bg-[#F3F4F6] dark:bg-[#1F2125]" />
          <Skeleton className="h-4 w-8 rounded-lg bg-[#F3F4F6] dark:bg-[#1F2125]" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full bg-[#F3F4F6] dark:bg-[#1F2125]" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-16 rounded-xl bg-[#F3F4F6] dark:bg-[#1F2125]" />
        <Skeleton className="h-16 rounded-xl bg-[#F3F4F6] dark:bg-[#1F2125]" />
      </div>
    </GlassCard>
  )
}

function AgentPage() {
  const { address, isConnected } = useAccount()
  const { data, isLoading, isError } = useAgents(address ?? '', {
    enabled: !!address && isConnected,
  })

  const agents = data?.agents ?? []

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-6 md:px-10 py-12">
      <div className="max-w-[980px] mx-auto">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1] mb-2">
            My Agents
          </h1>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px] max-w-[520px]">
            ERC-7857 iNFT agents minted per challenge. Each agent carries an
            encrypted system prompt and an on-chain security score verified
            through 0G TEE attestations.
          </p>
        </div>

        {/* Not connected */}
        {!isConnected && (
          <GlassCard className="py-16 text-center">
            <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-semibold mb-2">
              Connect your wallet
            </p>
            <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[14px]">
              Connect to see the iNFT agents associated with your address.
            </p>
          </GlassCard>
        )}

        {/* Loading */}
        {isConnected && isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {/* Error */}
        {isConnected && isError && (
          <GlassCard className="py-16 text-center">
            <p className="text-[#CF202F] text-[15px] font-semibold mb-1">
              Failed to load agents
            </p>
            <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[13px]">
              The backend may be unavailable. Try refreshing the page.
            </p>
          </GlassCard>
        )}

        {/* Empty state */}
        {isConnected && !isLoading && !isError && agents.length === 0 && (
          <GlassCard className="py-16 text-center">
            <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-semibold mb-2">
              No agents yet
            </p>
            <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[14px] max-w-[320px] mx-auto">
              Create a challenge to mint your first iNFT agent. Each challenge
              mints a new agent that tracks its security record on-chain.
            </p>
            <Link
              to="/challenges"
              className="inline-flex items-center gap-1.5 mt-6 text-[#AF69EE] text-[14px] font-semibold hover:underline"
            >
              Browse challenges
            </Link>
          </GlassCard>
        )}

        {/* Agent grid */}
        {isConnected && !isLoading && !isError && agents.length > 0 && (
          <>
            <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[13px] mb-5">
              {agents.length} agent{agents.length !== 1 ? 's' : ''} found
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <AgentCard key={agent.tokenId} agent={agent} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
