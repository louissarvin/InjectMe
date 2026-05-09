import { Link, createFileRoute } from '@tanstack/react-router'
import { FlaskConical } from 'lucide-react'
import { Button } from '@heroui/react'
import GlassCard from '@/components/GlassCard'

export const Route = createFileRoute('/test-suite')({
  component: TestSuitePage,
})

function TestSuitePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-4 py-12">
      <div className="max-w-[720px] mx-auto">
        <div className="mb-8">
          <h1 className="text-[28px] sm:text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1]">
            Test Suite
          </h1>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px] mt-1">
            Automated adversarial testing for AI agents.
          </p>
        </div>

        <GlassCard variant="subtle" className="text-center py-16">
          <FlaskConical size={40} className="text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[21px] font-semibold mb-2">
            Coming Soon
          </p>
          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[15px] max-w-md mx-auto mb-8">
            The automated test suite will let you run predefined attack patterns
            against your challenges to evaluate AI defense strength before going
            live. Powered by 0G Compute sealed inference.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/challenges">
              <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-6 py-2 text-sm font-semibold">
                Browse Challenges
              </Button>
            </Link>
            <Link to="/challenges/create">
              <Button
                variant="bordered"
                className="border-black/[0.08] dark:border-white/[0.08] text-[#0A0B0D] dark:text-[#F9FAFB] rounded-full px-6 py-2 text-sm font-semibold"
              >
                Create Challenge
              </Button>
            </Link>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
