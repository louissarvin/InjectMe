import { vi } from 'vitest'

export const mockUseReadContract = vi.fn().mockReturnValue({
  data: undefined,
  isLoading: false,
  isError: false,
  error: null,
  refetch: vi.fn(),
})

export const mockUseWriteContract = vi.fn().mockReturnValue({
  writeContractAsync: vi.fn(),
  data: undefined,
  isPending: false,
  isError: false,
  error: null,
  reset: vi.fn(),
})

export const mockUseAccount = vi.fn().mockReturnValue({
  address: undefined,
  isConnected: false,
  isDisconnected: true,
  chain: undefined,
  connector: undefined,
})

export const mockUseConnect = vi.fn().mockReturnValue({
  connect: vi.fn(),
  connectors: [],
  isPending: false,
  error: null,
})

export const mockUseDisconnect = vi.fn().mockReturnValue({
  disconnect: vi.fn(),
})

export const mockUseSignMessage = vi.fn().mockReturnValue({
  mutateAsync: vi.fn(),
})

vi.mock('wagmi', () => ({
  useReadContract: (...args: Array<unknown>) => mockUseReadContract(...args),
  useWriteContract: (...args: Array<unknown>) => mockUseWriteContract(...args),
  useAccount: (...args: Array<unknown>) => mockUseAccount(...args),
  useConnect: (...args: Array<unknown>) => mockUseConnect(...args),
  useDisconnect: (...args: Array<unknown>) => mockUseDisconnect(...args),
  useSignMessage: (...args: Array<unknown>) => mockUseSignMessage(...args),
}))
