import { useEffect, useState } from 'react'
import { cnm } from '@/utils/style'

interface CountdownTimerProps {
  endTime: number // unix timestamp in seconds
  className?: string
}

interface TimeLeft {
  days: number
  hours: number
  minutes: number
  seconds: number
  expired: boolean
}

function calcTimeLeft(endTime: number): TimeLeft {
  const diff = endTime - Math.floor(Date.now() / 1000)
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true }
  }
  return {
    days: Math.floor(diff / 86400),
    hours: Math.floor((diff % 86400) / 3600),
    minutes: Math.floor((diff % 3600) / 60),
    seconds: diff % 60,
    expired: false,
  }
}

export default function CountdownTimer({
  endTime,
  className,
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() =>
    calcTimeLeft(endTime),
  )

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(calcTimeLeft(endTime))
    }, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  if (timeLeft.expired) {
    return (
      <span className={cnm('text-[#9CA3AF] text-sm font-semibold', className)}>
        Expired
      </span>
    )
  }

  const isUrgent = timeLeft.days === 0 && timeLeft.hours < 1
  const pad = (n: number) => String(n).padStart(2, '0')

  // For long durations (7+ days), show a friendlier format
  if (timeLeft.days >= 7) {
    return (
      <span
        className={cnm(
          'text-sm font-semibold',
          'text-[#0A0B0D] dark:text-[#F9FAFB]',
          className,
        )}
      >
        {timeLeft.days}d {timeLeft.hours}h
      </span>
    )
  }

  return (
    <span
      className={cnm(
        'font-mono text-sm font-semibold tabular-nums',
        isUrgent ? 'text-[#CF202F]' : 'text-[#0A0B0D] dark:text-[#F9FAFB]',
        className,
      )}
    >
      {timeLeft.days > 0 && <span>{timeLeft.days}d </span>}
      {pad(timeLeft.hours)}:{pad(timeLeft.minutes)}:{pad(timeLeft.seconds)}
    </span>
  )
}
