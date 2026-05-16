import { Link, createFileRoute } from '@tanstack/react-router'
import { useAccount, useDisconnect } from 'wagmi'
import {
  ExternalLink,
  LogOut,
  Percent,
  Shield,
  ShieldOff,
  Star,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react'
import { Skeleton } from '@heroui/react'
import type { Challenge } from '@/lib/api/hooks'
import GlassCard from '@/components/GlassCard'
import ChallengeCard from '@/components/ChallengeCard'
import ConnectButton from '@/components/ConnectButton'
import { useProfile, useReputation } from '@/lib/api/hooks'

export const Route = createFileRoute('/profile')({ component: ProfilePage })

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  loading,
}: {
  icon: React.ElementType
  label: string
  value: string
  color: string
  loading?: boolean
}) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} style={{ color }} />
        <span className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px]">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-24 rounded-lg bg-[#F3F4F6] dark:bg-[#141518] mt-1" />
      ) : (
        <p className="text-[28px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] leading-tight">
          {value}
        </p>
      )}
    </GlassCard>
  )
}

function DiceBearAvatar({
  address,
  size = 64,
}: {
  address: string
  size?: number
}) {
  return (
    <img
      src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(address)}`}
      alt="Avatar"
      width={size}
      height={size}
      className="rounded-full shrink-0 bg-[#F3F4F6] dark:bg-[#141518]"
    />
  )
}

function OWASPBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort(([, a], [, b]) => b - a)
  if (entries.length === 0) return null

  const max = entries[0][1]

  return (
    <div className="mt-5 pt-5 border-t border-black/[0.06] dark:border-white/[0.06]">
      <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-3">
        OWASP LLM Breakdown
      </p>
      <div className="flex flex-col gap-2.5">
        {entries.slice(0, 6).map(([category, count]) => {
          const label = category.replace(/_/g, ' ').replace(/^LLM\d+\s/, '')
          const pct = max > 0 ? (count / max) * 100 : 0
          return (
            <div key={category}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[12px] truncate max-w-[240px]">
                  {label}
                </span>
                <span className="text-[#9CA3AF] text-[12px] tabular-nums ml-3">
                  {count}
                </span>
              </div>
              <div className="h-1 rounded-full bg-[#F3F4F6] dark:bg-[#1F2937]">
                <div
                  className="h-1 rounded-full bg-[#6366F1]"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined) return '--'
  return score.toLocaleString()
}

function formatTokenAmount(raw: string | undefined): string {
  if (!raw) return '0'
  const n = parseFloat(raw)
  if (Number.isNaN(n)) return '0'
  if (n >= 1e18) return `${(n / 1e18).toFixed(4)} 0G`
  return `${n.toFixed(4)} 0G`
}

function ProfilePage() {
  const { address, isConnected } = useAccount()
  const { disconnect } = useDisconnect()

  const { data: profile, isLoading: profileLoading } = useProfile(address ?? '')
  const { data: reputation, isLoading: repLoading } = useReputation(
    address ?? '',
  )

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-20 flex items-center justify-center">
        <GlassCard className="text-center max-w-sm p-8">
          <h2 className="text-[21px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] mb-2">
            Connect to view profile
          </h2>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[15px] mb-6">
            Your stats, challenges, and history live here.
          </p>
          <ConnectButton />
        </GlassCard>
      </div>
    )
  }

  const addr = address!
  const isLoading = profileLoading || repLoading

  const attacker = profile?.attacker
  const defender = profile?.defender
  const onChain = profile?.onChainReputation ?? reputation?.onChain

  const wins = attacker?.wins ?? 0
  const totalAttempts = attacker?.totalAttempts ?? 0
  const winRate = attacker?.winRate ?? '0.0'
  const owaspBreakdown = attacker?.owaspBreakdown ?? {}

  const challengesCreated = defender?.challengesCreated ?? 0
  const defenderChallenges = defender?.challenges ?? []

  const attackerScore = onChain?.attackerScore ?? null
  const defenderScore = onChain?.defenderScore ?? null
  const onChainAttacker = onChain?.attacker ?? null
  const onChainDefender = onChain?.defender ?? null

  // Map profile's defender.challenges to the Challenge shape ChallengeCard expects
  const mappedChallenges: Array<Challenge> = defenderChallenges.map((c) => ({
    address: c.contractAddress,
    contractAddress: c.contractAddress,
    name: c.name,
    description: c.description,
    model: '',
    defender: addr,
    messagePrice: '0',
    expiresAt: new Date(Date.now() + 86400_000 * 30).toISOString(),
    challengeType: 0,
    prizePool: '0',
    totalAttempts: 0,
    active: true,
  }))

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-12">
      <div className="max-w-[980px] mx-auto">
        {/* Profile header */}
        <GlassCard className="mb-8 p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            <DiceBearAvatar address={addr} />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                <h1 className="text-[24px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] font-mono">
                  {truncateAddress(addr)}
                </h1>
              </div>
              <p className="text-[#9CA3AF] font-mono text-[12px] truncate">
                {addr}
              </p>
            </div>

            {/* Reputation scores */}
            <div className="flex gap-4 shrink-0">
              <div className="text-center">
                <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                  Attacker Score
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]" />
                ) : (
                  <p className="text-[#B8860B] text-[20px] font-bold">
                    {formatScore(attackerScore)}
                  </p>
                )}
              </div>
              <div className="text-center">
                <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                  Defender Score
                </p>
                {isLoading ? (
                  <Skeleton className="h-7 w-16 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]" />
                ) : (
                  <p className="text-[#098551] text-[20px] font-bold">
                    {formatScore(defenderScore)}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-black/[0.06] dark:border-white/[0.06] flex items-center justify-between gap-4">
            <a
              href={`https://chainscan.0g.ai/address/${addr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[#9CA3AF] hover:text-[#AF69EE] text-[13px] transition-colors"
            >
              View on 0G Explorer
              <ExternalLink size={12} />
            </a>
            <button
              type="button"
              onClick={() => disconnect()}
              className="inline-flex items-center gap-1.5 text-[#9CA3AF] hover:text-[#CF202F] text-[13px] transition-colors"
            >
              <LogOut size={12} />
              Disconnect
            </button>
          </div>
        </GlassCard>

        {/* Attacker stats */}
        <div className="mb-8">
          <h2 className="text-[18px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-4">
            Attacker Stats
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              icon={Trophy}
              label="Wins"
              value={wins.toString()}
              color="#B8860B"
              loading={isLoading}
            />
            <StatCard
              icon={Swords}
              label="Attacks"
              value={totalAttempts.toLocaleString()}
              color="#AF69EE"
              loading={isLoading}
            />
            <StatCard
              icon={Percent}
              label="Win Rate"
              value={`${winRate}%`}
              color="#6366F1"
              loading={isLoading}
            />
          </div>

          {/* On-chain attacker breakdown */}
          {onChainAttacker && (
            <GlassCard className="mt-4 p-6">
              <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-4">
                On-chain Attacker Record
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Challenges Joined
                  </p>
                  <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[20px] font-bold">
                    {onChainAttacker.challengesParticipated}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Breaches
                  </p>
                  <p className="text-[#B8860B] text-[20px] font-bold">
                    {onChainAttacker.successfulBreaches}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Total Earnings
                  </p>
                  <p className="text-[#098551] text-[20px] font-bold">
                    {formatTokenAmount(onChainAttacker.totalEarnings)}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Rep Score
                  </p>
                  <p className="text-[#6366F1] text-[20px] font-bold">
                    {onChainAttacker.score}
                  </p>
                </div>
              </div>
            </GlassCard>
          )}

          {/* OWASP chart */}
          {Object.keys(owaspBreakdown).length > 0 && (
            <GlassCard className="mt-4 p-6">
              <OWASPBreakdown breakdown={owaspBreakdown} />
            </GlassCard>
          )}
        </div>

        {/* Defender stats */}
        <div className="mb-8">
          <h2 className="text-[18px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-4">
            Defender Stats
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard
              icon={Shield}
              label="Created"
              value={challengesCreated.toString()}
              color="#098551"
              loading={isLoading}
            />
            <StatCard
              icon={Star}
              label="Survived"
              value={
                onChainDefender
                  ? onChainDefender.challengesSurvived.toString()
                  : '--'
              }
              color="#AF69EE"
              loading={isLoading}
            />
            <StatCard
              icon={ShieldOff}
              label="Breached"
              value={
                onChainDefender
                  ? onChainDefender.challengesBreached.toString()
                  : '--'
              }
              color="#CF202F"
              loading={isLoading}
            />
          </div>

          {onChainDefender && (
            <GlassCard className="mt-4 p-6">
              <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-4">
                On-chain Defender Record
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Prize Defended
                  </p>
                  <p className="text-[#098551] text-[20px] font-bold">
                    {formatTokenAmount(onChainDefender.totalPrizeDefended)}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Prize Lost
                  </p>
                  <p className="text-[#CF202F] text-[20px] font-bold">
                    {formatTokenAmount(onChainDefender.totalPrizeLost)}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Rep Score
                  </p>
                  <p className="text-[#6366F1] text-[20px] font-bold">
                    {onChainDefender.score}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Challenges
                  </p>
                  <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[20px] font-bold">
                    {onChainDefender.totalChallengesCreated}
                  </p>
                </div>
              </div>
            </GlassCard>
          )}
        </div>

        {/* Reputation score section */}
        {(attackerScore !== null || defenderScore !== null) && (
          <div className="mb-8">
            <h2 className="text-[18px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-4">
              Reputation Registry
            </h2>
            <GlassCard variant="accent" className="p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={14} className="text-[#AF69EE]" />
                <p className="text-[#4B5563] dark:text-[#9CA3AF] text-[13px]">
                  On-chain scores from the 0G ReputationRegistry contract.
                  Updated after each verified attack or challenge completion.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Attacker Score
                  </p>
                  <p className="text-[#B8860B] text-[28px] font-bold">
                    {formatScore(attackerScore)}
                  </p>
                </div>
                <div>
                  <p className="text-[#9CA3AF] text-[11px] uppercase tracking-[0.5px] font-semibold mb-1">
                    Defender Score
                  </p>
                  <p className="text-[#098551] text-[28px] font-bold">
                    {formatScore(defenderScore)}
                  </p>
                </div>
              </div>
            </GlassCard>
          </div>
        )}

        {/* My Challenges */}
        <div>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-[21px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em]">
              My Challenges
            </h2>
            <Link to="/challenges/create">
              <button
                type="button"
                className="text-[#AF69EE] hover:text-[#C28FF3] text-[14px] font-medium transition-colors"
              >
                + Create new
              </button>
            </Link>
          </div>

          {profileLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[0, 1, 2].map((i) => (
                <Skeleton
                  key={i}
                  className="h-[260px] rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]"
                />
              ))}
            </div>
          ) : mappedChallenges.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {mappedChallenges.map((c) => (
                <ChallengeCard key={c.address} challenge={c} />
              ))}
            </div>
          ) : (
            <GlassCard variant="subtle" className="text-center py-10">
              <p className="text-[#9CA3AF] text-[15px]">
                No challenges created yet.
              </p>
              <Link
                to="/challenges/create"
                className="inline-block mt-3 text-[#AF69EE] hover:text-[#C28FF3] text-[14px] transition-colors"
              >
                Create your first challenge
              </Link>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  )
}
