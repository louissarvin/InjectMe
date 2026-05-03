import { cnm } from '@/utils/style'

type Status = 'active' | 'resolved' | 'expired' | 'cancelled'

interface StatusBadgeProps {
  status: Status
  className?: string
}

const STATUS_CONFIG: Record<Status, { label: string; classes: string }> = {
  active: {
    label: 'Active',
    classes:
      'bg-[rgba(9,133,81,0.10)] text-[#098551] border border-[rgba(9,133,81,0.20)]',
  },
  resolved: {
    label: 'Resolved',
    classes:
      'bg-[rgba(175,105,238,0.10)] text-[#AF69EE] border border-[rgba(175,105,238,0.20)]',
  },
  expired: {
    label: 'Expired',
    classes:
      'bg-[rgba(237,112,47,0.10)] text-[#ED702F] border border-[rgba(237,112,47,0.20)]',
  },
  cancelled: {
    label: 'Cancelled',
    classes:
      'bg-[rgba(207,32,47,0.10)] text-[#CF202F] border border-[rgba(207,32,47,0.20)]',
  },
}

export default function StatusBadge({ status, className }: StatusBadgeProps) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className={cnm(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-[12px] font-semibold tracking-[0.5px] uppercase',
        cfg.classes,
        className,
      )}
    >
      {status === 'active' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#098551] animate-pulse-dot mr-1.5 shrink-0" />
      )}
      {cfg.label}
    </span>
  )
}
