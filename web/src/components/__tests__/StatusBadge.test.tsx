import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '@/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders "Active" label for active status', () => {
    render(<StatusBadge status="active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders "Resolved" label for resolved status', () => {
    render(<StatusBadge status="resolved" />)
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('renders "Expired" label for expired status', () => {
    render(<StatusBadge status="expired" />)
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('renders "Cancelled" label for cancelled status', () => {
    render(<StatusBadge status="cancelled" />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })

  it('shows pulse dot only for active status', () => {
    const { container, rerender } = render(<StatusBadge status="active" />)
    // Active should have the animated dot
    expect(container.querySelector('.animate-pulse-dot')).toBeInTheDocument()

    rerender(<StatusBadge status="expired" />)
    expect(
      container.querySelector('.animate-pulse-dot'),
    ).not.toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <StatusBadge status="active" className="my-custom" />,
    )
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toContain('my-custom')
  })
})
