import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowRight,
  Bot,
  ChevronDown,
  DollarSign,
  FileCheck,
  Globe,
  Shield,
  Trophy,
  Wallet,
  Zap,
} from 'lucide-react'
import { Button, Skeleton } from '@heroui/react'
import { motion, useInView, useScroll, useTransform } from 'motion/react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import type { Challenge, PaginatedChallenges } from '@/lib/api/hooks'
import GlassCard from '@/components/GlassCard'
import ChallengeCard from '@/components/ChallengeCard'
import ScrollRevealText from '@/components/elements/ScrollRevealText'
import { useChallenges } from '@/lib/api/hooks'

gsap.registerPlugin(ScrollTrigger)

export const Route = createFileRoute('/')({ component: HomePage })

// ─── Constants ────────────────────────────────────────────────────────────────

const DECELERATE = [0.165, 0.84, 0.44, 1] as const

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: Shield,
    title: 'Create a Challenge',
    description:
      'Deploy an AI agent with a secret system prompt. Set your prize pool, duration, and pricing model.',
  },
  {
    step: '02',
    icon: Zap,
    title: 'Attackers Strike',
    description:
      'Anyone can send messages to your AI. Each attempt costs a fee that grows the prize pool.',
  },
  {
    step: '03',
    icon: Trophy,
    title: 'Win or Defend',
    description:
      'If the AI is broken, the attacker claims the prize. If no one breaks it, the defender keeps everything.',
  },
]

const ZG_FEATURES = [
  {
    icon: Shield,
    label: 'Sealed Inference (TEE)',
    description: 'Tamper-proof AI evaluation in hardware enclaves',
    details:
      '0G Compute runs AI inference inside Trusted Execution Environments. Every attack evaluation is cryptographically attested, ensuring no one can tamper with judgments or leak system prompts.',
  },
  {
    icon: FileCheck,
    label: '0G Storage DA',
    description: 'Permanent, verifiable data availability',
    details:
      'Every attack attempt, AI response, and judgment is archived to 0G Storage with Merkle proofs. Data is encrypted with ECIES and permanently retrievable, providing full auditability.',
  },
  {
    icon: Bot,
    label: 'iNFT Agents (ERC-7857)',
    description: 'AI agents as transferable NFTs with encrypted weights',
    details:
      'Each challenge spawns an iNFT that tracks security metrics. Agents can be transferred or cloned with encrypted model data, enabling a marketplace for battle-tested AI defenders.',
  },
  {
    icon: Globe,
    label: 'Oracle Consensus',
    description: 'Decentralized judgment with staking',
    details:
      'Oracles stake 0G tokens and submit judgments on attack outcomes. Multi-confirmation consensus prevents single-point manipulation. Slashing penalizes dishonest oracles.',
  },
  {
    icon: Zap,
    label: 'Commit-Reveal Attacks',
    description: 'Front-running protection for attackers',
    details:
      'Attackers commit a hash of their message before revealing. This prevents MEV bots from front-running successful attack payloads and stealing prizes.',
  },
  {
    icon: Trophy,
    label: 'On-chain Reputation',
    description: 'Attacker and defender scores on ReputationRegistry',
    details:
      'Every win, loss, and participation is tracked on-chain via ReputationRegistry. Attacker scores reflect breach success; defender scores reflect challenge survival rates.',
  },
  {
    icon: DollarSign,
    label: 'Native 0G Economy',
    description: 'All prizes and fees in native 0G tokens',
    details:
      'The entire economy runs on native 0G tokens. Prize pools, message fees, and oracle stakes are all denominated in 0G for a unified ecosystem.',
  },
  {
    icon: Wallet,
    label: '0G Chain',
    description: 'Purpose-built for decentralized AI',
    details:
      'Built on 0G Galileo testnet, a modular AI chain with native support for compute, storage, and data availability. Sub-second finality with low transaction costs.',
  },
]

// ─── Animation Variants ────────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: DECELERATE },
  },
}

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useMouseParallax(strength: number = 20) {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const target = useRef({ x: 0, y: 0 })
  const current = useRef({ x: 0, y: 0 })
  const raf = useRef<number>(0)

  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (e.pointerType !== 'mouse') return
      const cx = window.innerWidth / 2
      const cy = window.innerHeight / 2
      target.current = {
        x: ((e.clientX - cx) / cx) * strength,
        y: ((e.clientY - cy) / cy) * strength,
      }
    }

    function tick() {
      current.current.x += (target.current.x - current.current.x) * 0.08
      current.current.y += (target.current.y - current.current.y) * 0.08
      setOffset({ x: current.current.x, y: current.current.y })
      raf.current = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onPointer, { passive: true })
    raf.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('pointermove', onPointer)
      cancelAnimationFrame(raf.current)
    }
  }, [strength])

  return offset
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrize(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M 0G`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K 0G`
  if (n >= 1) return `${n.toFixed(1)} 0G`
  return `${n.toFixed(4)} 0G`
}

function SplitTextEntrance({
  text,
  className,
  delay = 0,
}: {
  text: string
  className?: string
  delay?: number
}) {
  return (
    <span className={className} aria-label={text}>
      {text.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.5,
            ease: DECELERATE,
            delay: delay + i * 0.035,
          }}
          className="inline-block"
          style={char === ' ' ? { width: '0.3em' } : undefined}
        >
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  )
}

function Sparkle({
  className,
  size = 16,
  style,
}: {
  className?: string
  size?: number
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      style={style}
    >
      <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
    </svg>
  )
}

function CountUpNumber({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once: true })
  const [display, setDisplay] = useState('0')

  useEffect(() => {
    if (!isInView) return

    // Parse: strip $, commas; detect suffix K/M and prefix $
    const prefix = value.startsWith('$') ? '$' : ''
    const stripped = value.replace(/[$,]/g, '')
    const suffixMatch = stripped.match(/[KM]$/)
    const suffix = suffixMatch ? suffixMatch[0] : ''
    const numeric = parseFloat(stripped.replace(/[KM]$/, ''))

    if (isNaN(numeric)) {
      setDisplay(value)
      return
    }

    const duration = 1200
    const start = performance.now()

    function easeOut(t: number) {
      return 1 - Math.pow(1 - t, 3)
    }

    function tick(now: number) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      const current = numeric * easeOut(progress)

      let formatted: string
      if (suffix) {
        formatted = `${prefix}${current.toFixed(1)}${suffix}`
      } else if (numeric >= 1000) {
        formatted = `${prefix}${Math.round(current).toLocaleString()}`
      } else {
        formatted = `${prefix}${Math.round(current)}`
      }

      setDisplay(formatted)

      if (progress < 1) {
        requestAnimationFrame(tick)
      } else {
        setDisplay(value)
      }
    }

    requestAnimationFrame(tick)
  }, [isInView, value])

  return <span ref={ref}>{display}</span>
}

// ─── Components ───────────────────────────────────────────────────────────────

function ClipReveal({
  children,
  delay = 0,
}: {
  children: React.ReactNode
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-60px 0px' })

  return (
    <div
      ref={ref}
      style={{
        clipPath: isInView ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
        transition: `clip-path 1s cubic-bezier(0.165, 0.84, 0.44, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

function FadeInWhenVisible({
  children,
  delay = 0,
}: {
  children: React.ReactNode
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: true, margin: '-80px 0px' })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
      transition={{ duration: 0.5, ease: DECELERATE, delay: delay / 1000 }}
    >
      {children}
    </motion.div>
  )
}

function StatsSection({
  challenges,
}: {
  challenges: Array<Challenge> | undefined
}) {
  if (!challenges) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:gap-5">
        {[0, 1, 2].map((i) => (
          <GlassCard key={i} className="text-center">
            <Skeleton className="h-8 w-24 mx-auto mb-2 rounded-lg bg-[#F3F4F6] dark:bg-[#141518] skeleton-shimmer" />
            <Skeleton className="h-4 w-20 mx-auto rounded-lg bg-[#F3F4F6] dark:bg-[#141518] skeleton-shimmer" />
          </GlassCard>
        ))}
      </div>
    )
  }

  const totalPrize = challenges.reduce(
    (acc, c) => acc + parseFloat(c.prizePool),
    0,
  )
  const totalMessages = challenges.reduce(
    (acc, c) => acc + (c.totalAttempts ?? 0),
    0,
  )

  const stats = [
    { label: 'Challenges', value: challenges.length.toString() },
    { label: 'Prize Pool', value: formatPrize(totalPrize) },
    {
      label: 'Attacks',
      value: totalMessages.toLocaleString(),
    },
  ]

  return (
    <motion.div
      className="grid grid-cols-3 gap-3 sm:gap-5"
      variants={stagger}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px 0px' }}
    >
      {stats.map(({ label, value }) => (
        <motion.div key={label} variants={fadeUp}>
          <GlassCard hover className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <span className="text-[#9CA3AF] text-[11px] sm:text-[12px] uppercase tracking-[0.5px] font-semibold">
                {label}
              </span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <p className="text-[24px] sm:text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] leading-tight tracking-[-0.5px]">
                <CountUpNumber value={value} />
              </p>
            </div>
          </GlassCard>
        </motion.div>
      ))}
    </motion.div>
  )
}

function HowItWorksParallax() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const cardsRef = useRef<Array<HTMLDivElement>>([])

  useEffect(() => {
    if (!sectionRef.current) return

    const cards = cardsRef.current.filter(Boolean)
    const totalScroll = window.innerHeight * 3

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top top',
        end: `+=${totalScroll}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
      },
    })

    cards.forEach((card, i) => {
      const s = i * 4
      tl.fromTo(
        card,
        { y: 200, opacity: 0, scale: 0.8, rotationX: -15 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          rotationX: 0,
          ease: 'back.out(1.2)',
          duration: 2,
        },
        s,
      )
      tl.to(card, { duration: 1 }, s + 2)
      if (i < cards.length - 1) {
        tl.to(
          card,
          { scale: 0.95, opacity: 0.6, rotationX: 10, duration: 1 },
          s + 3,
        )
      }
    })

    const finalTime = (cards.length - 1) * 4 + 3
    const fanOffset = window.innerWidth < 480 ? 70 : 110
    cards.forEach((card, i) => {
      const centerOffset = i - Math.floor(cards.length / 2)
      tl.to(
        card,
        {
          x: centerOffset * fanOffset,
          y: 0,
          scale: 0.85,
          opacity: 1,
          rotation: centerOffset * 3,
          ease: 'power3.inOut',
          duration: 2,
        },
        finalTime,
      )
    })

    return () => {
      ScrollTrigger.getAll().forEach((st) => st.kill())
    }
  }, [])

  return (
    <div
      ref={sectionRef}
      className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden bg-[#FDFDFF] dark:bg-[#0A0B0D]"
    >
      <div className="text-center mb-16">
        <span className="section-label">How It Works</span>
        <h2
          className="text-[32px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-2"
          style={{ fontFamily: "'Syne Variable', sans-serif" }}
        >
          How it works
        </h2>
        <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px]">
          Three steps from zero to prize pool.
        </p>
      </div>

      <div
        className="relative w-full max-w-[320px] sm:max-w-[420px] h-[320px]"
        style={{ perspective: '1000px' }}
      >
        {HOW_IT_WORKS.map((step, i) => (
          <div
            key={step.step}
            ref={(el) => {
              if (el) cardsRef.current[i] = el
            }}
            className="absolute inset-0 bg-[#FDFDFF] dark:bg-[#141518] border border-black/[0.08] dark:border-white/[0.08] rounded-[24px] p-8 shadow-[0_8px_32px_rgba(0,0,0,0.08)]"
            style={{
              opacity: 0,
              transformStyle: 'preserve-3d',
              backfaceVisibility: 'hidden',
            }}
          >
            <div className="flex items-center gap-3 mb-6">
              <span className="text-[#AF69EE] text-[13px] font-bold tracking-[1px] uppercase">
                Step {step.step}
              </span>
            </div>
            <h3
              className="text-[24px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-3"
              style={{ fontFamily: "'Syne Variable', sans-serif" }}
            >
              {step.title}
            </h3>
            <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[16px] leading-[1.6]">
              {step.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ClipExpandReveal() {
  const ref = useRef<HTMLDivElement>(null)
  const isInView = useInView(ref, { once: false, margin: '-20% 0px' })

  return (
    <section
      ref={ref}
      className="py-20 px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D] overflow-hidden"
    >
      <div className="max-w-[980px] mx-auto relative h-[400px] flex items-center justify-center">
        <div
          className="absolute inset-0 rounded-[24px] bg-gradient-to-br from-[#AF69EE]/5 via-[#FDFDFF] dark:via-[#1E2028] to-[#C28FF3]/5 border border-[#AF69EE]/10 dark:border-white/10 flex items-center justify-center transition-all duration-[1.2s]"
          style={{
            clipPath: isInView
              ? 'inset(0% 0% round 24px)'
              : 'inset(35% 40% round 24px)',
            opacity: isInView ? 1 : 0,
            transitionTimingFunction: 'cubic-bezier(0.165, 0.84, 0.44, 1)',
          }}
        >
          <div className="text-center">
            <h3
              className="text-[24px] md:text-[32px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-2"
              style={{ fontFamily: "'Syne Variable', sans-serif" }}
            >
              Adversarial AI Testing
            </h3>
            <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[15px] max-w-[400px] mx-auto">
              The first platform where breaking AI is rewarded. Every
              vulnerability found makes the next generation stronger.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function HomePage() {
  const { data: challengesData, isLoading } = useChallenges({
    limit: 3,
  })
  const challenges = Array.isArray(challengesData)
    ? challengesData
    : challengesData?.challenges

  const mouseOffset = useMouseParallax(15)

  // Parallax for hero glow
  const heroRef = useRef<HTMLDivElement>(null)
  const { scrollY } = useScroll()
  const glowY = useTransform(scrollY, [0, 500], [0, -80])
  const glowOpacity = useTransform(scrollY, [0, 400], [1, 0])
  const scrollHintOpacity = useTransform(scrollY, [0, 200], [1, 0])

  return (
    <div className="bg-[#FDFDFF] dark:bg-[#0A0B0D] min-h-screen">
      {/* ── Hero + Stats (100vh) ─────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative overflow-hidden h-[calc(100vh-64px)] flex flex-col px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D]"
      >
        {/* Parallax glow */}
        <motion.div
          className="absolute top-[-80px] left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full pointer-events-none"
          style={{
            y: glowY,
            opacity: glowOpacity,
            background:
              'radial-gradient(ellipse at center, rgba(175,105,238,0.15) 0%, rgba(175,105,238,0.06) 40%, transparent 70%)',
            filter: 'blur(60px)',
          }}
        />

        {/* Grid lines */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgba(175,105,238,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(175,105,238,0.06) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage:
              'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 100%)',
          }}
        />

        {/* Hero content — centered */}
        <div className="relative z-10 max-w-[980px] mx-auto text-center flex-1 flex flex-col justify-center">
          {/* Animated hero circle — anchored to content */}
          <div
            className="absolute left-1/2 w-[520px] h-[520px] pointer-events-none z-0"
            style={{
              top: '55%',
              transform: `translate(calc(-50% + ${mouseOffset.x}px), calc(-50% + ${mouseOffset.y}px))`,
            }}
          >
            <div
              className="w-full h-full rounded-full animate-spin-slow"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0%, rgba(175,105,238,0.18) 15%, transparent 30%, rgba(175,105,238,0.12) 50%, transparent 65%, rgba(175,105,238,0.08) 80%, transparent 100%)',
              }}
            />
            <div
              className="absolute inset-[60px] rounded-full"
              style={{
                animation:
                  'spin-slow 18s linear infinite reverse, dissolve 4s ease-in-out infinite',
                background:
                  'conic-gradient(from 180deg, transparent 0%, rgba(175,105,238,0.10) 20%, transparent 40%, rgba(175,105,238,0.06) 60%, transparent 100%)',
              }}
            />
          </div>

          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: DECELERATE }}
            className="inline-flex items-center gap-2 bg-[#AF69EE]/10 border border-[#AF69EE]/20 rounded-full px-4 py-1.5 mb-6 self-center animate-accent-pulse"
          >
            <span className="text-[#AF69EE] text-[13px] font-semibold tracking-[0.1px]">
              Built on 0G Chain
            </span>
          </motion.div>

          {/* Headline */}
          <h1
            className="text-[48px] md:text-[72px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] leading-[1.05] tracking-[-0.02em] mb-5"
            style={{ fontFamily: "'Syne Variable', sans-serif" }}
          >
            <SplitTextEntrance text="Break the AI." delay={0.08} />
            <br />
            <SplitTextEntrance
              text="Win the Prize."
              className="bg-gradient-to-r from-[#AF69EE] to-[#C28FF3] bg-clip-text text-transparent"
              delay={0.55}
            />
          </h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: DECELERATE, delay: 0.16 }}
            className="max-w-[480px] mx-auto mb-8 text-[17px] text-[#4B5563] dark:text-[#D1D5DB] leading-[1.5] tracking-[-0.374px]"
          >
            Challenge AI agents protecting{' '}
            <em className="not-italic text-[#AF69EE] font-medium">
              secret system prompts
            </em>
            . Pay to attack. Break the instructions, claim the prize pool.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: DECELERATE, delay: 0.24 }}
            className="relative flex items-center justify-center gap-3 flex-wrap"
          >
            <Link to="/challenges">
              <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] active:bg-[#9554D4] active:scale-[0.98] text-white rounded-full px-7 py-2.5 text-[15px] font-semibold transition-all duration-150 h-auto shadow-[0_4px_16px_rgba(175,105,238,0.3)] hover:shadow-[0_8px_24px_rgba(175,105,238,0.4)] hover:-translate-y-px">
                Browse Challenges
                <ArrowRight size={15} />
              </Button>
            </Link>
            <Link to="/challenges/create">
              <Button
                className="bg-white dark:bg-[#141518] border border-black/[0.08] dark:border-white/[0.08] text-[#0A0B0D] dark:text-[#F9FAFB] rounded-full px-7 py-2.5 text-[15px] font-semibold hover:bg-[#F3F4F6] dark:hover:bg-[#1E2028] transition-all duration-150 h-auto hover:-translate-y-px"
                variant="bordered"
              >
                Create Challenge
              </Button>
            </Link>
            <Sparkle
              size={14}
              className="text-[#AF69EE]/30 absolute -top-3 -right-3 animate-pulse-dot"
              style={{
                transform: `translate(${mouseOffset.x * -0.5}px, ${mouseOffset.y * -0.5}px)`,
              }}
            />
            <Sparkle
              size={10}
              className="text-[#AF69EE]/20 absolute -bottom-2 -left-4 animate-pulse-dot"
              style={{
                animationDelay: '1s',
                transform: `translate(${mouseOffset.x * 0.7}px, ${mouseOffset.y * 0.7}px)`,
              }}
            />
          </motion.div>
        </div>

        {/* Scroll hint */}
        <motion.div
          className="relative z-10 flex flex-col items-center gap-1 mb-4 mt-auto"
          style={{ opacity: scrollHintOpacity }}
        >
          <span className="text-[#9CA3AF] text-[12px] uppercase tracking-[0.1em] font-semibold">
            Scroll
          </span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
          >
            <ChevronDown size={16} className="text-[#9CA3AF]" />
          </motion.div>
        </motion.div>

        {/* Stats pinned to bottom */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: DECELERATE, delay: 0.32 }}
          className="relative z-10 max-w-[980px] mx-auto w-full pb-8"
        >
          <StatsSection challenges={challenges} />
        </motion.div>
      </section>

      {/* ── Scroll Reveal Statement (tmrw.finance pattern) ───────────── */}
      <section className="py-24 px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D]">
        <div className="max-w-[680px] mx-auto text-center">
          <ScrollRevealText
            text="The best AI defense is a good offense. We built a platform where anyone can stress-test AI agents and earn rewards for finding vulnerabilities. Every attack makes AI stronger."
            className="text-[28px] md:text-[36px] font-semibold leading-[1.3] tracking-[-0.02em]"
          />
        </div>
      </section>

      {/* ── Marquee Ticker ──────────────────────────────────────────────── */}
      <div className="bg-[#0A0B0D] py-4 overflow-hidden select-none">
        <div className="animate-marquee flex items-center gap-8 whitespace-nowrap w-max">
          {[...Array(2)].map((_, dupeIdx) => (
            <div key={dupeIdx} className="flex items-center gap-8">
              {[
                'Break the AI',
                'Win the Prize',
                'Earn Rewards',
                'Test AI Security',
                'Claim the Pool',
                'Defend or Attack',
              ].map((text, i) => (
                <span key={i} className="flex items-center gap-8">
                  <span
                    className="text-white text-[28px] md:text-[40px] font-bold tracking-[-0.02em]"
                    style={{ fontFamily: "'Syne Variable', sans-serif" }}
                  >
                    {text}
                  </span>
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="rgba(175,105,238,0.8)"
                    className="shrink-0"
                  >
                    <path d="M12 0L14.59 9.41L24 12L14.59 14.59L12 24L9.41 14.59L0 12L9.41 9.41L12 0Z" />
                  </svg>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* ── Sparse Highlight Statement ──────────────────────────────── */}
      <section className="py-20 px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D]">
        <div className="max-w-[720px] mx-auto text-center">
          <p className="text-[24px] md:text-[32px] leading-[1.4] tracking-[-0.02em] text-[#0A0B0D]/30 dark:text-[#F9FAFB]/30">
            Built for{' '}
            <span className="text-[#0A0B0D] dark:text-[#F9FAFB]">
              security researchers
            </span>
            ,{' '}
            <span className="text-[#0A0B0D] dark:text-[#F9FAFB]">
              AI engineers
            </span>
            , and{' '}
            <span className="text-[#0A0B0D] dark:text-[#F9FAFB]">
              crypto degens
            </span>{' '}
            who believe the best way to make AI safer is to{' '}
            <span className="text-[#AF69EE]">break it first</span>.
          </p>
        </div>
      </section>

      {/* ── Clip Expand Reveal ──────────────────────────────────────── */}
      <ClipExpandReveal />

      {/* ── How it works — GSAP Parallax ──────────────────────────────── */}
      <HowItWorksParallax />

      {/* ── Active Challenges ──────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D]">
        <div className="max-w-[980px] mx-auto">
          <FadeInWhenVisible>
            <div className="flex items-center justify-between mb-8">
              <div>
                <span className="section-label">Challenges</span>
                <ClipReveal>
                  <h2
                    className="text-[28px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-1"
                    style={{ fontFamily: "'Syne Variable', sans-serif" }}
                  >
                    Active Challenges
                  </h2>
                </ClipReveal>
                <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[15px]">
                  Open bounties waiting to be broken.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/challenges"
                  className="text-[#AF69EE] hover:text-[#C28FF3] text-[14px] font-medium transition-colors flex items-center gap-1 link-underline"
                >
                  View all <ArrowRight size={14} />
                </Link>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium text-[#098551] bg-[#098551]/10 border border-[#098551]/20 transition-all duration-300 hover:px-4">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#098551] animate-pulse-dot" />
                  Live
                </span>
              </div>
            </div>
          </FadeInWhenVisible>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {[0, 1, 2].map((i) => (
                <Skeleton
                  key={i}
                  className="h-[280px] rounded-[20px] bg-[#F3F4F6] dark:bg-[#141518] skeleton-shimmer"
                />
              ))}
            </div>
          ) : challenges && challenges.length > 0 ? (
            <motion.div
              className="grid grid-cols-1 md:grid-cols-3 gap-5"
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: '-60px 0px' }}
            >
              {challenges.map((challenge) => (
                <motion.div key={challenge.address} variants={fadeUp}>
                  <ChallengeCard challenge={challenge} />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <GlassCard className="text-center py-12">
              <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px]">
                No active challenges yet.
              </p>
              <Link to="/challenges/create">
                <Button className="mt-4 bg-[#AF69EE] hover:bg-[#C28FF3] text-white rounded-full px-6 py-2 text-sm font-semibold transition-all duration-150 hover:-translate-y-px">
                  Create the first one
                </Button>
              </Link>
            </GlassCard>
          )}
        </div>
      </section>

      {/* ── Built on Base ──────────────────────────────────────────────── */}
      <section className="py-16 px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D]">
        <div className="max-w-[980px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-16">
            {/* Sticky left column */}
            <div className="lg:sticky lg:top-24 lg:self-start">
              <FadeInWhenVisible>
                <span className="section-label">Ecosystem</span>
                <h2
                  className="text-[28px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] mb-3"
                  style={{ fontFamily: "'Syne Variable', sans-serif" }}
                >
                  Built on 0G
                </h2>
                <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px] mb-6">
                  Powered by the full 0G ecosystem. Compute, storage, and chain,
                  purpose-built for decentralized AI.
                </p>
                <div className="flex items-center gap-2">
                  <span className="px-3 py-1 rounded-full text-[11px] font-medium text-[#9CA3AF] bg-white/60 dark:bg-white/5 backdrop-blur-[8px] border border-black/[0.04] dark:border-white/[0.06]">
                    SDK Coming Soon
                  </span>
                </div>
              </FadeInWhenVisible>
            </div>

            {/* Scrolling right column */}
            <div className="flex flex-col gap-4">
              {ZG_FEATURES.map((feature, i) => {
                return (
                  <FadeInWhenVisible key={feature.label} delay={i * 80}>
                    <div className="group/card p-5 rounded-[16px] border border-black/[0.06] dark:border-white/[0.06] bg-[#FDFDFF] dark:bg-[#0A0B0D] hover:border-black/[0.12] dark:hover:border-white/[0.12] transition-all duration-300 hover:-translate-y-px">
                      <div className="flex items-start gap-4">
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-[#0A0B0D] dark:text-[#F9FAFB] text-[15px] font-semibold tracking-[-0.015em] mb-1 tooltip-trigger"
                            data-tooltip={feature.description}
                            style={{
                              fontFamily: "'Syne Variable', sans-serif",
                            }}
                          >
                            {feature.label}
                          </p>
                          <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[13px] leading-[1.5] mb-2">
                            {feature.description}
                          </p>
                          <p className="text-[#9CA3AF] dark:text-[#6B7280] text-[12px] leading-[1.5]">
                            {feature.details}
                          </p>
                        </div>
                      </div>
                    </div>
                  </FadeInWhenVisible>
                )
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────────── */}
      <section className="py-24 px-4 bg-[#FDFDFF] dark:bg-[#0A0B0D]">
        <div className="max-w-[980px] mx-auto">
          <FadeInWhenVisible>
            <div className="group/cta relative rounded-[28px] overflow-hidden text-center px-8 py-16 bg-[#FDFDFF] dark:bg-[#141518] border border-black/[0.08] dark:border-white/[0.08] shadow-[0_4px_32px_rgba(0,0,0,0.06)] transition-shadow duration-500 hover:shadow-[0_8px_40px_rgba(175,105,238,0.1)]">
              {/* Subtle blue glow behind CTA */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    'radial-gradient(ellipse 60% 80% at 50% 50%, rgba(175,105,238,0.05) 0%, transparent 70%)',
                }}
              />

              <div className="relative">
                <ClipReveal>
                  <h2
                    className="text-[40px] md:text-[52px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1] mb-4"
                    style={{ fontFamily: "'Syne Variable', sans-serif" }}
                  >
                    Ready to break some AI?
                  </h2>
                </ClipReveal>
                <p className="text-[#4B5563] dark:text-[#D1D5DB] text-[17px] mb-8 max-w-[400px] mx-auto">
                  Pick a challenge, craft your attack, and claim the prize.
                </p>
                <Link to="/challenges">
                  <Button className="bg-[#AF69EE] hover:bg-[#C28FF3] active:bg-[#9554D4] active:scale-[0.98] text-white rounded-full px-8 py-3 text-[16px] font-semibold transition-all duration-150 h-auto shadow-[0_4px_16px_rgba(175,105,238,0.3)] hover:shadow-[0_8px_24px_rgba(175,105,238,0.4)] hover:-translate-y-px">
                    Browse Challenges
                    <ArrowRight size={16} />
                  </Button>
                </Link>
              </div>
            </div>
          </FadeInWhenVisible>
        </div>
      </section>
    </div>
  )
}
