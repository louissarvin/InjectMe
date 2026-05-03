import { Link } from '@tanstack/react-router'
import { Clock, DollarSign, MessageSquare, Trophy } from 'lucide-react'
import type { Challenge as APIChallenge } from '@/lib/api/hooks'
import { cnm } from '@/utils/style'
import StatusBadge from '@/components/StatusBadge'
import CountdownTimer from '@/components/CountdownTimer'

const CHALLENGE_TYPE_NAMES: Record<number, string> = {
  0: 'Tournament',
  1: 'Bounty',
  2: 'Alignment',
}

interface ChallengeCardProps {
  challenge: APIChallenge
  className?: string
}

function formatPrize(amount: string | undefined): string {
  const raw = parseFloat(amount || '0')
  // Values from the contract are in wei; convert to OG (18 decimals)
  const val = raw >= 1e15 ? raw / 1e18 : raw
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M OG`
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K OG`
  if (val === 0) return '0 OG'
  // Show up to 4 decimals, strip trailing zeros
  return `${parseFloat(val.toFixed(4))} OG`
}

function formatChallengeType(type: number): string {
  return CHALLENGE_TYPE_NAMES[type] ?? `Type ${type}`
}

function DefenderLabel({ address }: { address: string }) {
  const display = `${address.slice(0, 6)}...${address.slice(-4)}`
  return (
    <span className="text-[#AF69EE] text-xs truncate max-w-[120px]">
      {display}
    </span>
  )
}

export default function ChallengeCard({
  challenge,
  className,
}: ChallengeCardProps) {
  const hasType = challenge.challengeType !== undefined
  const id = challenge.address || ''

  return (
    <Link
      to="/challenges/$id"
      params={{ id }}
      className={cnm(
        'block bg-white dark:bg-[#141518] rounded-[20px] p-6 group',
        'border border-black/[0.08] dark:border-[#2D2F36]',
        'shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none',
        'transition-all duration-300 cursor-pointer',
        'hover:shadow-[0_20px_40px_rgba(0,0,0,0.08)] hover:-translate-y-2',
        '[transition-timing-function:cubic-bezier(.165,.84,.44,1)]',
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-2">
        <img
          src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(id)}`}
          alt=""
          width={36}
          height={36}
          className="rounded-full shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <h3 className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-bold leading-snug line-clamp-2">
            {challenge.name}
          </h3>
          {challenge.model && (
            <span className="text-[#9CA3AF] text-[12px]">
              {challenge.model}
            </span>
          )}
        </div>
        <StatusBadge
          status={
            challenge.active
              ? ('active' as const)
              : challenge.winner
                ? ('resolved' as const)
                : ('expired' as const)
          }
          className="shrink-0 mt-0.5"
        />
      </div>

      {/* Description */}
      {challenge.description && (
        <p className="text-[#4B5563] dark:text-[#9CA3AF] text-[13px] leading-[1.4] line-clamp-2 mb-3">
          {challenge.description}
        </p>
      )}

      {/* Challenge type + pricing badges */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {hasType && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#AF69EE]/8 text-[#AF69EE] border border-[#AF69EE]/15">
            {formatChallengeType(challenge.challengeType)}
          </span>
        )}
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] dark:bg-[#1F2937] text-[#4B5563] dark:text-[#9CA3AF] capitalize">
          {challenge.prizeType === 'erc20' ? 'ERC-20' : 'Native'}
        </span>
        {challenge.difficulty && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F3F4F6] dark:bg-[#1F2937] text-[#4B5563] dark:text-[#9CA3AF] capitalize">
            {challenge.difficulty.toLowerCase()}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-[0.5px] font-semibold">
            <Trophy size={11} />
            Prize Pool
          </div>
          <span className="text-[#AF69EE] text-[17px] font-bold">
            {formatPrize(challenge.prizePool)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-[0.5px] font-semibold">
            <DollarSign size={11} />
            Entry Fee
          </div>
          <span className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-bold">
            {formatPrize(challenge.messagePrice)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-[0.5px] font-semibold">
            <MessageSquare size={11} />
            Attempts
          </div>
          <span className="text-[#4B5563] dark:text-[#D1D5DB] text-[15px] font-semibold">
            {challenge.totalAttempts ?? 0}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[#9CA3AF] dark:text-[#6B7280] text-[11px] uppercase tracking-[0.5px] font-semibold">
            <Clock size={11} />
            Ends
          </div>
          <CountdownTimer
            endTime={Math.floor(
              new Date(challenge.expiresAt || 0).getTime() / 1000,
            )}
            className="text-[15px]"
          />
        </div>
      </div>

      {/* Defender */}
      <div className="flex items-center gap-2 pt-4 border-t border-black/[0.06] dark:border-white/[0.06]">
        <span className="text-[#9CA3AF] dark:text-[#6B7280] text-xs">
          Defender:
        </span>
        <DefenderLabel address={challenge.defender} />
      </div>
    </Link>
  )
}
