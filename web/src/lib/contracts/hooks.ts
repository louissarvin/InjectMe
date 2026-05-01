import { useReadContract, useWriteContract } from 'wagmi'
import type { Address } from 'viem'
import {
  agentNFTAbi,
  challengeAbi,
  challengeFactoryAbi,
  oracleStakingAbi,
  reputationRegistryAbi,
} from '@/lib/contracts/abis'
import { CONTRACT_ADDRESSES } from '@/lib/contracts/addresses'

// --- Challenge reads ---

export function useChallengePrizePool(address: Address | undefined) {
  return useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'prizePool',
    query: { enabled: !!address, refetchInterval: 10_000 },
  })
}

export function useChallengeDetails(address: Address | undefined) {
  const defender = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'defender',
    query: { enabled: !!address },
  })
  const messagePrice = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'messagePrice',
    query: { enabled: !!address },
  })
  const expiresAt = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'expiresAt',
    query: { enabled: !!address },
  })
  const prizePool = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'prizePool',
    query: { enabled: !!address, refetchInterval: 10_000 },
  })
  const totalAttempts = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'totalAttempts',
    query: { enabled: !!address, refetchInterval: 10_000 },
  })
  const active = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'active',
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
  const winner = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'winner',
    query: { enabled: !!address },
  })
  const challengeType = useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'challengeType',
    query: { enabled: !!address },
  })
  return {
    defender,
    messagePrice,
    expiresAt,
    prizePool,
    totalAttempts,
    active,
    winner,
    challengeType,
  }
}

export function useChallengeActive(address: Address | undefined) {
  return useReadContract({
    address,
    abi: challengeAbi,
    functionName: 'active',
    query: { enabled: !!address, refetchInterval: 15_000 },
  })
}

export function usePendingWithdrawal(
  challengeAddress: Address | undefined,
  userAddress: Address | undefined,
) {
  return useReadContract({
    address: challengeAddress,
    abi: challengeAbi,
    functionName: 'pendingWithdrawals',
    args: userAddress ? [userAddress] : undefined,
    query: {
      enabled: !!challengeAddress && !!userAddress,
      refetchInterval: 15_000,
    },
  })
}

// --- Challenge writes ---

export function useCommitAttempt(challengeAddress: Address | undefined) {
  const { writeContractAsync, ...rest } = useWriteContract()
  return {
    commitAttemptAsync: (commitHash: `0x${string}`, messagePrice: bigint) => {
      if (!challengeAddress) throw new Error('challengeAddress is required')
      return writeContractAsync({
        address: challengeAddress,
        abi: challengeAbi,
        functionName: 'commitAttempt',
        args: [commitHash],
        value: messagePrice,
      })
    },
    ...rest,
  }
}

export function useWithdraw(challengeAddress: Address | undefined) {
  const { writeContractAsync, ...rest } = useWriteContract()
  return {
    withdrawAsync: () => {
      if (!challengeAddress) throw new Error('challengeAddress is required')
      return writeContractAsync({
        address: challengeAddress,
        abi: challengeAbi,
        functionName: 'withdraw',
      })
    },
    ...rest,
  }
}

export function useClaimExpiry(challengeAddress: Address | undefined) {
  const { writeContractAsync, ...rest } = useWriteContract()
  return {
    claimExpiryAsync: () => {
      if (!challengeAddress) throw new Error('challengeAddress is required')
      return writeContractAsync({
        address: challengeAddress,
        abi: challengeAbi,
        functionName: 'claimExpiry',
      })
    },
    ...rest,
  }
}

// --- Factory reads ---

export function useChallengeCount() {
  return useReadContract({
    address: CONTRACT_ADDRESSES.challengeFactory,
    abi: challengeFactoryAbi,
    functionName: 'getChallengeCount',
    query: { refetchInterval: 30_000 },
  })
}

export function useFactoryConfig() {
  const protocolFeeBps = useReadContract({
    address: CONTRACT_ADDRESSES.challengeFactory,
    abi: challengeFactoryAbi,
    functionName: 'protocolFeeBps',
  })
  const minPrizePool = useReadContract({
    address: CONTRACT_ADDRESSES.challengeFactory,
    abi: challengeFactoryAbi,
    functionName: 'minPrizePool',
  })
  const minMessagePrice = useReadContract({
    address: CONTRACT_ADDRESSES.challengeFactory,
    abi: challengeFactoryAbi,
    functionName: 'minMessagePrice',
  })
  return { protocolFeeBps, minPrizePool, minMessagePrice }
}

export function useBountyListingFee() {
  return useReadContract({
    address: CONTRACT_ADDRESSES.challengeFactory,
    abi: challengeFactoryAbi,
    functionName: 'bountyListingFee',
  })
}

// --- Agent NFT reads ---

export function useAgentBalance(ownerAddress: Address | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.agentNFT,
    abi: agentNFTAbi,
    functionName: 'balanceOf',
    args: ownerAddress ? [ownerAddress] : undefined,
    query: { enabled: !!ownerAddress },
  })
}

export function useAgentSecurityScore(tokenId: bigint | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.agentNFT,
    abi: agentNFTAbi,
    functionName: 'getSecurityScore',
    args: tokenId !== undefined ? [tokenId] : undefined,
    query: { enabled: tokenId !== undefined },
  })
}

// --- Reputation reads ---

export function useAttackerReputation(address: Address | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: 'getAttackerReputation',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
}

export function useDefenderReputation(address: Address | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: 'getDefenderReputation',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
}

export function useAttackerScore(address: Address | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: 'getAttackerScore',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
}

export function useDefenderScore(address: Address | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: 'getDefenderScore',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
}

// --- Oracle Staking reads ---

export function useActiveOracles() {
  return useReadContract({
    address: CONTRACT_ADDRESSES.oracleStaking,
    abi: oracleStakingAbi,
    functionName: 'getActiveOracles',
    query: { refetchInterval: 60_000 },
  })
}

export function useOperatorInfo(address: Address | undefined) {
  return useReadContract({
    address: CONTRACT_ADDRESSES.oracleStaking,
    abi: oracleStakingAbi,
    functionName: 'getOperator',
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  })
}

export function useStakingConfig() {
  const minStake = useReadContract({
    address: CONTRACT_ADDRESSES.oracleStaking,
    abi: oracleStakingAbi,
    functionName: 'minStake',
  })
  const activeOracleCount = useReadContract({
    address: CONTRACT_ADDRESSES.oracleStaking,
    abi: oracleStakingAbi,
    functionName: 'activeOracleCount',
  })
  const confirmationsRequired = useReadContract({
    address: CONTRACT_ADDRESSES.oracleStaking,
    abi: oracleStakingAbi,
    functionName: 'confirmationsRequired',
  })
  return { minStake, activeOracleCount, confirmationsRequired }
}
