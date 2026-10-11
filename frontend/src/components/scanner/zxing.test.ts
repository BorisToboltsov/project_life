import {
  ZXING_WASM_SHA256 as expected,
  ZXING_WASM_VERSION as polyfill,
} from 'barcode-detector/ponyfill'
import { describe, expect, it } from 'vitest'
import { ZXING_WASM_SHA256 as served, ZXING_WASM_VERSION as own } from 'zxing-wasm/reader'

// Полифилл `barcode-detector` несёт свой код zxing-wasm, а модуль WebAssembly для него
// приложение раздаёт из собственной зависимости `zxing-wasm` (см. detector.ts). Обновить
// один пакет без другого — значит дать коду чужой модуль: сканер на iPhone сломается молча.
describe('zxing-wasm', () => {
  it('модуль WebAssembly, который раздаёт приложение, — тот, которого ждёт полифилл', () => {
    expect(own).toBe(polyfill)
    expect(served).toBe(expected)
  })
})
