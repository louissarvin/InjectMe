import { describe, expect, it } from 'vitest'
import { cnm } from '@/utils/style'

describe('cnm', () => {
  it('merges multiple class strings', () => {
    expect(cnm('foo', 'bar')).toBe('foo bar')
  })

  it('handles conditional classes via clsx', () => {
    expect(cnm('base', false && 'hidden', 'visible')).toBe('base visible')
  })

  it('resolves tailwind conflicts via twMerge', () => {
    // tailwind-merge should keep only the last conflicting utility
    expect(cnm('p-4', 'p-6')).toBe('p-6')
    expect(cnm('text-red-500', 'text-blue-500')).toBe('text-blue-500')
  })

  it('handles undefined, null, and empty string inputs', () => {
    expect(cnm('foo', undefined, null, '', 'bar')).toBe('foo bar')
  })

  it('handles arrays', () => {
    expect(cnm(['foo', 'bar'], 'baz')).toBe('foo bar baz')
  })

  it('handles objects', () => {
    expect(cnm({ foo: true, bar: false, baz: true })).toBe('foo baz')
  })

  it('returns empty string when given no inputs', () => {
    expect(cnm()).toBe('')
  })
})
