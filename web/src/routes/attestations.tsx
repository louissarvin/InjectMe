import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { Button, Input, Skeleton } from '@heroui/react'
import {
  CheckCircle2,
  ExternalLink,
  Search,
  ShieldCheck,
  ShieldX,
  XCircle,
} from 'lucide-react'
import GlassCard from '@/components/GlassCard'
import { useVerifyAttestation, useVerifyProof } from '@/lib/api/hooks'
import { cnm } from '@/utils/style'

export const Route = createFileRoute('/attestations')({
  component: AttestationsPage,
})

function DataRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wider">
        {label}
      </p>
      <div className="text-[14px] text-[#0A0B0D] dark:text-[#F9FAFB]">
        {children}
      </div>
    </div>
  )
}

function StatusIndicator({
  verified,
  label,
  description,
}: {
  verified: boolean
  label: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 shrink-0">
        {verified ? (
          <CheckCircle2 size={16} className="text-[#16A34A]" />
        ) : (
          <XCircle size={16} className="text-[#DC2626]" />
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="text-[14px] font-medium text-[#0A0B0D] dark:text-[#F9FAFB]">
          {label}
        </p>
        {description && (
          <p className="text-[12px] text-[#6B7280] dark:text-[#9CA3AF]">
            {description}
          </p>
        )}
      </div>
      <div className="ml-auto shrink-0">
        <span
          className={cnm(
            'inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold border',
            verified
              ? 'text-[#16A34A] bg-[#F0FDF4] border-[#BBF7D0] dark:bg-[#052E16] dark:border-[#166534]/40'
              : 'text-[#DC2626] bg-[#FEF2F2] border-[#FECACA] dark:bg-[#2D0A0A] dark:border-[#7F1D1D]/40',
          )}
        >
          {verified ? 'Verified' : 'Unverified'}
        </span>
      </div>
    </div>
  )
}

function VerificationResult({ chatID }: { chatID: string }) {
  const {
    data: attestation,
    isLoading: attestationLoading,
    isError: attestationError,
    error: attestationErr,
  } = useVerifyAttestation(chatID)

  const {
    data: proof,
    isLoading: proofLoading,
    isError: proofError,
  } = useVerifyProof(chatID)

  if (attestationLoading) {
    return (
      <GlassCard className="flex flex-col gap-4">
        <Skeleton className="h-4 w-48 rounded-lg bg-[#F3F4F6] dark:bg-[#1C1E24]" />
        <Skeleton className="h-4 w-full rounded-lg bg-[#F3F4F6] dark:bg-[#1C1E24]" />
        <Skeleton className="h-4 w-3/4 rounded-lg bg-[#F3F4F6] dark:bg-[#1C1E24]" />
        <Skeleton className="h-4 w-2/3 rounded-lg bg-[#F3F4F6] dark:bg-[#1C1E24]" />
      </GlassCard>
    )
  }

  if (attestationError) {
    return (
      <GlassCard>
        <p className="text-[#CF202F] text-[14px]">
          {attestationErr instanceof Error
            ? attestationErr.message
            : 'Attestation not found. Check the Chat ID and try again.'}
        </p>
      </GlassCard>
    )
  }

  if (!attestation) return null

  const isSuccess = attestation.judgment === 'SUCCESS'
  const timestamp = attestation.timestamp
    ? new Date(attestation.timestamp).toLocaleString()
    : '—'
  const shortAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`

  return (
    <div className="flex flex-col gap-4">
      {/* Judgment header */}
      <GlassCard
        variant={isSuccess ? 'accent' : 'standard'}
        className="flex flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          {isSuccess ? (
            <ShieldCheck size={28} className="text-[#16A34A] shrink-0" />
          ) : (
            <ShieldX size={28} className="text-[#DC2626] shrink-0" />
          )}
          <div>
            <p className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wider mb-0.5">
              Judgment
            </p>
            <p
              className={cnm(
                'text-[20px] font-semibold tracking-[-0.01em]',
                isSuccess ? 'text-[#16A34A]' : 'text-[#DC2626]',
              )}
            >
              {attestation.judgment}
            </p>
          </div>
          <div className="ml-auto">
            <p className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wider mb-0.5 text-right">
              OWASP Category
            </p>
            <p className="text-[14px] font-medium text-[#0A0B0D] dark:text-[#F9FAFB] text-right">
              {attestation.owaspCategory || '—'}
            </p>
          </div>
        </div>
      </GlassCard>

      {/* TEE verification statuses */}
      <GlassCard className="flex flex-col gap-4">
        <p className="text-[13px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB]">
          Verification Status
        </p>

        <div className="flex flex-col gap-4">
          <StatusIndicator
            verified={attestation.teeVerified}
            label="TEE Verified"
            description="Inference was executed inside a Trusted Execution Environment on 0G Compute"
          />
          <div className="border-t border-black/[0.06] dark:border-white/[0.06]" />
          <StatusIndicator
            verified={attestation.liveVerification}
            label="Live Verification"
            description="Real-time re-check against the 0G Compute attestation registry"
          />
          <div className="border-t border-black/[0.06] dark:border-white/[0.06]" />
          {proofLoading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-4 rounded-full bg-[#F3F4F6] dark:bg-[#1C1E24] shrink-0" />
              <Skeleton className="h-4 w-48 rounded-lg bg-[#F3F4F6] dark:bg-[#1C1E24]" />
            </div>
          ) : proofError || !proof ? (
            <StatusIndicator
              verified={false}
              label="Storage Proof"
              description="0G Storage archival proof could not be fetched"
            />
          ) : (
            <StatusIndicator
              verified={proof.storageVerified}
              label="Storage Proof"
              description="Data integrity verified against 0G Storage root hash"
            />
          )}
        </div>
      </GlassCard>

      {/* Metadata */}
      <GlassCard className="grid grid-cols-2 gap-x-6 gap-y-5">
        <DataRow label="Chat ID">
          <span className="font-mono text-[12px] break-all">
            {attestation.chatID}
          </span>
        </DataRow>
        <DataRow label="Timestamp">
          <span className="text-[13px]">{timestamp}</span>
        </DataRow>
        <DataRow label="Challenge">
          {attestation.challengeAddress ? (
            <Link
              to="/challenges/$id"
              params={{ id: attestation.challengeAddress }}
              className="font-mono text-[12px] text-[#AF69EE] hover:underline inline-flex items-center gap-1"
            >
              {shortAddress(attestation.challengeAddress)}
              <ExternalLink size={11} />
            </Link>
          ) : (
            <span className="text-[#9CA3AF]">—</span>
          )}
        </DataRow>
        <DataRow label="Attacker">
          <span className="font-mono text-[12px] text-[#4B5563] dark:text-[#D1D5DB]">
            {attestation.attacker ? shortAddress(attestation.attacker) : '—'}
          </span>
        </DataRow>
        {proof && !proofLoading && !proofError && proof.storageRoot && (
          <>
            <div className="col-span-2 border-t border-black/[0.06] dark:border-white/[0.06]" />
            <div className="col-span-2">
              <DataRow label="Storage Root Hash">
                <span className="font-mono text-[12px] break-all text-[#4B5563] dark:text-[#D1D5DB]">
                  {proof.storageRoot}
                </span>
              </DataRow>
            </div>
          </>
        )}
      </GlassCard>
    </div>
  )
}

function TeeExplainer() {
  const steps = [
    {
      number: '01',
      title: 'Sealed Inference',
      body: 'Each AI inference runs inside a hardware-sealed TEE on 0G Compute nodes. The model weights and system prompt are loaded into encrypted memory that the host operator cannot read or modify.',
    },
    {
      number: '02',
      title: 'Remote Attestation',
      body: 'After inference, the TEE generates a cryptographic attestation report signed by the CPU hardware. This report binds the exact code hash, input, and output to the hardware environment.',
    },
    {
      number: '03',
      title: 'Storage Archival',
      body: 'The judgment, conversation hash, and attestation proof are stored on 0G Storage. A Merkle root hash anchors the full record, making any post-hoc tampering detectable.',
    },
    {
      number: '04',
      title: 'Live Re-verification',
      body: 'At query time, the backend re-checks the attestation against the 0G Compute attestation registry. If the hardware certificate has been revoked or the record altered, live verification fails.',
    },
  ]

  return (
    <GlassCard className="flex flex-col gap-6">
      <div>
        <p className="text-[13px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] mb-1">
          How TEE Verification Works
        </p>
        <p className="text-[13px] text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed">
          InjectMe runs all AI inference inside 0G Compute Trusted Execution
          Environments. Every judgment is cryptographically attested by the
          hardware, not just signed by a server key.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {steps.map((step) => (
          <div
            key={step.number}
            className="flex flex-col gap-2 p-4 rounded-2xl bg-[#F9FAFB] dark:bg-[#0A0B0D] border border-black/[0.06] dark:border-[#2D2F36]"
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-[#AF69EE] tabular-nums">
                {step.number}
              </span>
              <span className="text-[13px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB]">
                {step.title}
              </span>
            </div>
            <p className="text-[12px] text-[#6B7280] dark:text-[#9CA3AF] leading-relaxed">
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}

function AttestationsPage() {
  const [inputValue, setInputValue] = useState('')
  const [activeChatID, setActiveChatID] = useState('')

  function handleVerify() {
    const trimmed = inputValue.trim()
    if (!trimmed) return
    setActiveChatID(trimmed)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleVerify()
  }

  return (
    <div className="min-h-screen bg-white dark:bg-[#0A0B0D] px-6 md:px-10 py-12">
      <div className="max-w-[980px] mx-auto flex flex-col gap-12">
        {/* Header */}
        <div>
          <h1 className="text-[40px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.02em] leading-[1.1] mb-3">
            TEE Attestation Verifier
          </h1>
          <p className="text-[#4B5563] dark:text-[#9CA3AF] text-[17px] leading-relaxed">
            Every InjectMe judgment is produced inside a hardware Trusted
            Execution Environment on 0G Compute and archived on 0G Storage.
            Enter a Chat ID to verify the cryptographic proof of inference.
          </p>
        </div>

        {/* Search */}
        <section className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Input
              value={inputValue}
              onValueChange={setInputValue}
              onKeyDown={handleKeyDown}
              placeholder="Enter Chat ID"
              classNames={{
                base: 'flex-1',
                inputWrapper:
                  'bg-white dark:bg-[#141518] border border-black/[0.08] dark:border-[#2D2F36] shadow-none rounded-xl h-11 data-[hover=true]:border-[#AF69EE]/30 data-[focus=true]:border-[#AF69EE]',
                input:
                  'text-[14px] font-mono text-[#0A0B0D] dark:text-[#F9FAFB] placeholder:text-[#9CA3AF] dark:placeholder:text-[#6B7280]',
              }}
              startContent={
                <Search size={14} className="text-[#9CA3AF] shrink-0" />
              }
              variant="bordered"
            />
            <Button
              onPress={handleVerify}
              isDisabled={!inputValue.trim()}
              className="bg-[#AF69EE] text-white text-[14px] font-medium rounded-xl h-11 px-5 shrink-0 disabled:opacity-40"
            >
              Verify
            </Button>
          </div>
          <p className="text-[12px] text-[#9CA3AF] dark:text-[#6B7280]">
            Chat IDs are returned when you submit an attack on any challenge.
          </p>
        </section>

        {/* Results */}
        {activeChatID && (
          <section className="flex flex-col gap-4">
            <h2 className="text-[16px] font-semibold text-[#0A0B0D] dark:text-[#F9FAFB] tracking-[-0.01em]">
              Verification Result
            </h2>
            <VerificationResult chatID={activeChatID} />
          </section>
        )}

        {/* Explainer */}
        <section className="flex flex-col gap-4">
          <TeeExplainer />
        </section>
      </div>
    </div>
  )
}
