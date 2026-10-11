/** Штрихкоды товаров, которые понимает каталог (ADR 0009): EAN-13, EAN-8 и UPC-A. */
const FORMATS = ['ean_13', 'ean_8', 'upc_a'] as const

export interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>
}

interface NativeBarcodeDetector {
  new (options: { formats: string[] }): Detector
  getSupportedFormats(): Promise<string[]>
}

/** Распознавание, встроенное в браузер: есть в Chrome на Android, в Safari его нет. */
async function builtIn(): Promise<Detector | null> {
  const Native = (globalThis as { BarcodeDetector?: NativeBarcodeDetector }).BarcodeDetector
  if (!Native) return null
  try {
    const supported = await Native.getSupportedFormats()
    return FORMATS.every((format) => supported.includes(format))
      ? new Native({ formats: [...FORMATS] })
      : null
  } catch {
    return null
  }
}

/** То же на zxing-wasm; подгружается, только когда нужен. */
async function polyfill(): Promise<Detector> {
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasm }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url'),
  ])
  // Без этого модуль WebAssembly скачивался бы со стороннего CDN: политика CSP такого не
  // пропустит, и за пределы своего адреса приложение не ходит.
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasm : prefix + path),
    },
  })
  return new BarcodeDetector({ formats: [...FORMATS] })
}

/** Распознаватель штрихкодов: встроенный в браузер, а где его нет или он не работает — свой. */
export async function createDetector(): Promise<Detector> {
  const native = await builtIn()
  if (!native) return polyfill()
  let active = native
  return {
    async detect(source) {
      try {
        return await active.detect(source)
      } catch (error) {
        if (active !== native) throw error
        // Браузер объявил распознавание, но оно не работает: на Android так бывает, пока
        // не скачан модуль сервисов Google.
        active = await polyfill()
        return active.detect(source)
      }
    },
  }
}
