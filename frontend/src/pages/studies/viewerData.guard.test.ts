import { describe, expect, it } from 'vitest'
import { displayFor, orientationLabels, pixelsFrom, type FrameMetadata } from './viewerData'

const metadata: FrameMetadata = {
  rows: 2,
  columns: 2,
  signed: true,
  photometric: 'MONOCHROME1',
  modality: 'CT',
  frame: {
    number: 0,
    slope: 2.5,
    intercept: -100,
    position: [0, 0, 0],
    orientation: [1, 0, 0, 0, 1, 0],
    spacing: [0.5, 0.7],
    temporal: '',
    stack: '',
    window_center: [40],
    window_width: [400],
  },
}
describe('I26: raw pixel precision and frame-specific presentation', () => {
  it('decodes signed little-endian pixels without 8-bit clipping or early rescale', () => {
    const buffer = new ArrayBuffer(8),
      view = new DataView(buffer)
    const values = [-2048, -1, 0, 2047]
    values.forEach((value, index) => view.setInt16(index * 2, value, true))
    const pixels = pixelsFrom(buffer, metadata)
    expect([...pixels]).toEqual(values)
    expect(displayFor(pixels, metadata)).toEqual({
      min: -5220,
      max: 5017.5,
      width: 400,
      center: 40,
      orientation: ['A', 'L', 'P', 'R'],
    })
    expect([...pixelsFrom(buffer, { ...metadata, signed: false })]).toEqual([63488, 65535, 0, 2047])
  })
  it('uses the full modality range when a valid VOI pair is absent, including negative slope', () => {
    const m = {
      ...metadata,
      frame: { ...metadata.frame, slope: -2, window_width: null, window_center: null },
    }
    expect(displayFor(new Int16Array([-100, 0, 100, 200]), m)).toMatchObject({
      min: -500,
      max: 100,
      width: 601,
      center: -199.5,
    })
    expect(
      displayFor(new Int16Array([0]), {
        ...m,
        frame: { ...m.frame, window_width: [-2, 100], window_center: [40, 20] },
      }),
    ).toMatchObject({ width: 100, center: 20 })
  })
  it('rejects truncated/oversized frames and never invents missing orientation', () => {
    expect(() => pixelsFrom(new ArrayBuffer(6), metadata)).toThrow('invalid frame size')
    expect(() => pixelsFrom(new ArrayBuffer(8 * 1024 ** 2 + 2), metadata)).toThrow(
      'invalid frame size',
    )
    expect(orientationLabels(null)).toEqual(['', '', '', ''])
    expect(orientationLabels([0, 1, 0, 0, 0, -1])).toEqual(['H', 'P', 'F', 'A'])
    expect(orientationLabels([0.8, 0.6, 0, -0.6, 0.8, 0])).toEqual(['AL', 'LP', 'PR', 'RA'])
  })
})
