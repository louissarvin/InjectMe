import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CountdownTimer from '@/components/CountdownTimer'

afterEach(() => {
  vi.useRealTimers()
})

describe('CountdownTimer', () => {
  it('renders "Expired" when endTime is in the past', () => {
    const pastTime = Math.floor(Date.now() / 1000) - 3600
    render(<CountdownTimer endTime={pastTime} />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('renders countdown for a future time', () => {
    vi.useFakeTimers()
    // Set current time to a fixed point
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    // 2 days, 3 hours, 15 minutes, 30 seconds from now
    const futureTime =
      Math.floor(Date.now() / 1000) + 2 * 86400 + 3 * 3600 + 15 * 60 + 30

    const { container } = render(<CountdownTimer endTime={futureTime} />)
    const text = container.textContent ?? ''

    // Should show "2d" for days and the time
    expect(text).toContain('2d')
    expect(text).toContain('03')
    expect(text).toContain('15')
  })

  it('shows friendly format for 7+ days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const futureTime = Math.floor(Date.now() / 1000) + 10 * 86400 + 5 * 3600
    const { container } = render(<CountdownTimer endTime={futureTime} />)
    const text = container.textContent ?? ''

    expect(text).toContain('10d')
    expect(text).toContain('5h')
  })

  it('applies custom className', () => {
    const pastTime = Math.floor(Date.now() / 1000) - 100
    const { container } = render(
      <CountdownTimer endTime={pastTime} className="custom-class" />,
    )
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('custom-class')
  })
})
