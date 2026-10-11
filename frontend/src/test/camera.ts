import { type Mock, vi } from 'vitest'

/** Возвращает `navigator` к тому, что есть в jsdom: камеры в нём нет. */
export function removeCamera(): void {
  delete (navigator as { mediaDevices?: unknown }).mediaDevices
}

/**
 * Подменяет камеру и распознавание штрихкодов: в jsdom нет ни того, ни другого. Что
 * «видит» камера, задаёт тест через `show`; `tracks` — дорожки всех включённых потоков, по
 * ним видно, выключена ли камера. `access`: `absent` — браузер не даёт странице камеру
 * вовсе, исключение — отказ на запрос доступа.
 */
export function stubCamera(access: 'granted' | 'absent' | DOMException = 'granted') {
  let inFrame: string[] = []
  const tracks: { stop: Mock<() => void> }[] = []
  const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<unknown>>(
    async () => {
      if (access instanceof DOMException) throw access
      const track = { stop: vi.fn<() => void>() }
      tracks.push(track)
      return { getTracks: () => [track] }
    },
  )
  if (access !== 'absent') {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
  }
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      static getSupportedFormats = async () => ['ean_13', 'ean_8', 'upc_a']
      detect = async () => inFrame.map((rawValue) => ({ rawValue }))
    },
  )
  // jsdom не проигрывает видео: кадр считается готовым сразу.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
  return {
    getUserMedia,
    tracks,
    /** Что попало в кадр: тексты кодов, как их прочёл бы распознаватель. */
    show(...codes: string[]) {
      inFrame = codes
    },
    isOff: () => tracks.length > 0 && tracks.every((track) => track.stop.mock.calls.length > 0),
  }
}
