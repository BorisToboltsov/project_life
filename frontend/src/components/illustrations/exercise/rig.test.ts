import { describe, expect, it } from 'vitest'

import { frontFigure, frontReach, type Joint } from './rig'

const radians = (degrees: number) => (degrees * Math.PI) / 180
const UPPER = 20.5
const LOWER = 18

/** Где окажется кисть относительно плеча: вправо и вверх — положительные. */
function hand({ a, f }: { a: number; f: number }): [number, number] {
  return [
    UPPER * Math.sin(radians(a)) + LOWER * Math.sin(radians(f)),
    UPPER * Math.cos(radians(a)) + LOWER * Math.cos(radians(f)),
  ]
}

describe('рука под перекладину на виде спереди', () => {
  it.each([
    [7.8, 37.5],
    [7.8, 22],
    [7.8, 6],
    [0, 30],
    [12, 12],
  ])('хват шире плеча на %s, плечо ниже перекладины на %s — кисть на месте', (out, below) => {
    const [x, y] = hand(frontReach(out, below))

    expect(x).toBeCloseTo(out, 0)
    expect(y).toBeCloseTo(below, 0)
  })

  it('локоть уходит в сторону, а не внутрь', () => {
    const { a } = frontReach(7.8, 6)

    expect(a).toBeGreaterThan(90)
    expect(a).toBeLessThan(180)
  })

  it('до слишком далёкой перекладины рука просто вытянута', () => {
    const { a, f } = frontReach(0, 100)

    expect(Math.abs(a)).toBeLessThan(2)
    expect(Math.abs(f)).toBeLessThan(2)
  })
})

describe('вис на перекладине', () => {
  const figure = frontFigure({ hang: { out: 7.8, far: 37.5, near: 6 }, grip: true })
  const arm = figure.root.kids.find((joint: Joint) => joint.turnPath && !joint.flip)!
  const forearm = arm.kids[0]

  it('на каждом шаге подъёма кисть остаётся на перекладине', () => {
    const lifts = figure.root.movePath!.map(([, y]) => 1 - y)

    expect(lifts[0]).toBe(0)
    expect(lifts.at(-1)).toBeCloseTo(31.5, 1)
    lifts.forEach((lift, step) => {
      const a = arm.turnPath![step]
      const [x, y] = hand({ a, f: a + forearm.turnPath![step] })
      expect(x, `шаг ${step}`).toBeCloseTo(7.8, 0)
      // Плечо поднялось на `lift` — до перекладины осталось столько же меньше.
      expect(y + lift, `шаг ${step}`).toBeCloseTo(37.5, 0)
    })
  })

  it('тело поднимается без рывков: каждый шаг выше предыдущего', () => {
    const heights = figure.root.movePath!.map(([, y]) => y)

    expect(heights).toEqual([...heights].sort((a, b) => b - a))
    expect(new Set(heights).size).toBe(heights.length)
  })

  it('обе руки идут одним путём, вторая — зеркалом', () => {
    const mirrored = figure.root.kids.find((joint: Joint) => joint.turnPath && joint.flip)!

    expect(mirrored.turnPath).toEqual(arm.turnPath)
  })

  it('без позы и без виса руки просто опущены', () => {
    const still = frontFigure({})

    expect(still.root.movePath).toBeUndefined()
    expect(still.root.kids.every((joint: Joint) => joint.turn[0] === joint.turn[1])).toBe(true)
  })
})
