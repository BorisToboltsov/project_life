import { Link } from '@tanstack/react-router'
import { CloudOff, RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { useOfflineState } from '@/offline/store'

/**
 * Полоса вверху экрана: связи нет, изменения уходят или сервер что-то не принял (ADR 0020).
 * При связи и пустой очереди её нет. Нажатие открывает экран «Не отправлено».
 */
export function OfflineBar() {
  const { t } = useTranslation()
  const { online, sending, queued, rejected } = useOfflineState()

  let text: string
  let Icon = CloudOff
  let alarm = false
  if (!online) {
    text = queued > 0 ? t('offlineBar.offlineQueued', { count: queued }) : t('offlineBar.offline')
  } else if (sending || queued > 0) {
    text = t('offlineBar.sending', { count: queued })
    Icon = RefreshCw
  } else if (rejected.length > 0) {
    text = t('offlineBar.rejected', { count: rejected.length })
    Icon = TriangleAlert
    alarm = true
  } else {
    return null
  }

  return (
    <div
      role="status"
      className={cn(
        'sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)] text-sm',
        alarm ? 'bg-destructive/10 text-destructive' : 'bg-warning text-warning-foreground',
      )}
    >
      <Link to="/unsent" className="flex items-center justify-center gap-2 px-4 py-2">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span>{text}</span>
      </Link>
    </div>
  )
}
