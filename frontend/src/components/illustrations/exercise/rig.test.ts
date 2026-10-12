import { describe, expect, it } from 'vitest'

import { frontFigure, frontReach, type Joint, type Pose, type Shape, sideFigure } from './rig'

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

const STAND: Pose = { s: 3, t: -1, u: 1, h: 0, a: 178, f: 176 }
const every = (joint: Joint): Joint[] => [joint, ...joint.kids.flatMap(every)]
const shapesOf = (joint: Joint): Shape[] => every(joint).flatMap((part) => part.shapes)

describe('фигура сбоку', () => {
  it('без сгиба корпус — одна часть, со сгибом — таз и грудь на своём суставе', () => {
    const rigid = sideFigure({ root: 'foot', at: [50, 105.5], poses: [STAND, STAND] })
    const bent = sideFigure({
      root: 'hip',
      at: [60, 100],
      poses: [
        { ...STAND, b: 0 },
        { ...STAND, b: 28 },
      ],
    })

    expect(every(rigid.root).some((joint) => joint.turn[1] === 28)).toBe(false)
    const waist = every(bent.root).find((joint) => joint.turn[0] === 0 && joint.turn[1] === 28)!
    // Шея и рука растут из груди — сгибаются вместе с ней.
    expect(waist.kids).toHaveLength(2)
    expect(shapesOf(bent.root).length).toBeGreaterThan(shapesOf(rigid.root).length)
  })

  it('дальняя нога есть, только когда она задана, и помечена для отдельного силуэта', () => {
    const one = sideFigure({ root: 'hip', at: [50, 50], poses: [STAND, STAND] })
    const two = sideFigure({
      root: 'hip',
      at: [50, 50],
      poses: [STAND, STAND],
      farLeg: [
        { s: 38, t: 18 },
        { s: -18, t: -22 },
      ],
    })

    expect(shapesOf(one.root).filter((shape) => shape.far)).toHaveLength(0)
    // Бедро, голень и стопа.
    expect(shapesOf(two.root).filter((shape) => shape.far)).toHaveLength(3)
  })

  it('валик на голени и платформа под стопой у дальней ноги не повторяются', () => {
    const gear: Shape[] = [{ layer: 3, gear: 'plate', circle: [0, 0, 3] }]
    const figure = sideFigure({
      root: 'hip',
      at: [50, 50],
      poses: [STAND, STAND],
      farLeg: [
        { s: 0, t: 0 },
        { s: 0, t: 0 },
      ],
      onShin: gear,
      onFoot: gear,
    })

    expect(shapesOf(figure.root).filter((shape) => shape.gear)).toHaveLength(2)
  })

  it('фигура, у которой таз переезжает, несёт сиденье с собой', () => {
    const seat: Shape[] = [{ layer: 0, gear: 'pad', d: 'M-8 7h15v3h-15z' }]
    const figure = sideFigure({
      root: 'hip',
      at: [
        [56, 92],
        [38, 92],
      ],
      poses: [STAND, STAND],
      seat,
    })

    expect(figure.root.move).toEqual([
      [56, 92],
      [38, 92],
    ])
    expect(figure.root.shapes).toEqual(seat)
  })
})

describe('трос', () => {
  const anchor = [70, 7] as const
  const figure = sideFigure({
    root: 'foot',
    at: [48, 105.5],
    poses: [
      { s: 4, t: -3, u: 8, h: -4, a: 176, f: 40 },
      { s: 4, t: -3, u: 8, h: -4, a: 176, f: 172 },
    ],
    grip: true,
    cable: anchor,
  })
  const [tether] = figure.tethers
  const lengths = tether.shapes[0].dashPath!

  it('без троса фигура движется по общим ключевым кадрам', () => {
    const plain = sideFigure({ root: 'foot', at: [48, 105.5], poses: [STAND, STAND] })

    expect(plain.tethers).toEqual([])
    expect(every(plain.root).some((joint) => joint.turnPath)).toBe(false)
  })

  it('с тросом все суставы идут по одним шагам и без сдвигов по времени', () => {
    const joints = every(figure.root)

    expect(joints.every((joint) => joint.delay === undefined)).toBe(true)
    const moving = joints.filter((joint) => joint.turn[0] !== joint.turn[1])
    expect(moving.length).toBeGreaterThan(0)
    expect(moving.every((joint) => joint.turnPath?.length === lengths.length)).toBe(true)
  })

  it('на каждом шаге трос кончается там, где кисть', () => {
    const reach = 15.4 + 2
    const turn = (degrees: number) => (degrees * Math.PI) / 180
    const toward = (degrees: number, length: number) => [
      length * Math.sin(turn(degrees)),
      -length * Math.cos(turn(degrees)),
    ]
    // Локоть неподвижен: ноги, корпус и плечо в обеих позах одни и те же.
    const parts = [toward(4, 25), toward(-3, 26), toward(176, 19.6)]
    const shoulder = [
      -0.5 * Math.cos(turn(8)) + 29 * Math.sin(turn(8)),
      -0.5 * Math.sin(turn(8)) - 29 * Math.cos(turn(8)),
    ]
    const elbow = [...parts, shoulder].reduce(([x, y], [dx, dy]) => [x + dx, y + dy], [48, 105.5])
    const forearm = every(figure.root).find((joint) => joint.turnPath && joint.kids.length === 0)!

    lengths.forEach((length, step) => {
      // Угол предплечья: сумма поворотов по цепочке равна его углу в позе на этом шаге.
      const angle = 176 + forearm.turnPath![step]
      const [hx, hy] = toward(angle, reach)
      const palm = [elbow[0] + hx, elbow[1] + hy]
      const end = toward(tether.turnPath![step], length)

      expect(anchor[0] + end[0], `шаг ${step}`).toBeCloseTo(palm[0], 0)
      expect(anchor[1] + end[1], `шаг ${step}`).toBeCloseTo(palm[1], 0)
    })
  })

  it('длина троса меняется вместе с движением', () => {
    expect(lengths[0]).not.toBe(lengths.at(-1))
    expect(new Set(lengths).size).toBeGreaterThan(5)
  })
})
