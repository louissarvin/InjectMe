import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
  Button,
  Input,
  Select,
  SelectItem,
  Spinner,
  Tab,
  Tabs,
  Textarea,
  Tooltip,
} from '@heroui/react'
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi'
import {
  decodeEventLog,
  formatEther,
  keccak256,
  parseEther,
  toBytes,
} from 'viem'
import { AlertCircle, ArrowLeft, HelpCircle, Info, Zap } from 'lucide-react'
import { cnm } from '@/utils/style'
import GlassCard from '@/components/GlassCard'
import {
  useAgent,
  useCreateChallenge,
  useDeployAgent,
  useModels,
} from '@/lib/api/hooks'
import { useBountyListingFee, useFactoryConfig } from '@/lib/contracts/hooks'
import { challengeFactoryAbi } from '@/lib/contracts/abis'
import { CONTRACT_ADDRESSES } from '@/lib/contracts/addresses'
import { useAuth } from '@/hooks/useAuth'

export const Route = createFileRoute('/challenges/create')({
  component: CreateChallengePage,
  validateSearch: (search: Record<string, unknown>): { fromAgent?: number } => ({
    fromAgent: search.fromAgent ? Number(search.fromAgent) : undefined,
  }),
})

type ChallengeType = 'tournament' | 'bounty' | 'alignment'

type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'expert'

type DurationUnit = 'hours' | 'days' | 'weeks'

interface FormState {
  name: string
  systemPrompt: string
  description: string
  model: string
  prizePool: string
  messagePrice: string
  rewardPerAttempt: string
  duration: string
  durationUnit: DurationUnit
  difficulty: Difficulty
  visibility: 'public' | 'unlisted'
}

const INITIAL_FORM: FormState = {
  name: '',
  systemPrompt: '',
  description: '',
  model: '',
  prizePool: '',
  messagePrice: '',
  rewardPerAttempt: '',
  duration: '7',
  durationUnit: 'days',
  difficulty: 'intermediate',
  visibility: 'public',
}

const TYPE_DESCRIPTIONS: Record<ChallengeType, string> = {
  tournament:
    'Attackers pay per message attempt. Prize pool goes to whoever breaks your prompt.',
  bounty:
    'Fixed prize for the first attacker to break your prompt. A listing fee is deducted from the prize.',
  alignment:
    'Crowdsource adversarial data. Each attacker earns a reward per attempt; used to train safer models.',
}

function FieldLabel({
  label,
  tooltip,
  required,
}: {
  label: string
  tooltip?: string
  required?: boolean
}) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="text-[13px] font-medium text-[#4B5563] dark:text-[#D1D5DB]">
        {label}
        {required && <span className="text-[#CF202F] ml-0.5">*</span>}
      </span>
      {tooltip && (
        <Tooltip
          content={tooltip}
          placement="right"
          classNames={{
            content:
              'bg-white dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] text-[#4B5563] dark:text-[#D1D5DB] text-[12px] max-w-[240px] shadow-lg',
          }}
        >
          <HelpCircle size={13} className="text-[#6B7280] cursor-help" />
        </Tooltip>
      )}
    </div>
  )
}

function inputClassNames() {
  return {
    inputWrapper: [
      'bg-[#F3F4F6] dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl',
      'hover:border-[#D1D5DB] dark:hover:border-[#3D4048] focus-within:!border-[#AF69EE]',
      'transition-colors duration-200 !outline-none !ring-0 !shadow-none',
    ].join(' '),
    input:
      'text-[#0A0B0D] dark:text-[#F9FAFB] text-[14px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#4B5563] !outline-none !ring-0 focus:!outline-none focus:!ring-0',
    label: 'text-[#9CA3AF] text-[13px]',
  }
}

function selectClassNames() {
  return {
    trigger: [
      'bg-[#F3F4F6] dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl',
      'hover:border-[#D1D5DB] dark:hover:border-[#3D4048] data-[focus=true]:!border-[#AF69EE]',
      'transition-colors duration-200 !outline-none !ring-0 !shadow-none',
    ].join(' '),
    value: 'text-[#0A0B0D] dark:text-[#F9FAFB] text-[14px] !pr-6',
    selectorIcon: 'text-[#9CA3AF] dark:text-[#6B7280] right-3',
    label: 'text-[#9CA3AF] text-[13px]',
  }
}

function selectPopoverProps() {
  return {
    listboxProps: {
      itemClasses: {
        base: 'text-[#0A0B0D] dark:text-[#D1D5DB] data-[hover=true]:bg-[#F3F4F6] dark:data-[hover=true]:bg-[#2D2F36] data-[selected=true]:text-[#AF69EE] rounded-lg',
      },
    },
    popoverProps: {
      classNames: {
        content:
          'bg-white dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl',
      },
    },
  }
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 bg-[#CF202F]/10 border border-[#CF202F]/25 rounded-xl px-4 py-3">
      <AlertCircle size={15} className="text-[#CF202F] shrink-0 mt-0.5" />
      <p className="text-[#CF202F] text-[13px] leading-relaxed">{message}</p>
    </div>
  )
}

function CreateChallengePage() {
  const { address, isConnected } = useAccount()
  const navigate = useNavigate()
  const { fromAgent } = Route.useSearch()
  const { ensureFreshCredentials } = useAuth()

  const [challengeType, setChallengeType] =
    useState<ChallengeType>('tournament')
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [errors, setErrors] = useState<
    Partial<Record<keyof FormState, string>>
  >({})
  const [submitError, setSubmitError] = useState('')
  const [step, setStep] = useState<
    'idle' | 'signing' | 'confirming' | 'registering' | 'done'
  >('idle')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()

  const { data: models, isLoading: modelsLoading } = useModels()
  const { protocolFeeBps, minPrizePool, minMessagePrice } = useFactoryConfig()
  const { data: bountyListingFee } = useBountyListingFee()
  const { writeContractAsync } = useWriteContract()
  const { mutateAsync: createChallenge } = useCreateChallenge()
  const { mutateAsync: deployAgent } = useDeployAgent(fromAgent ?? 0)

  // When deploying from an agent, fetch agent data to pre-fill model
  const { data: sourceAgent } = useAgent(fromAgent ?? -1, {
    enabled: fromAgent !== undefined,
  })

  // Pre-fill model from source agent when data arrives
  useEffect(() => {
    if (sourceAgent?.model && fromAgent !== undefined) {
      setForm((prev) => ({ ...prev, model: sourceAgent.model }))
    }
  }, [sourceAgent?.model, fromAgent])

  // Kept for rules-of-hooks; actual receipt waiting is done imperatively in pollReceipt
  useWaitForTransactionReceipt({ hash: txHash, query: { enabled: !!txHash } })

  const set = useCallback(
    <TKey extends keyof FormState>(field: TKey, value: FormState[TKey]) => {
      setForm((prev) => ({ ...prev, [field]: value }))
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    },
    [],
  )

  function durationToHours(value: string, unit: DurationUnit): number {
    const n = Number(value)
    if (unit === 'weeks') return n * 168
    if (unit === 'days') return n * 24
    return n
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {}

    if (!form.name.trim()) next.name = 'Name is required'
    // System prompt is not required when deploying from an agent — it comes from the agent
    if (fromAgent === undefined && !form.systemPrompt.trim())
      next.systemPrompt = 'System prompt is required'
    if (!form.model) next.model = 'Select a model'
    if (
      !form.prizePool ||
      isNaN(Number(form.prizePool)) ||
      Number(form.prizePool) <= 0 ||
      Number(form.prizePool) > 1_000_000
    )
      next.prizePool = 'Enter a valid prize pool amount (max 1,000,000)'
    const totalHours = durationToHours(form.duration, form.durationUnit)
    if (!form.duration || isNaN(Number(form.duration)) || totalHours < 1 || totalHours > 2160)
      next.duration = 'Duration must be between 1 hour and 90 days'

    if (challengeType === 'tournament') {
      if (
        !form.messagePrice ||
        isNaN(Number(form.messagePrice)) ||
        Number(form.messagePrice) <= 0
      )
        next.messagePrice = 'Enter a valid message price'
    }

    if (challengeType === 'alignment') {
      if (
        !form.rewardPerAttempt ||
        isNaN(Number(form.rewardPerAttempt)) ||
        Number(form.rewardPerAttempt) <= 0
      )
        next.rewardPerAttempt = 'Enter a valid reward per attempt'
    }

    if (
      minPrizePool.data !== undefined &&
      Number(form.prizePool) < Number(formatEther(minPrizePool.data))
    ) {
      next.prizePool = `Minimum prize pool is ${formatEther(minPrizePool.data)} OG`
    }

    if (
      challengeType === 'tournament' &&
      minMessagePrice.data !== undefined &&
      Number(form.messagePrice) < Number(formatEther(minMessagePrice.data))
    ) {
      next.messagePrice = `Minimum message price is ${formatEther(minMessagePrice.data)} OG`
    }

    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function handleSubmit() {
    if (!isConnected || !address) return
    if (fromAgent !== undefined && sourceAgent && sourceAgent.owner.toLowerCase() !== address.toLowerCase()) {
      setSubmitError('Switch MetaMask to the wallet that owns this agent.')
      return
    }
    if (!validate()) return

    setSubmitError('')
    setStep('signing')

    try {
      // When deploying from an agent, the system prompt lives in the TEE.
      // We still need a secretHash for the on-chain call; use a placeholder
      // that the backend will override when linking the agent.
      const secretHash =
        fromAgent !== undefined
          ? keccak256(toBytes(`agent:${fromAgent}`))
          : keccak256(toBytes(form.systemPrompt))

      const durationSeconds = BigInt(
        Math.round(durationToHours(form.duration, form.durationUnit) * 3600),
      )
      const prizePoolWei = parseEther(form.prizePool)

      let hash: `0x${string}`

      if (challengeType === 'tournament') {
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.challengeFactory,
          abi: challengeFactoryAbi,
          functionName: 'createTournament',
          args: [
            form.name,
            parseEther(form.messagePrice),
            durationSeconds,
            secretHash,
            form.model,
          ],
          value: prizePoolWei,
        })
      } else if (challengeType === 'bounty') {
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.challengeFactory,
          abi: challengeFactoryAbi,
          functionName: 'createBounty',
          args: [form.name, durationSeconds, secretHash, form.model],
          value: prizePoolWei,
        })
      } else {
        hash = await writeContractAsync({
          address: CONTRACT_ADDRESSES.challengeFactory,
          abi: challengeFactoryAbi,
          functionName: 'createAlignment',
          args: [
            form.name,
            parseEther(form.rewardPerAttempt),
            durationSeconds,
            secretHash,
            form.model,
          ],
          value: prizePoolWei,
        })
      }

      setTxHash(hash)
      setStep('confirming')

      const receipt = await pollReceipt(hash)

      let challengeAddress = ''
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: challengeFactoryAbi,
            eventName: 'ChallengeCreated',
            data: log.data,
            topics: log.topics,
          })
          challengeAddress = decoded.args.challenge
          break
        } catch {
          // Not this event, try next
        }
      }

      if (!challengeAddress) {
        throw new Error('Could not find ChallengeCreated event in receipt')
      }

      setStep('registering')

      // Backend registration: if this fails the on-chain challenge still exists,
      // so we catch separately and redirect anyway.
      try {
        await ensureFreshCredentials()
        if (fromAgent !== undefined) {
          await deployAgent({
            contractAddress: challengeAddress,
            name: form.name,
            description: form.description || undefined,
            visibility: form.visibility,
            difficulty: form.difficulty,
            challengeLabel:
              challengeType === 'alignment' ? 'ALIGNMENT' : undefined,
          })
        } else {
          await createChallenge({
            contractAddress: challengeAddress,
            name: form.name,
            model: form.model,
            systemPrompt: form.systemPrompt,
            defender: address,
            description: form.description || undefined,
            visibility: form.visibility,
            difficulty: form.difficulty,
            challengeLabel:
              challengeType === 'alignment' ? 'ALIGNMENT' : undefined,
          })
        }
      } catch (backendErr) {
        console.error('[create] Backend registration failed, but on-chain challenge exists:', backendErr)
        // Continue to navigate; the challenge page will still work from on-chain data
      }

      setStep('done')
      navigate({ to: '/challenges/$id', params: { id: challengeAddress } })
    } catch (err) {
      const raw = (err as Error).message ?? ''
      // Strip internal details: show only the user-actionable portion.
      // Wallet rejections come as "User rejected the request." which is safe.
      // Contract reverts include "execution reverted:" prefix.
      const revertMatch = raw.match(/execution reverted:\s*(.+?)(?:\s*\(|$)/)
      const userMessage = revertMatch
        ? revertMatch[1].trim()
        : raw.length > 120
          ? 'Transaction failed. Please check your wallet and try again.'
          : raw
      setSubmitError(userMessage)
      setStep('idle')
    }
  }

  const isSubmitting = step !== 'idle' && step !== 'done'

  const protocolFeeDisplay =
    protocolFeeBps.data !== undefined
      ? `${(Number(protocolFeeBps.data) / 100).toFixed(1)}%`
      : null

  const minPrizeDisplay =
    minPrizePool.data !== undefined
      ? `${formatEther(minPrizePool.data)} OG`
      : null

  const minMsgPriceDisplay =
    minMessagePrice.data !== undefined
      ? `${formatEther(minMessagePrice.data)} OG`
      : null

  const bountyFeeDisplay =
    bountyListingFee != null ? `${formatEther(bountyListingFee)} OG` : null

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-white dark:bg-[#0A0B0D] flex items-center justify-center px-4">
        <GlassCard
          variant="standard"
          className="max-w-md w-full text-center py-12"
        >
          <div className="w-12 h-12 rounded-full bg-[#AF69EE]/10 border border-[#AF69EE]/20 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={20} className="text-[#AF69EE]" />
          </div>
          <h2 className="text-[20px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] mb-2">
            Connect your wallet
          </h2>
          <p className="text-[#9CA3AF] text-[14px]">
            You need to connect a wallet to create a challenge.
          </p>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D]">
      <div className="max-w-[980px] mx-auto px-6 md:px-10 py-12">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/challenges"
            className="inline-flex items-center gap-1.5 text-[#9CA3AF] hover:text-[#0A0B0D] dark:text-[#F9FAFB] text-[13px] transition-colors mb-6"
          >
            <ArrowLeft size={14} />
            Challenges
          </Link>
          <h1 className="text-[28px] font-bold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-tight">
            Create Challenge
          </h1>
          <p className="text-[#9CA3AF] text-[14px] mt-1.5">
            Deploy an AI agent and let attackers try to break it.
          </p>
        </div>

        {/* fromAgent banner */}
        {fromAgent !== undefined && sourceAgent && (
          <div className={`flex items-start gap-2.5 border rounded-xl px-4 py-3 mb-4 ${
            address && sourceAgent.owner.toLowerCase() === address.toLowerCase()
              ? 'bg-[#AF69EE]/8 border-[#AF69EE]/20'
              : 'bg-[#CF202F]/8 border-[#CF202F]/20'
          }`}>
            <Zap size={14} className={
              address && sourceAgent.owner.toLowerCase() === address.toLowerCase()
                ? 'text-[#AF69EE] shrink-0 mt-0.5'
                : 'text-[#CF202F] shrink-0 mt-0.5'
            } />
            <p className={`text-[13px] leading-relaxed ${
              address && sourceAgent.owner.toLowerCase() === address.toLowerCase()
                ? 'text-[#AF69EE]'
                : 'text-[#CF202F]'
            }`}>
              {address && sourceAgent.owner.toLowerCase() === address.toLowerCase() ? (
                <>
                  Deploying Agent{' '}
                  <span className="font-semibold font-mono">#{fromAgent}</span> into
                  a new challenge. The system prompt from your agent will be used.
                </>
              ) : (
                <>
                  Wrong wallet connected. Agent{' '}
                  <span className="font-semibold font-mono">#{fromAgent}</span> is owned by{' '}
                  <span className="font-mono">{sourceAgent.owner.slice(0, 6)}...{sourceAgent.owner.slice(-4)}</span>.
                  Please switch to that wallet in MetaMask.
                </>
              )}
            </p>
          </div>
        )}

        {/* Challenge type tabs */}
        <GlassCard variant="standard" className="mb-4">
          <Tabs
            selectedKey={challengeType}
            onSelectionChange={(key) => setChallengeType(key as ChallengeType)}
            variant="underlined"
            classNames={{
              tabList:
                'gap-6 border-b border-black/[0.08] dark:border-[#2D2F36] pb-0 w-full',
              cursor: 'bg-[#AF69EE]',
              tab: 'text-[13px] font-medium text-[#6B7280] data-[selected=true]:text-[#0A0B0D] dark:data-[selected=true]:text-[#F9FAFB] pb-3 px-0',
              panel: 'pt-5 px-0',
            }}
          >
            <Tab key="tournament" title="Tournament" />
            <Tab key="bounty" title="Bounty" />
            <Tab key="alignment" title="Alignment" />
          </Tabs>
          <p className="text-[#9CA3AF] text-[13px] leading-relaxed">
            {TYPE_DESCRIPTIONS[challengeType]}
          </p>
        </GlassCard>

        {/* Factory config info */}
        {(protocolFeeDisplay || minPrizeDisplay) && (
          <div className="flex items-start gap-2.5 bg-[#AF69EE]/6 border border-[#AF69EE]/15 rounded-xl px-4 py-3 mb-4">
            <Info size={14} className="text-[#AF69EE] shrink-0 mt-0.5" />
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {protocolFeeDisplay && (
                <span className="text-[#9CA3AF] text-[12px]">
                  Protocol fee:{' '}
                  <span className="text-[#0A0B0D] dark:text-[#D1D5DB] font-medium">
                    {protocolFeeDisplay}
                  </span>
                </span>
              )}
              {minPrizeDisplay && (
                <span className="text-[#9CA3AF] text-[12px]">
                  Min prize pool:{' '}
                  <span className="text-[#0A0B0D] dark:text-[#D1D5DB] font-medium">
                    {minPrizeDisplay}
                  </span>
                </span>
              )}
              {challengeType === 'tournament' && minMsgPriceDisplay && (
                <span className="text-[#9CA3AF] text-[12px]">
                  Min message price:{' '}
                  <span className="text-[#0A0B0D] dark:text-[#D1D5DB] font-medium">
                    {minMsgPriceDisplay}
                  </span>
                </span>
              )}
              {challengeType === 'bounty' && bountyFeeDisplay && (
                <span className="text-[#9CA3AF] text-[12px]">
                  Listing fee:{' '}
                  <span className="text-[#0A0B0D] dark:text-[#D1D5DB] font-medium">
                    {bountyFeeDisplay}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Form */}
        <GlassCard variant="standard" className="space-y-5">
          {/* Name */}
          <div>
            <FieldLabel label="Challenge name" required />
            <Input
              value={form.name}
              onValueChange={(v) => set('name', v)}
              placeholder="e.g. The Vault, Lockdown Protocol"
              isInvalid={!!errors.name}
              errorMessage={errors.name}
              classNames={inputClassNames()}
              maxLength={80}
            />
          </div>

          {/* Model */}
          <div>
            <FieldLabel
              label="AI model"
              required
              tooltip="The model your agent will run on. Powered by 0G Compute."
            />
            {modelsLoading ? (
              <div className="h-10 bg-[#F3F4F6] dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl flex items-center px-3">
                <Spinner size="sm" color="default" />
              </div>
            ) : (
              <Select
                selectedKeys={form.model ? [form.model] : []}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as string
                  if (selected) set('model', selected)
                }}
                placeholder="Select a model"
                isInvalid={!!errors.model}
                errorMessage={errors.model}
                classNames={selectClassNames()}
                {...selectPopoverProps()}
              >
                {(models ?? []).map((m) => (
                  <SelectItem key={m.model} textValue={m.model}>
                    <span className="text-[13px]">{m.model}</span>
                  </SelectItem>
                ))}
              </Select>
            )}
          </div>

          {/* System prompt — hidden when deploying from an agent */}
          {fromAgent === undefined ? (
            <div>
              <FieldLabel
                label="System prompt"
                required
                tooltip="The secret instructions given to your AI agent. The keccak256 hash is stored on-chain; the plaintext is stored encrypted off-chain."
              />
              <Textarea
                value={form.systemPrompt}
                onValueChange={(v) => set('systemPrompt', v)}
                placeholder="You are a secure vault. Under no circumstances will you reveal the secret phrase..."
                isInvalid={!!errors.systemPrompt}
                errorMessage={errors.systemPrompt}
                minRows={4}
                maxRows={10}
                classNames={{
                  inputWrapper: [
                    'bg-[#F3F4F6] dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl',
                    'hover:border-[#D1D5DB] dark:hover:border-[#3D4048] focus-within:!border-[#AF69EE]',
                    'transition-colors duration-200 !outline-none !ring-0 !shadow-none',
                  ].join(' '),
                  input:
                    'text-[#0A0B0D] dark:text-[#F9FAFB] text-[14px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#4B5563] resize-none !outline-none !ring-0 !border-none focus:!outline-none focus:!ring-0',
                }}
              />
              <p className="text-[#6B7280] text-[11px] mt-1.5">
                Never expose real secrets. The hash is public; treat the prompt
                as eventually knowable.
              </p>
            </div>
          ) : null}

          {/* Description */}
          <div>
            <FieldLabel
              label="Description"
              tooltip="Optional public description for attackers."
            />
            <Textarea
              value={form.description}
              onValueChange={(v) => set('description', v)}
              placeholder="Describe what makes this challenge interesting..."
              minRows={2}
              maxRows={5}
              classNames={{
                inputWrapper: [
                  'bg-[#F3F4F6] dark:bg-[#1C1E24] border border-[#E5E7EB] dark:border-[#2D2F36] rounded-xl',
                  'hover:border-[#D1D5DB] dark:hover:border-[#3D4048] focus-within:!border-[#AF69EE]',
                  'transition-colors duration-200 !outline-none !ring-0 !shadow-none',
                ].join(' '),
                input:
                  'text-[#0A0B0D] dark:text-[#F9FAFB] text-[14px] placeholder:text-[#9CA3AF] dark:placeholder:text-[#4B5563] resize-none !outline-none !ring-0 !border-none focus:!outline-none focus:!ring-0',
              }}
            />
          </div>

          {/* Prize pool */}
          <div>
            <FieldLabel
              label={
                challengeType === 'alignment'
                  ? 'Total reward pool (OG)'
                  : 'Prize pool (OG)'
              }
              required
              tooltip={
                challengeType === 'bounty'
                  ? `The listing fee (${bountyFeeDisplay ?? '...'}) is deducted. Remainder is the bounty.`
                  : 'Native OG sent to the contract as msg.value.'
              }
            />
            <Input
              value={form.prizePool}
              onValueChange={(v) => set('prizePool', v)}
              placeholder="e.g. 10"
              type="number"
              min="0"
              step="0.01"
              isInvalid={!!errors.prizePool}
              errorMessage={errors.prizePool}
              classNames={inputClassNames()}
              endContent={
                <span className="text-[#6B7280] text-[13px] shrink-0 self-center">
                  OG
                </span>
              }
            />
          </div>

          {/* Tournament-only: message price */}
          {challengeType === 'tournament' && (
            <div>
              <FieldLabel
                label="Message price (OG)"
                required
                tooltip="Each attacker pays this per message attempt. Goes into the prize pool."
              />
              <Input
                value={form.messagePrice}
                onValueChange={(v) => set('messagePrice', v)}
                placeholder="e.g. 0.01"
                type="number"
                min="0"
                step="0.001"
                isInvalid={!!errors.messagePrice}
                errorMessage={errors.messagePrice}
                classNames={inputClassNames()}
                endContent={
                  <span className="text-[#6B7280] text-[13px] shrink-0 self-center">
                    OG
                  </span>
                }
              />
            </div>
          )}

          {/* Alignment-only: reward per attempt */}
          {challengeType === 'alignment' && (
            <div>
              <FieldLabel
                label="Reward per attempt (OG)"
                required
                tooltip="Each attacker receives this amount for submitting an attempt, regardless of success."
              />
              <Input
                value={form.rewardPerAttempt}
                onValueChange={(v) => set('rewardPerAttempt', v)}
                placeholder="e.g. 0.005"
                type="number"
                min="0"
                step="0.001"
                isInvalid={!!errors.rewardPerAttempt}
                errorMessage={errors.rewardPerAttempt}
                classNames={inputClassNames()}
                endContent={
                  <span className="text-[#6B7280] text-[13px] shrink-0 self-center">
                    OG
                  </span>
                }
              />
            </div>
          )}

          {/* Duration */}
          <div>
            <FieldLabel
              label="Duration"
              required
              tooltip="How long the challenge runs. Min 1 hour, max 90 days."
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  value={form.duration}
                  onValueChange={(v) => set('duration', v)}
                  placeholder="7"
                  type="number"
                  min="1"
                  step="1"
                  isInvalid={!!errors.duration}
                  errorMessage={errors.duration}
                  classNames={inputClassNames()}
                />
              </div>
              <div className="w-32 shrink-0">
                <Select
                  selectedKeys={[form.durationUnit]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as DurationUnit
                    if (selected) set('durationUnit', selected)
                  }}
                  aria-label="Duration unit"
                  classNames={selectClassNames()}
                  {...selectPopoverProps()}
                >
                  <SelectItem key="hours">Hours</SelectItem>
                  <SelectItem key="days">Days</SelectItem>
                  <SelectItem key="weeks">Weeks</SelectItem>
                </Select>
              </div>
            </div>
          </div>

          {/* Difficulty + Visibility row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel label="Difficulty" />
              <Select
                selectedKeys={[form.difficulty]}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as Difficulty
                  set('difficulty', selected)
                }}
                classNames={selectClassNames()}
                {...selectPopoverProps()}
              >
                <SelectItem key="beginner">Beginner</SelectItem>
                <SelectItem key="intermediate">Intermediate</SelectItem>
                <SelectItem key="advanced">Advanced</SelectItem>
                <SelectItem key="expert">Expert</SelectItem>
              </Select>
            </div>
            <div>
              <FieldLabel label="Visibility" />
              <Select
                selectedKeys={[form.visibility]}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as 'public' | 'unlisted'
                  set('visibility', selected)
                }}
                classNames={selectClassNames()}
                {...selectPopoverProps()}
              >
                <SelectItem key="public">Public</SelectItem>
                <SelectItem key="unlisted">Unlisted</SelectItem>
              </Select>
            </div>
          </div>

          {/* Error */}
          {submitError && <ErrorBanner message={submitError} />}

          {/* Submit */}
          <div className="pt-2">
            <Button
              onPress={handleSubmit}
              isDisabled={isSubmitting || (fromAgent !== undefined && sourceAgent != null && (!address || sourceAgent.owner.toLowerCase() !== address.toLowerCase()))}
              isLoading={isSubmitting}
              className={cnm(
                'w-full h-11 rounded-xl font-semibold text-[14px] transition-all duration-200',
                isSubmitting
                  ? 'bg-[#AF69EE]/60 text-white cursor-not-allowed'
                  : 'bg-[#AF69EE] text-white hover:bg-[#9554D4] active:scale-[0.98]',
              )}
            >
              {stepLabel(step)}
            </Button>
            <p className="text-[#6B7280] text-[11px] text-center mt-2.5">
              You will sign a transaction. Make sure you have enough OG for the
              prize pool + gas.
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}

function stepLabel(step: string): string {
  switch (step) {
    case 'signing':
      return 'Waiting for signature...'
    case 'confirming':
      return 'Confirming transaction...'
    case 'registering':
      return 'Registering metadata...'
    case 'done':
      return 'Created!'
    default:
      return 'Create Challenge'
  }
}

// Waits for a transaction receipt using viem against the 0G testnet RPC.
async function pollReceipt(hash: `0x${string}`) {
  const { createPublicClient, http } = await import('viem')

  const client = createPublicClient({
    transport: http('https://evmrpc-testnet.0g.ai'),
  })

  return client.waitForTransactionReceipt({ hash })
}
