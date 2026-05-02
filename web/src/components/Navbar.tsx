import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LogOut, Menu, Moon, Sun, User, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useAccount, useDisconnect } from 'wagmi'
import ConnectButton from '@/components/ConnectButton'
import { cnm } from '@/utils/style'
import { useTheme } from '@/providers/ThemeProvider'

function NavAvatar({ address }: { address: string }) {
  return (
    <img
      src={`https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(address)}`}
      alt="Avatar"
      width={28}
      height={28}
      className="rounded-full shrink-0 bg-[#F3F4F6] dark:bg-[#141518]"
    />
  )
}

function ProfileChip({
  address,
  scrolled,
}: {
  address: string
  scrolled: boolean
}) {
  const navigate = useNavigate()
  const { disconnect } = useDisconnect()
  const displayName = `${address.slice(0, 6)}…${address.slice(-4)}`
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) {
      document.addEventListener('mousedown', onClickOutside)
    }
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cnm(
          'flex items-center gap-2 rounded-full border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/[0.08] transition-all duration-150',
          scrolled ? 'px-2 py-0.5' : 'px-2.5 py-1',
        )}
      >
        <NavAvatar address={address} />
        <span
          className={cnm(
            'font-medium text-[#0A0B0D] dark:text-[#F9FAFB] font-mono truncate max-w-[100px]',
            scrolled ? 'text-[11px]' : 'text-[12px]',
          )}
        >
          {displayName}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.165, 0.84, 0.44, 1] }}
            className="absolute top-full right-0 mt-2 min-w-[148px] bg-white/95 dark:bg-[#141518]/95 backdrop-blur-[20px] rounded-xl border border-black/[0.08] dark:border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden"
          >
            <div className="flex flex-col p-1.5 gap-0.5">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate({ to: '/profile' })
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all duration-150 whitespace-nowrap"
              >
                <User size={13} />
                Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  disconnect()
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium text-[#CF202F] hover:text-[#CF202F] hover:bg-[#CF202F]/[0.08] transition-all duration-150 whitespace-nowrap"
              >
                <LogOut size={13} />
                Disconnect
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MobileProfileSection({
  address,
  onClose,
}: {
  address: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { disconnect } = useDisconnect()
  const displayName = `${address.slice(0, 6)}…${address.slice(-4)}`

  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => {
          onClose()
          navigate({ to: '/profile' })
        }}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[15px] font-medium text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-all duration-150"
      >
        <NavAvatar address={address} />
        <span className="font-mono text-[13px] truncate">{displayName}</span>
      </button>
      <button
        type="button"
        onClick={() => {
          onClose()
          disconnect()
        }}
        className="flex items-center gap-3 px-4 py-2.5 rounded-xl text-[15px] font-medium text-[#CF202F] hover:bg-[#CF202F]/[0.08] transition-all duration-150"
      >
        <LogOut size={16} />
        Disconnect
      </button>
    </div>
  )
}

const NAV_LINKS = [
  { label: 'Challenges', to: '/challenges' },
  { label: 'Leaderboard', to: '/leaderboard' },
  { label: 'Agent', to: '/agent' },
] as const

const MORE_LINKS = [
  { label: 'Analytics', to: '/analytics' },
  { label: 'Test Suite', to: '/test-suite' },
  { label: 'Attestations', to: '/attestations' },
] as const

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname
  const { theme, toggleTheme } = useTheme()
  const { address, isConnected } = useAccount()

  const isMoreActive = MORE_LINKS.some(
    (link) => currentPath === link.to || currentPath.startsWith(link.to + '/'),
  )

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    if (moreOpen) {
      document.addEventListener('mousedown', onClickOutside)
    }
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [moreOpen])

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-3 pointer-events-none">
        <nav
          className={cnm(
            'pointer-events-auto flex items-center gap-1 px-2 rounded-full transition-all duration-300',
            scrolled ? 'h-10' : 'h-12',
            scrolled
              ? 'bg-white/90 dark:bg-[#141518]/90 backdrop-blur-[20px] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_2px_16px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_16px_rgba(0,0,0,0.4)]'
              : 'bg-white/60 dark:bg-[#141518]/60 backdrop-blur-[12px] border border-black/[0.06] dark:border-white/[0.06] shadow-[0_1px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_8px_rgba(0,0,0,0.2)]',
          )}
        >
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center px-3 transition-opacity duration-150 hover:opacity-80"
          >
            <img
              src="/assets/logo.svg"
              alt="InjectMe"
              className={cnm(
                'transition-all duration-300',
                scrolled ? 'h-[56px]' : 'h-[60px]',
              )}
            />
          </Link>

          {/* Divider */}
          <div
            className={cnm(
              'hidden md:block w-px bg-black/[0.08] dark:bg-white/[0.08] transition-all duration-300',
              scrolled ? 'h-4' : 'h-5',
            )}
          />

          {/* Nav links - desktop */}
          <div className="hidden md:flex items-center gap-0.5">
            {NAV_LINKS.map((link) => {
              const isActive =
                currentPath === link.to || currentPath.startsWith(link.to + '/')
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cnm(
                    'group relative font-medium rounded-full transition-all duration-300',
                    scrolled
                      ? 'px-2.5 py-1 text-[12px]'
                      : 'px-3 py-1.5 text-[13px]',
                    isActive
                      ? 'text-[#AF69EE] bg-[#AF69EE]/[0.08]'
                      : 'text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#AF69EE] dark:hover:text-[#AF69EE] hover:bg-[#AF69EE]/[0.08]',
                  )}
                >
                  {link.label}
                </Link>
              )
            })}

            {/* More dropdown */}
            <div ref={moreRef} className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                className={cnm(
                  'flex items-center gap-1 font-medium rounded-full transition-all duration-300',
                  scrolled
                    ? 'px-2.5 py-1 text-[12px]'
                    : 'px-3 py-1.5 text-[13px]',
                  isMoreActive || moreOpen
                    ? 'text-[#AF69EE] bg-[#AF69EE]/[0.08]'
                    : 'text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#AF69EE] dark:hover:text-[#AF69EE] hover:bg-[#AF69EE]/[0.08]',
                )}
              >
                More
                <ChevronDown
                  size={12}
                  className={cnm(
                    'transition-transform duration-200',
                    moreOpen && 'rotate-180',
                  )}
                />
              </button>
              <AnimatePresence>
                {moreOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    transition={{
                      duration: 0.15,
                      ease: [0.165, 0.84, 0.44, 1],
                    }}
                    className="absolute top-full left-1/2 -translate-x-1/2 mt-2 min-w-[148px] bg-white/95 dark:bg-[#141518]/95 backdrop-blur-[20px] rounded-xl border border-black/[0.08] dark:border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)] overflow-hidden"
                  >
                    <div className="flex flex-col p-1.5 gap-0.5">
                      {MORE_LINKS.map((link) => {
                        const isActive =
                          currentPath === link.to ||
                          currentPath.startsWith(link.to + '/')
                        return (
                          <Link
                            key={link.to}
                            to={link.to}
                            onClick={() => setMoreOpen(false)}
                            className={cnm(
                              'px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 whitespace-nowrap',
                              isActive
                                ? 'text-[#AF69EE] bg-[#AF69EE]/[0.08]'
                                : 'text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                            )}
                          >
                            {link.label}
                          </Link>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Divider */}
          <div
            className={cnm(
              'hidden md:block w-px bg-black/[0.08] dark:bg-white/[0.08] transition-all duration-300',
              scrolled ? 'h-4' : 'h-5',
            )}
          />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="hidden md:flex p-2 rounded-full text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors duration-150"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Connect / profile */}
          <div
            className={cnm(
              'hidden md:block transition-all duration-300 hover:-translate-y-px origin-center',
              scrolled ? 'scale-[0.88]' : 'scale-100',
            )}
          >
            {isConnected && address ? (
              <ProfileChip address={address} scrolled={scrolled} />
            ) : (
              <ConnectButton />
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1.5 rounded-full text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </nav>
      </header>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.165, 0.84, 0.44, 1] }}
            className="fixed top-[68px] left-4 right-4 z-40 md:hidden bg-white/95 dark:bg-[#141518]/95 backdrop-blur-[20px] rounded-2xl border border-black/[0.08] dark:border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden"
          >
            <nav className="flex flex-col p-3 gap-0.5">
              {NAV_LINKS.map((link) => {
                const isActive =
                  currentPath === link.to ||
                  currentPath.startsWith(link.to + '/')
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileOpen(false)}
                    className={cnm(
                      'px-4 py-2.5 rounded-xl text-[15px] font-medium transition-all duration-150',
                      isActive
                        ? 'text-[#AF69EE] bg-[#AF69EE]/[0.08]'
                        : 'text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                    )}
                  >
                    {link.label}
                  </Link>
                )
              })}
              <div className="my-1 mx-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
              {MORE_LINKS.map((link) => {
                const isActive =
                  currentPath === link.to ||
                  currentPath.startsWith(link.to + '/')
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    onClick={() => setMobileOpen(false)}
                    className={cnm(
                      'px-4 py-2.5 rounded-xl text-[15px] font-medium transition-all duration-150',
                      isActive
                        ? 'text-[#AF69EE] bg-[#AF69EE]/[0.08]'
                        : 'text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0A0B0D] dark:hover:text-[#F9FAFB] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]',
                    )}
                  >
                    {link.label}
                  </Link>
                )
              })}
              <div className="my-1 mx-1 h-px bg-black/[0.06] dark:bg-white/[0.06]" />
              {isConnected && address ? (
                <MobileProfileSection
                  address={address}
                  onClose={() => setMobileOpen(false)}
                />
              ) : (
                <div className="mt-2 px-4 pb-1">
                  <ConnectButton />
                </div>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
