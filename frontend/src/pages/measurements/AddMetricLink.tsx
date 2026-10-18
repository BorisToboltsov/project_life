import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useOfflineState } from '@/offline/store'

/**
 * Пунктирная кнопка «+»: ведёт к экрану, где в список добавляют вид замера. Виды замеров
 * заводятся только при связи — без неё кнопки нет (ADR 0020).
 */
export function AddMetricLink({ label, className }: { label: string; className?: string }) {
  const { online } = useOfflineState()
  if (!online) return null
  return (
    <Link
      to="/measurements/metrics/new"
      className={cn(
        'flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-muted-foreground/50 p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50',
        className,
      )}
    >
      <Plus aria-hidden="true" className="size-5" />
      {label}
    </Link>
  )
}
