import type { Schemas } from '@/api/client'

export type FrameMetadata = Schemas['ViewerFrame']
export type WindowLevel = { width: number; center: number }
export type FrameDisplay = WindowLevel & { min: number; max: number; orientation: string[] }

/** Direction at each edge of the unrotated DICOM image (LPS coordinates). */
export function orientationLabels(orientation: number[] | null): string[] {
  if (!orientation || orientation.length !== 6) return ['', '', '', '']
  const label = (vector: number[]) =>
    vector
      .map((value, axis) => ({ value, axis }))
      .filter(({ value }) => Math.abs(value) > 0.001)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .map(({ value, axis }) => (value > 0 ? ['L', 'P', 'H'] : ['R', 'A', 'F'])[axis])
      .join('')
  const row = orientation.slice(0, 3),
    column = orientation.slice(3)
  return [label(column.map((v) => -v)), label(row), label(column), label(row.map((v) => -v))]
}

export function pixelsFrom(buffer: ArrayBuffer, metadata: FrameMetadata) {
  if (
    buffer.byteLength !== metadata.rows * metadata.columns * 2 ||
    buffer.byteLength > 8 * 1024 ** 2
  )
    throw new Error('invalid frame size')
  // Transport is explicitly little endian, including on a big-endian browser.
  const pixels = metadata.signed
    ? new Int16Array(buffer.byteLength / 2)
    : new Uint16Array(buffer.byteLength / 2)
  const view = new DataView(buffer)
  for (let i = 0; i < pixels.length; i++)
    pixels[i] = metadata.signed ? view.getInt16(i * 2, true) : view.getUint16(i * 2, true)
  return pixels
}

export function displayFor(
  pixels: Int16Array | Uint16Array,
  metadata: FrameMetadata,
): FrameDisplay {
  let low = Infinity,
    high = -Infinity
  for (const value of pixels) {
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  const { slope, intercept, window_center: centers, window_width: widths } = metadata.frame
  const a = low * slope + intercept,
    b = high * slope + intercept
  const min = Math.min(a, b),
    max = Math.max(a, b)
  const preset = widths?.findIndex((width, i) => width >= 1 && Number.isFinite(centers?.[i])) ?? -1
  return {
    min,
    max,
    width: preset >= 0 ? widths![preset] : Math.max(1, max - min + 1),
    center: preset >= 0 ? centers![preset] : (min + max + 1) / 2,
    orientation: orientationLabels(metadata.frame.orientation),
  }
}
