import { Link } from '@tanstack/react-router'
import { CloudOff, RefreshCw, ScanBarcode, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'
import { useOfflineState } from '@/offline/store'

/**
 * Полоса вверху экрана (ADR 0020): связи нет, изменения уходят, сервер что-то не принял,
 * штрихкод не нашёлся или найденный продукт ждёт согласия. При связи и пустой очереди её
 * нет. Нажатие открывает экран «Не отправлено», а предложение — день, где оно стоит.
 */
export function OfflineBar() {
  const { t } = useTranslation()
  const { online, sending, queued, rejected, deferred } = useOfflineState()
  const waiting = deferred.filter((item) => item.status === 'waiting').length
  const missing = deferred.filter((item) => item.status === 'missing').length
  const offers = deferred.filter((item) => item.status === 'found')

  let text: string
  let Icon = CloudOff
  let tone: 'warning' | 'alarm' | 'offer' = 'warning'
  // Куда ведёт полоса: экран «Не отправлено» или день с первым предложением.
  let offerDay: string | undefined
  const unsent = queued + waiting
  if (!online) {
    text = unsent > 0 ? t('offlineBar.offlineQueued', { count: unsent }) : t('offlineBar.offline')
  } else if (sending || queued > 0) {
    text = t('offlineBar.sending', { count: queued })
    Icon = RefreshCw
  } else if (rejected.length + missing > 0) {
    text =
      rejected.length > 0
        ? t('offlineBar.rejected', { count: rejected.length })
        : t('offlineBar.missing', { count: missing })
    Icon = TriangleAlert
    tone = 'alarm'
  } else if (offers.length > 0) {
    text = t('offlineBar.offers', { count: offers.length })
    Icon = ScanBarcode
    tone = 'offer'
    offerDay = offers[0]!.localDate
  } else {
    return null
  }

  const inside = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </>
  )
  const linkClass = 'flex items-center justify-center gap-2 px-4 py-2'
  return (
    <div
      role="status"
      className={cn(
        'sticky top-0 z-20 border-b pt-[env(safe-area-inset-top)] text-sm',
        tone === 'alarm' && 'bg-destructive/10 text-destructive',
        tone === 'warning' && 'bg-warning text-warning-foreground',
        tone === 'offer' && 'bg-muted text-foreground',
      )}
    >
      {offerDay ? (
        <Link to="/diary/$date" params={{ date: offerDay }} className={linkClass}>
          {inside}
        </Link>
      ) : (
        <Link to="/unsent" className={linkClass}>
          {inside}
        </Link>
      )}
    </div>
  )
}
