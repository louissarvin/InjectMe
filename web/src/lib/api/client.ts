import type { WalletAuthCredentials } from '@/hooks/useAuth'
import { config } from '@/config'

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

class ApiClient {
  private baseUrl: string
  private credentials: WalletAuthCredentials | null = null

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  setWalletCredentials(credentials: WalletAuthCredentials) {
    this.credentials = credentials
  }

  clearWalletCredentials() {
    this.credentials = null
  }

  private headers(): HeadersInit {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.credentials) {
      headers['x-wallet-address'] = this.credentials.address
      headers['x-signature'] = this.credentials.signature
      headers['x-message'] = this.credentials.message
    }
    return headers
  }

  /** Public accessor so non-ApiClient fetch calls (SSE streams, etc.) can include auth. */
  getHeaders(): HeadersInit {
    return this.headers()
  }

  async get<T>(
    path: string,
    params?: Record<string, string | undefined>,
    timeout = 30_000,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value)
        }
      }
    }
    const controller = new AbortController()
    const timeout_id = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
      })
      if (!res.ok) {
        throw new ApiError(res.status, `GET ${path} failed: ${res.statusText}`)
      }
      return res.json() as Promise<T>
    } catch (err) {
      if (err instanceof ApiError) throw err
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(0, `GET ${path} timed out after ${timeout / 1_000}s`)
      }
      throw err
    } finally {
      clearTimeout(timeout_id)
    }
  }

  async post<T>(path: string, body?: unknown, timeout = 30_000): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`)
    const controller = new AbortController()
    const timeout_id = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: this.headers(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      if (!res.ok) {
        let message = res.statusText
        try {
          const json = await res.json()
          message = json?.error?.message || json?.message || res.statusText
        } catch {
          message = await res.text().catch(() => res.statusText)
        }
        throw new ApiError(res.status, `POST ${path} failed: ${message}`)
      }
      return res.json() as Promise<T>
    } catch (err) {
      if (err instanceof ApiError) throw err
      if ((err as Error).name === 'AbortError') {
        throw new ApiError(
          0,
          `POST ${path} timed out after ${timeout / 1_000}s`,
        )
      }
      throw err
    } finally {
      clearTimeout(timeout_id)
    }
  }
}

export const apiClient = new ApiClient(config.apiUrl)
export { ApiError }
