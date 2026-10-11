import { normalizeBarcode } from '@/lib/barcode'

import { createDetector } from './detector'

/**
 * Что происходит со сканером: камера включается, идёт распознавание, пользователь не дал
 * доступ к камере, сканировать нечем (нет камеры или распознавателя).
 */
export type ScannerState = 'starting' | 'scanning' | 'denied' | 'unavailable'

/** Пауза между попытками распознать кадр, мс. */
const INTERVAL = 150
/** В кадре есть картинка: раньше распознавать нечего. */
const HAVE_CURRENT_DATA = 2

function isDenied(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' || error.name === 'SecurityError')
  )
}

/**
 * Включает камеру, показывает её в `video` и ищет в кадре штрихкод товара. Первый
 * найденный отдаёт в `onDetected` и выключает камеру. Возвращает функцию остановки: после
 * неё камера выключена, что бы ни успело произойти.
 */
export function startScanner(
  video: HTMLVideoElement,
  onState: (state: ScannerState) => void,
  onDetected: (barcode: string) => void,
): () => void {
  let stopped = false
  let stream: MediaStream | undefined
  let timer: ReturnType<typeof setTimeout> | undefined

  function stop() {
    stopped = true
    clearTimeout(timer)
    for (const track of stream?.getTracks() ?? []) track.stop()
    video.srcObject = null
  }

  async function openCamera(): Promise<MediaStream> {
    const camera = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // Камера на задней стороне телефона; разрешения хватает, чтобы разобрать штрихи.
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    })
    stream = camera
    // Сканер закрыли, пока браузер спрашивал разрешение: выключаем то, что включилось.
    if (stopped) stop()
    return camera
  }

  async function run() {
    const [camera, detector] = await Promise.all([openCamera(), createDetector()])
    if (stopped) return
    video.srcObject = camera
    await video.play()
    onState('scanning')

    async function look() {
      if (stopped) return
      if (video.readyState >= HAVE_CURRENT_DATA) {
        // Кадр, который не удалось разобрать, — не повод останавливаться: придёт следующий.
        const found = await detector.detect(video).catch(() => [])
        const barcode = found
          .map(({ rawValue }) => normalizeBarcode(rawValue))
          .find((code) => code !== null)
        if (stopped) return
        if (barcode) {
          stop()
          onDetected(barcode)
          return
        }
      }
      timer = setTimeout(() => void look(), INTERVAL)
    }
    await look()
  }

  run().catch((error: unknown) => {
    const wasStopped = stopped
    stop()
    if (!wasStopped) onState(isDenied(error) ? 'denied' : 'unavailable')
  })
  return stop
}
