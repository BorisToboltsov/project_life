import { Link } from '@tanstack/react-router'
import { Plus } from 'lucide-react'

import { cn } from '@/lib/utils'

/** Пунктирная кнопка «+»: ведёт к экрану, где в список добавляют вид замера. */
export function AddMetricLink({ label, className }: { label: string; className?: string }) {
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
