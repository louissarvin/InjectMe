import { vi } from 'vitest'

export const mockGet = vi.fn()
export const mockPost = vi.fn()
export const mockSetWalletCredentials = vi.fn()
export const mockClearWalletCredentials = vi.fn()

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: (...args: Array<unknown>) => mockGet(...args),
    post: (...args: Array<unknown>) => mockPost(...args),
    setWalletCredentials: (...args: Array<unknown>) =>
      mockSetWalletCredentials(...args),
    clearWalletCredentials: (...args: Array<unknown>) =>
      mockClearWalletCredentials(...args),
  },
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
      this.name = 'ApiError'
    }
  },
}))
