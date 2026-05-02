import { cnm } from '@/utils/style'

interface CardProps {
  variant?: 'standard' | 'accent' | 'subtle'
  hover?: boolean
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
  onClick?: () => void
}

export default function GlassCard({
  variant = 'standard',
  hover = false,
  className,
  style,
  children,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={style}
      className={cnm(
        'rounded-[20px] p-6',
        variant === 'standard' && [
          'bg-[#FDFDFF] dark:bg-[#141518] border border-black/[0.08] dark:border-[#2D2F36]',
          'shadow-[0_2px_8px_rgba(175,105,238,0.04),0_1px_3px_rgba(0,0,0,0.06)] dark:shadow-none',
        ],
        variant === 'accent' && [
          'bg-[#F8F3FF] dark:bg-[#160A28] border border-[rgba(175,105,238,0.15)] dark:border-[rgba(175,105,238,0.25)]',
        ],
        variant === 'subtle' && [
          'bg-[#F9FAFB] dark:bg-[#141518] border border-black/[0.06] dark:border-[#2D2F36] rounded-2xl',
        ],
        hover && [
          'transition-all duration-300 cursor-pointer',
          'shadow-[0_6px_16px_rgba(175,105,238,0.04)]',
          'hover:shadow-[0_20px_40px_rgba(175,105,238,0.08)]',
          'hover:-translate-y-2',
          '[transition-timing-function:cubic-bezier(.165,.84,.44,1)]',
        ],
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {children}
    </div>
  )
}
