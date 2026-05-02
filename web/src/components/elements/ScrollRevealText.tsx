import { useCallback, useEffect, useRef, useState } from 'react'

interface ScrollRevealTextProps {
  text: string
  className?: string
}

export default function ScrollRevealText({
  text,
  className,
}: ScrollRevealTextProps) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [progress, setProgress] = useState(0)
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    const html = document.documentElement
    const check = () => setIsDark(html.classList.contains('dark'))
    check()
    const observer = new MutationObserver(check)
    observer.observe(html, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const onScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vh = window.innerHeight
    const deadZone = 0.3 * vh - rect.height
    setProgress(Math.max(0, Math.min(1, (vh - rect.top) / (vh - deadZone))))
  }, [])

  useEffect(() => {
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [onScroll])

  const words = text.split(' ')

  return (
    <p ref={ref} className={className}>
      {words.map((word, i) => {
        const wordProgress = 1.5 / words.length
        const opacity = Math.max(
          0.15,
          Math.min(1, (progress - i / words.length) / wordProgress),
        )
        const color = isDark
          ? `rgba(249,250,251,${opacity})`
          : `rgba(10,11,13,${opacity})`
        return (
          <span
            key={i}
            style={{
              color,
              transition: 'color 0.08s linear',
            }}
            className="inline-block mr-[0.25em]"
          >
            {word}
          </span>
        )
      })}
    </p>
  )
}
