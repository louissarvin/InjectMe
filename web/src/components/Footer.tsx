import { useRef } from 'react'
import { motion, useInView } from 'motion/react'
import { Link } from '@tanstack/react-router'
import { config } from '@/config'

const ease = [0.165, 0.84, 0.44, 1] as const

export default function Footer() {
  const footerRef = useRef<HTMLDivElement>(null)
  const footerInView = useInView(footerRef, {
    once: true,
    margin: '0px 0px -40px 0px',
  })

  return (
    <footer className="relative z-0 bg-[#FDFDFF] dark:bg-[#0A0B0D] px-6 md:px-10 pt-6">
      <motion.div
        ref={footerRef}
        className="max-w-[980px] mx-auto bg-[#141518] dark:bg-[#F5F6F8] rounded-t-[28px] px-10 md:px-14 pt-12 pb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={footerInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.6, ease }}
      >
        {/* Top: Logo + Link columns */}
        <div className="flex flex-col md:flex-row gap-12 md:gap-20 mb-14">
          {/* Logo */}
          <div className="shrink-0">
            <img src="/assets/logo.svg" alt="InjectMe" className="h-[60px]" />
          </div>

          {/* Link columns */}
          <div className="flex gap-16 md:gap-24">
            {/* Resources */}
            <div className="flex flex-col gap-3">
              <p className="text-white dark:text-[#0A0B0D] text-[14px] font-semibold mb-1">
                Resources
              </p>
              <a
                href={config.links.docs || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Documentation
              </a>
              <a
                href={config.links.github || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                GitHub
              </a>
              <Link
                to="/challenges"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Challenges
              </Link>
              <Link
                to="/leaderboard"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Leaderboard
              </Link>
              <Link
                to="/analytics"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Analytics
              </Link>
              <Link
                to="/test-suite"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Test Suite
              </Link>
              <Link
                to="/attestations"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Attestations
              </Link>
              <Link
                to="/agent"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Agent
              </Link>
              <Link
                to="/profile"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Profile
              </Link>
            </div>

            {/* Community */}
            <div className="flex flex-col gap-3">
              <p className="text-white dark:text-[#0A0B0D] text-[14px] font-semibold mb-1">
                Community
              </p>
              <a
                href={config.links.twitter || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                X (Twitter)
              </a>
              <a
                href={config.links.discord || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Discord
              </a>
              <a
                href={config.links.telegram || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                Telegram
              </a>
              <a
                href="https://0g.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white/40 dark:text-[#4B5563] text-[14px] hover:text-white/80 dark:hover:text-[#0A0B0D] transition-colors duration-200"
              >
                0G Chain
              </a>
            </div>
          </div>
        </div>

        {/* Bottom: Copyright */}
        <p className="text-white/25 dark:text-[#9CA3AF] text-[13px]">
          &copy;{new Date().getFullYear()} InjectMe
        </p>
      </motion.div>
    </footer>
  )
}
