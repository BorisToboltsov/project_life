import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type ScannerState, startScanner } from './scanner'

/** Приложение на экране, а не свёрнуто и не в фоновой вкладке. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

/**
 * Сканер штрихкода: показывает камеру и отдаёт первый распознанный штрихкод товара в
 * `onDetected`. Камера работает, только пока сканер на экране: она выключается, когда код
 * распознан, сканер убран или приложение свёрнуто (ADR 0009).
 */
export function BarcodeScanner({ onDetected }: { onDetected: (barcode: string) => void }) {
  const { t } = useTranslation()
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<ScannerState>('starting')
  const visible = useVisible()
  const detected = useEffectEvent(onDetected)

  useEffect(() => {
    if (!visible || !video.current) return
    setState('starting')
    return startScanner(video.current, setState, detected)
  }, [visible])

  const working = state === 'starting' || state === 'scanning'
  return (
    <div className="grid gap-2">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-black" hidden={!working}>
        <video
          ref={video}
          aria-label={t('scan.camera')}
          className="size-full object-cover"
          playsInline
          muted
        />
        {/* Рамка подсказывает, куда навести штрихкод; распознаётся он в любом месте кадра. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[12%] top-1/2 h-1/3 -translate-y-1/2 rounded-lg border-2 border-white/80"
        />
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {t(`scannerStates.${state}`)}
      </p>
    </div>
  )
}
