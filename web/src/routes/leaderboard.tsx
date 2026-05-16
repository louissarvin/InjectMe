import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { BarChart2, Target, Trophy } from 'lucide-react'
import { Skeleton, Tab, Tabs } from '@heroui/react'
import type { LeaderboardEntry } from '@/lib/api/hooks'
import GlassCard from '@/components/GlassCard'
import { useLeaderboard } from '@/lib/api/hooks'
import { cnm } from '@/utils/style'

export const Route = createFileRoute('/leaderboard')({
  component: LeaderboardPage,
})

type LeaderboardCategory = 'wins' | 'attempts' | 'winRate'

const TAB_CONFIG: Array<{
  key: LeaderboardCategory
  label: string
  icon: React.ElementType
  metric: string
  getValue: (e: LeaderboardEntry) => number
  format: (v: number) => string
}> = [
  {
    key: 'wins',
    label: 'Winners',
    icon: Trophy,
    metric: 'Wins',
    getValue: (e) => e.wins,
    format: (v) => v.toLocaleString(),
  },
  {
    key: 'attempts',
    label: 'Most Active',
    icon: Target,
    metric: 'Attacks',
    getValue: (e) => e.totalAttempts,
    format: (v) => v.toLocaleString(),
  },
  {
    key: 'winRate',
    label: 'Win Rate',
    icon: BarChart2,
    metric: 'Win Rate',
    getValue: (e) => parseFloat(e.winRate),
    format: (v) => `${v.toFixed(1)}%`,
  },
]

const EXPLORER_BASE = 'https://chainscan.0g.ai/address'

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1)
    return (
      <span className="text-[#B8860B] text-[15px] font-bold w-8 text-center shrink-0">
        1
      </span>
    )
  if (rank === 2)
    return (
      <span className="text-[#9CA3AF] text-[15px] font-bold w-8 text-center shrink-0">
        2
      </span>
    )
  if (rank === 3)
    return (
      <span className="text-[#CD7F32] text-[15px] font-bold w-8 text-center shrink-0">
        3
      </span>
    )
  return (
    <span className="text-[#6B7280] text-[14px] font-medium w-8 text-center shrink-0">
      {rank}
    </span>
  )
}

function LeaderboardRow({
  rank,
  entry,
  metric,
  value,
}: {
  rank: number
  entry: LeaderboardEntry
  metric: string
  value: string
}) {
  const isTop3 = rank <= 3
  // Validate address is hex before constructing URL (prevent open redirect / XSS)
  const isValidAddress = /^0x[0-9a-fA-F]{40}$/.test(entry.address)
  const explorerUrl = isValidAddress
    ? `${EXPLORER_BASE}/${entry.address}`
    : undefined

  return (
    <a
      href={explorerUrl}
      target={explorerUrl ? '_blank' : undefined}
      rel="noopener noreferrer"
      aria-label={`View ${truncateAddress(entry.address)} on explorer`}
      className={cnm(
        'flex items-center gap-4 px-5 py-4 rounded-2xl transition-colors duration-150',
        explorerUrl ? 'cursor-pointer' : 'cursor-default',
        isTop3
          ? 'bg-[#F8F3FF] dark:bg-[#160A28] border border-[#AF69EE]/10'
          : 'hover:bg-[#F9FAFB] dark:hover:bg-[#141518]',
      )}
    >
      <RankBadge rank={rank} />
      <div className="flex-1 min-w-0">
        <span className="font-mono text-[#4B5563] dark:text-[#D1D5DB] text-[15px]">
          {truncateAddress(entry.address)}
        </span>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold">
          {value}
        </p>
        <p className="text-[#9CA3AF] text-[12px]">{metric}</p>
      </div>
    </a>
  )
}

function LeaderboardPage() {
  const [tab, setTab] = useState<LeaderboardCategory>('wins')
  const { data, isLoading, isError } = useLeaderboard()

  const tabConfig = TAB_CONFIG.find((t) => t.key === tab)!

  // Sort by selected metric descending
  const sorted = data?.attackers
    ? [...data.attackers].sort(
        (a, b) => tabConfig.getValue(b) - tabConfig.getValue(a),
      )
    : []

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-12">
      <div className="max-w-[980px] mx-auto">
        <div className="mb-10">
          <h1 className="text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1] mb-2">
            Leaderboard
          </h1>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px]">
            Who's breaking the most AI?
          </p>
        </div>

        <Tabs
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as LeaderboardCategory)}
          classNames={{
            tabList:
              'bg-[#F3F4F6] dark:bg-[#141518] rounded-2xl p-1 gap-1 mb-8',
            tab: 'rounded-xl text-[14px] font-medium text-[#4B5563] dark:text-[#D1D5DB] data-[selected=true]:bg-[#AF69EE] data-[selected=true]:text-white',
            cursor: 'hidden',
          }}
          variant="light"
        >
          {TAB_CONFIG.map((t) => (
            <Tab
              key={t.key}
              title={
                <div className="flex items-center gap-1.5">
                  <t.icon size={14} />
                  <span>{t.label}</span>
                </div>
              }
            />
          ))}
        </Tabs>

        <GlassCard className="p-2">
          {isLoading ? (
            <div className="flex flex-col gap-1 p-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-5 py-4 rounded-2xl"
                >
                  <Skeleton className="h-5 w-5 rounded-full bg-[#F3F4F6] dark:bg-[#141518] shrink-0" />
                  <Skeleton
                    className="h-5 rounded-lg bg-[#F3F4F6] dark:bg-[#141518]"
                    style={{ width: `${180 + ((i * 37) % 100)}px` }}
                  />
                  <Skeleton className="h-5 w-16 rounded-lg bg-[#F3F4F6] dark:bg-[#141518] ml-auto shrink-0" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="text-center py-12">
              <p className="text-[#CF202F] text-[17px] font-medium">
                Failed to load leaderboard.
              </p>
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px]">
                No data yet.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {sorted.map((entry, i) => (
                <LeaderboardRow
                  key={entry.address}
                  rank={i + 1}
                  entry={entry}
                  metric={tabConfig.metric}
                  value={tabConfig.format(tabConfig.getValue(entry))}
                />
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  )
}
