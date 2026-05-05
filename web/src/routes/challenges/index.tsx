import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button, Pagination, Skeleton } from '@heroui/react'
import { z } from 'zod'
import type { ChallengeListParams } from '@/lib/api/hooks'
import GlassCard from '@/components/GlassCard'
import ChallengeCard from '@/components/ChallengeCard'
import { useChallenges } from '@/lib/api/hooks'

const searchSchema = z.object({
  page: z.number().optional().default(1),
  type: z
    .enum(['all', 'tournament', 'bounty', 'alignment'])
    .optional()
    .default('all'),
  difficulty: z
    .enum(['all', 'beginner', 'intermediate', 'advanced', 'expert'])
    .optional()
    .default('all'),
  showAll: z.boolean().optional().default(false),
})

export const Route = createFileRoute('/challenges/')({
  validateSearch: searchSchema,
  component: ChallengesPage,
})

const PAGE_SIZE = 12

const TYPE_OPTIONS = ['all', 'tournament', 'bounty', 'alignment'] as const
const DIFFICULTY_OPTIONS = [
  'all',
  'beginner',
  'intermediate',
  'advanced',
  'expert',
] as const

type TypeFilter = (typeof TYPE_OPTIONS)[number]
type DifficultyFilter = (typeof DIFFICULTY_OPTIONS)[number]

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'px-3 py-1 rounded-full text-[13px] font-semibold bg-[#AF69EE] text-white transition-all duration-150'
          : 'px-3 py-1 rounded-full text-[13px] font-medium bg-[#F3F4F6] dark:bg-[#141518] border border-black/[0.08] dark:border-white/[0.08] text-[#4B5563] dark:text-[#D1D5DB] hover:bg-[#E5E7EB] dark:hover:bg-[#1E2028] transition-all duration-150'
      }
    >
      {label}
    </button>
  )
}

function TogglePill({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? 'px-3 py-1 rounded-full text-[13px] font-semibold bg-[#0A0B0D] dark:bg-white text-white dark:text-[#0A0B0D] border border-transparent transition-all duration-150'
          : 'px-3 py-1 rounded-full text-[13px] font-medium bg-[#F3F4F6] dark:bg-[#141518] border border-black/[0.08] dark:border-white/[0.08] text-[#4B5563] dark:text-[#D1D5DB] hover:bg-[#E5E7EB] dark:hover:bg-[#1E2028] transition-all duration-150'
      }
    >
      {label}
    </button>
  )
}

function ChallengesPage() {
  const search = Route.useSearch()

  const [type, setType] = useState<TypeFilter>(search.type ?? 'all')
  const [difficulty, setDifficulty] = useState<DifficultyFilter>(
    search.difficulty ?? 'all',
  )
  const [showAll, setShowAll] = useState(search.showAll ?? false)
  const [page, setPage] = useState(search.page ?? 1)

  function updateFilter<T>(setter: (v: T) => void, value: T) {
    setter(value)
    setPage(1)
  }

  const params: ChallengeListParams = {
    type: type === 'all' ? undefined : type,
    difficulty: difficulty === 'all' ? undefined : difficulty,
    all: showAll ? 'true' : undefined,
    page,
    limit: PAGE_SIZE,
  }

  const { data, isLoading, isError } = useChallenges(params)

  const challenges = Array.isArray(data)
    ? data
    : (data as { challenges?: unknown })?.challenges
  const totalPages =
    !Array.isArray(data) &&
    (data as { pagination?: { totalPages?: number } })?.pagination?.totalPages
      ? (data as { pagination: { totalPages: number } }).pagination.totalPages
      : 1

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-12">
      <div className="max-w-[980px] mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="text-[28px] sm:text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1]">
              Challenges
            </h1>
            <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px] mt-1">
              Find an AI to break and claim the prize.
            </p>
          </div>
          <Link to="/challenges/create">
            <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-5 py-2 text-sm font-semibold transition-colors duration-150 shrink-0 flex items-center gap-2 h-auto">
              <Plus size={15} />
              Create
            </Button>
          </Link>
        </div>

        {/* Filters */}
        <GlassCard variant="subtle" className="p-4 mb-8">
          <div className="flex flex-col gap-4">
            {/* Type */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px] w-16 shrink-0">
                Type
              </span>
              {TYPE_OPTIONS.map((t) => (
                <FilterPill
                  key={t}
                  label={capitalize(t)}
                  active={type === t}
                  onClick={() => updateFilter(setType, t)}
                />
              ))}
            </div>

            {/* Difficulty */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px] w-16 shrink-0">
                Level
              </span>
              {DIFFICULTY_OPTIONS.map((d) => (
                <FilterPill
                  key={d}
                  label={capitalize(d)}
                  active={difficulty === d}
                  onClick={() => updateFilter(setDifficulty, d)}
                />
              ))}
            </div>

            {/* Show all toggle */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
              <span className="text-[#9CA3AF] text-[12px] font-semibold uppercase tracking-[0.5px] w-16 shrink-0">
                View
              </span>
              <TogglePill
                label="Active only"
                active={!showAll}
                onClick={() => {
                  updateFilter(setShowAll, false)
                }}
              />
              <TogglePill
                label="All challenges"
                active={showAll}
                onClick={() => {
                  updateFilter(setShowAll, true)
                }}
              />
            </div>
          </div>
        </GlassCard>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <Skeleton
                key={i}
                className="h-[280px] rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518]"
              />
            ))}
          </div>
        ) : isError ? (
          <GlassCard className="text-center py-16">
            <p className="text-[#CF202F] text-[17px] font-medium">
              Failed to load challenges.
            </p>
            <p className="text-[#4B5563] dark:text-[#D1D5DB] text-sm mt-1">
              Please try again later.
            </p>
          </GlassCard>
        ) : Array.isArray(challenges) && challenges.length > 0 ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {challenges.map((challenge) => (
                <ChallengeCard key={challenge.address} challenge={challenge} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex justify-center mt-10">
                <Pagination
                  total={totalPages}
                  page={page}
                  onChange={setPage}
                  classNames={{
                    cursor: 'bg-[#AF69EE]',
                  }}
                />
              </div>
            )}
          </>
        ) : (
          <GlassCard className="text-center py-16">
            <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[17px] font-medium">
              No challenges match your filters.
            </p>
            <p className="text-[#4B5563] dark:text-[#D1D5DB] text-sm mt-1">
              Try adjusting the filters or create a new challenge.
            </p>
            <Link to="/challenges/create">
              <Button className="mt-6 bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-6 py-2 text-sm font-semibold">
                Create Challenge
              </Button>
            </Link>
          </GlassCard>
        )}
      </div>
    </div>
  )
}
