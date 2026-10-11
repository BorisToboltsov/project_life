import { afterEach, describe, expect, it, vi } from 'vitest'

import { createDetector } from './detector'

const prepareZXingModule = vi.fn<(options: Overrides) => void>()
const polyfillDetect = vi.fn<Detect>(async () => [{ rawValue: 'из полифилла' }])
const polyfillFormats = vi.fn<(formats: string[]) => void>()

vi.mock('barcode-detector/ponyfill', () => ({
  prepareZXingModule,
  BarcodeDetector: class {
    constructor(options: { formats: string[] }) {
      polyfillFormats(options.formats)
    }
    detect = polyfillDetect
  },
}))

type Detect = (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>
interface Overrides {
  overrides: { locateFile: (path: string, prefix: string) => string }
}

const video = document.createElement('video')
const FORMATS = ['ean_13', 'ean_8', 'upc_a']

/** Подменяет распознавание, встроенное в браузер. */
function stubNative(supported: string[] | Error, detect = vi.fn<Detect>(async () => [])) {
  const created = vi.fn<(formats: string[]) => void>()
  vi.stubGlobal(
    'BarcodeDetector',
    class {
      static getSupportedFormats = async () => {
        if (supported instanceof Error) throw supported
        return supported
      }
      constructor(options: { formats: string[] }) {
        created(options.formats)
      }
      detect = detect
    },
  )
  return { created, detect }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('распознаватель штрихкодов', () => {
  it('берёт встроенный в браузер и просит только штрихкоды товаров', async () => {
    const native = stubNative(['qr_code', ...FORMATS])
    native.detect.mockResolvedValue([{ rawValue: '4600000000008' }])

    const detector = await createDetector()

    expect(await detector.detect(video)).toEqual([{ rawValue: '4600000000008' }])
    expect(native.created).toHaveBeenCalledWith(FORMATS)
    expect(polyfillFormats).not.toHaveBeenCalled()
  })

  it.each([
    ['в браузере распознавания нет', undefined],
    ['встроенное не знает штрихкодов товаров', ['qr_code', 'ean_13']],
    ['встроенное не отвечает', new Error('service unavailable')],
  ])('%s — подгружает zxing-wasm со своего адреса', async (_name, supported) => {
    if (supported) stubNative(supported)

    const detector = await createDetector()

    expect(await detector.detect(video)).toEqual([{ rawValue: 'из полифилла' }])
    expect(polyfillFormats).toHaveBeenCalledWith(FORMATS)
    // Модуль WebAssembly — файл своей сборки, а не сторонний CDN.
    const { locateFile } = prepareZXingModule.mock.calls[0][0].overrides
    expect(locateFile('zxing_reader.wasm', 'https://cdn.example/')).toMatch(
      /^\/.*zxing_reader.*\.wasm$/,
    )
    expect(locateFile('other.js', '/assets/')).toBe('/assets/other.js')
  })

  it('встроенное объявлено, но падает на кадре — дальше работает полифилл', async () => {
    const native = stubNative(FORMATS, vi.fn<Detect>().mockRejectedValue(new Error('not ready')))

    const detector = await createDetector()

    expect(await detector.detect(video)).toEqual([{ rawValue: 'из полифилла' }])
    await detector.detect(video)
    // Встроенное спросили один раз; полифилл остался.
    expect(native.detect).toHaveBeenCalledTimes(1)
    expect(polyfillDetect).toHaveBeenCalledTimes(2)
  })

  it('сбой самого полифилла не прячется', async () => {
    stubNative(FORMATS, vi.fn<Detect>().mockRejectedValue(new Error('not ready')))
    const detector = await createDetector()
    await detector.detect(video)
    polyfillDetect.mockRejectedValueOnce(new Error('bad frame'))

    await expect(detector.detect(video)).rejects.toThrow('bad frame')
  })
})
