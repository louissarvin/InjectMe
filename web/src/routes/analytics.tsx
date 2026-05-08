import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, BarChart3 } from 'lucide-react'
import { Button } from '@heroui/react'
import type { LeaderboardEntry } from '@/lib/api/hooks'
import GlassCard from '@/components/GlassCard'
import { useLeaderboard } from '@/lib/api/hooks'

export const Route = createFileRoute('/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const { data, isLoading } = useLeaderboard()
  const attackers = data?.attackers ?? []

  const totalAttacks = attackers.reduce(
    (acc: number, a: LeaderboardEntry) => acc + a.totalAttempts,
    0,
  )
  const totalBreaches = attackers.reduce(
    (acc: number, a: LeaderboardEntry) => acc + a.wins,
    0,
  )
  const avgWinRate =
    attackers.length > 0
      ? (
          attackers.reduce(
            (acc: number, a: LeaderboardEntry) => acc + parseFloat(a.winRate),
            0,
          ) / attackers.length
        ).toFixed(1)
      : '0.0'

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-12">
      <div className="max-w-[980px] mx-auto">
        <div className="mb-8">
          <h1 className="text-[28px] sm:text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1]">
            Analytics
          </h1>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px] mt-1">
            Platform statistics derived from on-chain data.
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <GlassCard className="p-5">
            <p className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px] mb-1">
              Total Attacks
            </p>
            <p className="text-[28px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB]">
              {isLoading ? '...' : totalAttacks.toLocaleString()}
            </p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px] mb-1">
              Successful Breaches
            </p>
            <p className="text-[28px] font-bold text-[#B8860B]">
              {isLoading ? '...' : totalBreaches.toLocaleString()}
            </p>
          </GlassCard>
          <GlassCard className="p-5">
            <p className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px] mb-1">
              Avg Win Rate
            </p>
            <p className="text-[28px] font-bold text-[#6366F1]">
              {isLoading ? '...' : `${avgWinRate}%`}
            </p>
          </GlassCard>
        </div>

        {/* Top attackers mini-leaderboard */}
        <GlassCard className="p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-[#AF69EE]" />
              <h2 className="text-[17px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB]">
                Top Attackers
              </h2>
            </div>
            <Link
              to="/leaderboard"
              className="text-[#AF69EE] hover:text-[#C28FF3] text-[13px] font-medium transition-colors flex items-center gap-1"
            >
              Full Leaderboard <ArrowRight size={13} />
            </Link>
          </div>

          {isLoading ? (
            <p className="text-[#9CA3AF] text-[14px]">Loading...</p>
          ) : attackers.length > 0 ? (
            <div className="flex flex-col gap-2">
              {attackers.slice(0, 10).map((a: LeaderboardEntry, i: number) => (
                <div
                  key={a.address}
                  className="flex items-center gap-3 px-3 py-2 rounded-xl bg-[#F9FAFB] dark:bg-[#141518]"
                >
                  <span className="text-[#9CA3AF] text-[12px] font-bold w-6 text-center">
                    {i + 1}
                  </span>
                  <span className="font-mono text-[13px] text-[#0A0B0D] dark:text-[#F9FAFB] flex-1 truncate">
                    {a.address.slice(0, 6)}...{a.address.slice(-4)}
                  </span>
                  <span className="text-[#B8860B] text-[13px] font-semibold">
                    {a.wins}W
                  </span>
                  <span className="text-[#9CA3AF] text-[12px]">
                    {a.totalAttempts} attacks
                  </span>
                  <span className="text-[#6366F1] text-[12px] font-medium">
                    {a.winRate}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[#9CA3AF] text-[14px]">No data yet.</p>
          )}
        </GlassCard>

        {/* Coming soon */}
        <GlassCard variant="subtle" className="text-center py-12">
          <BarChart3 size={32} className="text-[#9CA3AF] mx-auto mb-3" />
          <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-medium mb-1">
            Advanced Analytics Coming Soon
          </p>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[14px] max-w-md mx-auto mb-6">
            Detailed charts for attack trends, model performance, OWASP
            categories, and on-chain volume are under development.
          </p>
          <Link to="/challenges">
            <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-6 py-2 text-sm font-semibold">
              Browse Challenges
            </Button>
          </Link>
        </GlassCard>
      </div>
    </div>
  )
}
