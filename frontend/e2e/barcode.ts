import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Штрихкод EAN-13 из первых двенадцати цифр: тринадцатая — контрольная. */
export function ean13(body: string): string {
  const weighted = [...body].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  )
  return `${body}${(10 - (weighted % 10)) % 10}`
}

/**
 * Свежий штрихкод с заданным началом. Подменный Open Food Facts стенда отвечает по началу
 * штрихкода (deploy/stand/off/Caddyfile), а каталог стенда общий для всех прогонов —
 * поэтому остальные цифры у каждого прогона свои.
 */
export function freshBarcode(prefix: string): string {
  const random = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
  return ean13(`${prefix}${random}`)
}

/** Что «видит» камера браузера в прогоне: штрихкод продукта с полным составом. */
export const CAMERA_BARCODE = ean13('460100000001')

// Кодирование цифр EAN-13: левая половина — наборами L и G, правая — набором R.
const L = ['0001101', '0011001', '0010011', '0111101', '0100011']
  .concat(['0110001', '0101111', '0111011', '0110111', '0001011'])
  .map((bits) => [...bits].map(Number))
const R = L.map((bits) => bits.map((bit) => 1 - bit))
const G = R.map((bits) => bits.toReversed())
// Какими наборами закодированы шесть цифр левой половины — задаёт первая цифра штрихкода.
const LEFT_SETS = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG'].concat([
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
])

/** Штрихи EAN-13 слева направо: 1 — чёрный модуль, 0 — белый; всего 95. */
function bars(barcode: string): number[] {
  const digits = [...barcode].map(Number)
  const sets = LEFT_SETS[digits[0]]
  const left = digits.slice(1, 7).flatMap((digit, index) => (sets[index] === 'L' ? L : G)[digit])
  const right = digits.slice(7).flatMap((digit) => R[digit])
  return [1, 0, 1, ...left, 0, 1, 0, 1, 0, ...right, 1, 0, 1]
}

/**
 * Пишет видеофайл, который Chromium показывает странице вместо камеры: неподвижный кадр со
 * штрихкодом на белом фоне. Формат Y4M — несжатые кадры YUV 4:2:0, собрать его можно без
 * библиотек.
 */
export function writeCameraVideo(barcode: string, file: string): void {
  const [width, height, module, frames] = [640, 480, 5, 10]
  const [white, black, grey] = [235, 16, 128]
  const modules = bars(barcode)
  const left = Math.floor((width - modules.length * module) / 2)
  const [top, bottom] = [140, 340]

  const luma = Buffer.alloc(width * height, white)
  for (let y = top; y < bottom; y++) {
    for (const [index, bar] of modules.entries()) {
      if (bar)
        luma.fill(black, y * width + left + index * module, y * width + left + (index + 1) * module)
    }
  }
  const frame = Buffer.concat([
    Buffer.from('FRAME\n'),
    luma,
    // Цветовые плоскости — нейтральный серый: кадр чёрно-белый.
    Buffer.alloc((width * height) / 2, grey),
  ])
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${width} H${height} F10:1 Ip A1:1 C420jpeg\n`),
      ...Array.from({ length: frames }, () => frame),
    ]),
  )
}
