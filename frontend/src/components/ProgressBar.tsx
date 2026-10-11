import { cn } from '@/lib/utils'

/** Шкала «съедено из цели». `value` — доля от 0 до 1; `over` — цель превышена. */
export function ProgressBar({
  label,
  value,
  over = false,
}: {
  label: string
  value: number
  over?: boolean
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn('h-full rounded-full', over ? 'bg-destructive' : 'bg-(--brand)')}
        style={{ width: `${value * 100}%` }}
      />
    </div>
  )
}
