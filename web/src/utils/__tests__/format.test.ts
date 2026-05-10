import { describe, expect, it } from 'vitest'
import {
  capitalizeFirstLetter,
  formatNumberToKMB,
  formatStringToNumericDecimals,
  formatUiNumber,
  serializeFormattedStringToFloat,
  unsluggify,
} from '@/utils/format'

describe('formatStringToNumericDecimals', () => {
  it('strips non-numeric characters except dots', () => {
    expect(formatStringToNumericDecimals('$1,234.56')).toBe('1,234.56')
  })

  it('limits decimals to maxDecimals', () => {
    expect(formatStringToNumericDecimals('1.123456789', 4)).toBe('1.1234')
  })

  it('handles multiple dots by keeping first two parts only', () => {
    expect(formatStringToNumericDecimals('1.2.3.4')).toBe('1.2')
  })

  it('strips leading zeros from integer part', () => {
    expect(formatStringToNumericDecimals('007.5')).toBe('7.5')
  })

  it('preserves single zero', () => {
    expect(formatStringToNumericDecimals('0.5')).toBe('0.5')
  })

  it('adds commas to thousands', () => {
    expect(formatStringToNumericDecimals('1234567')).toBe('1,234,567')
  })

  it('handles empty string', () => {
    expect(formatStringToNumericDecimals('')).toBe('0')
  })

  it('handles dot-only input', () => {
    expect(formatStringToNumericDecimals('.')).toBe('0.')
  })
})

describe('serializeFormattedStringToFloat', () => {
  it('converts formatted string with commas to float', () => {
    expect(serializeFormattedStringToFloat('1,234.56')).toBe(1234.56)
  })

  it('handles plain numbers', () => {
    expect(serializeFormattedStringToFloat('42')).toBe(42)
  })

  it('returns 0 for unparseable input', () => {
    expect(serializeFormattedStringToFloat('')).toBeNaN()
  })
})

describe('formatNumberToKMB', () => {
  it('formats billions', () => {
    expect(formatNumberToKMB(1_500_000_000)).toBe('1.5B')
  })

  it('formats millions', () => {
    expect(formatNumberToKMB(2_300_000)).toBe('2.3M')
  })

  it('formats thousands', () => {
    expect(formatNumberToKMB(5_000)).toBe('5K')
  })

  it('returns raw number for values under 1000', () => {
    expect(formatNumberToKMB(999)).toBe('999')
  })

  it('strips trailing .0', () => {
    expect(formatNumberToKMB(1_000_000)).toBe('1M')
    expect(formatNumberToKMB(1_000)).toBe('1K')
  })
})

describe('formatUiNumber', () => {
  it('formats a basic number with currency', () => {
    expect(formatUiNumber(1234.5, 'ETH')).toBe('1,234.5 ETH')
  })

  it('returns zero with default decimals for near-zero value', () => {
    expect(formatUiNumber(0)).toBe('0.00')
  })

  it('uses exponential notation for very small values', () => {
    expect(formatUiNumber(0.0000001)).toMatch(/e/)
  })

  it('humanizes large values when humanize option is set', () => {
    const result = formatUiNumber(1500000, '', { humanize: true })
    expect(result).toBe('1.5m')
  })

  it('respects exactDecimals option', () => {
    expect(formatUiNumber(1.5, '', { exactDecimals: true })).toBe('1.5')
  })

  it('respects round option', () => {
    const result = formatUiNumber(1234.5678, '', { round: true })
    expect(result).toBe('1234.6')
  })

  it('handles string input', () => {
    expect(formatUiNumber('42.5')).toBe('42.5')
  })

  it('shows more decimals for small fractional values', () => {
    const result = formatUiNumber(0.00012345)
    // Should show enough decimals to reveal the significant digit
    expect(result).toContain('0.0001')
  })

  it('returns maxDecimals=0 without decimal for near-zero', () => {
    expect(formatUiNumber(0, '', { maxDecimals: 0 })).toBe('0')
  })
})

describe('capitalizeFirstLetter', () => {
  it('capitalizes first letter', () => {
    expect(capitalizeFirstLetter('hello')).toBe('Hello')
  })

  it('handles empty string', () => {
    expect(capitalizeFirstLetter('')).toBe('')
  })

  it('handles already capitalized string', () => {
    expect(capitalizeFirstLetter('Hello')).toBe('Hello')
  })
})

describe('unsluggify', () => {
  it('converts slug to title case', () => {
    expect(unsluggify('hello-world')).toBe('Hello World')
  })

  it('supports custom separator', () => {
    expect(unsluggify('hello_world', '_')).toBe('Hello World')
  })

  it('handles single word', () => {
    expect(unsluggify('hello')).toBe('Hello')
  })
})
