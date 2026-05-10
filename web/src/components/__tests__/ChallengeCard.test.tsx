import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Challenge } from '@/lib/api/hooks'

// Mock router Link before importing component
import '@/test/mocks/tanstack-router'

import ChallengeCard from '@/components/ChallengeCard'

const mockChallenge: Challenge = {
  address: '0x1234567890abcdef1234567890abcdef12345678',
  name: 'Test Challenge',
  description: 'A test challenge description',
  model: 'gpt-4',
  defender: '0xabcdef1234567890abcdef1234567890abcdef12',
  messagePrice: '1000000000000000000',
  expiresAt: new Date(Date.now() + 86400 * 1000).toISOString(),
  challengeType: 0,
  prizePool: '5000000000000000000',
  totalAttempts: 42,
  active: true,
}

describe('ChallengeCard', () => {
  it('renders challenge name', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('Test Challenge')).toBeInTheDocument()
  })

  it('renders challenge description', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('A test challenge description')).toBeInTheDocument()
  })

  it('renders model name', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('gpt-4')).toBeInTheDocument()
  })

  it('renders total attempts', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('renders challenge type badge', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('Tournament')).toBeInTheDocument()
  })

  it('renders "Active" status badge when active', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('renders "Resolved" status when there is a winner', () => {
    const resolved = {
      ...mockChallenge,
      active: false,
      winner: '0xwinner',
    }
    render(<ChallengeCard challenge={resolved} />)
    expect(screen.getByText('Resolved')).toBeInTheDocument()
  })

  it('renders truncated defender address', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    // 0xabcd...ef12
    expect(screen.getByText('0xabcd...ef12')).toBeInTheDocument()
  })

  it('links to the correct challenge detail route', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    const link = screen.getByTestId('router-link')
    expect(link).toHaveAttribute('href', `/challenges/${mockChallenge.address}`)
  })

  it('formats prize pool from wei to 0G', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    // 5e18 wei = 5 OG
    expect(screen.getByText('5 OG')).toBeInTheDocument()
  })

  it('shows Native label when prizeType is not erc20', () => {
    render(<ChallengeCard challenge={mockChallenge} />)
    expect(screen.getByText('Native')).toBeInTheDocument()
  })

  it('shows ERC-20 label when prizeType is erc20', () => {
    const erc20 = { ...mockChallenge, prizeType: 'erc20' as const }
    render(<ChallengeCard challenge={erc20} />)
    expect(screen.getByText('ERC-20')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(
      <ChallengeCard challenge={mockChallenge} className="extra-class" />,
    )
    const link = container.firstChild as HTMLElement
    expect(link.className).toContain('extra-class')
  })
})
