/**
 * Скелет рисунка упражнения: части тела — плавные контуры в своих координатах, вложенные
 * друг в друга и повёрнутые вокруг суставов. Поза — набор углов; движение — переход между
 * двумя позами. Сам рисунок собирает `ExerciseFigure`.
 */

export type Point = readonly [number, number]
/** Значение в исходной позе и в конечной. */
export type Pair = readonly [number, number]

/**
 * Слой рисунка: 0 — за телом, 1 — тело (сливается в один силуэт), 2 — рука поверх корпуса
 * (тонкие внутренние линии), 3 — снаряд поверх всего.
 */
export type Layer = 0 | 1 | 2 | 3

export type GearKind = 'plate' | 'hub' | 'bar' | 'steel' | 'pad' | 'cable'

export interface Shape {
  layer: Layer
  d?: string
  circle?: readonly [cx: number, cy: number, r: number]
  ellipse?: readonly [cx: number, cy: number, rx: number, ry: number]
  /** Сдвиг внутри системы координат сустава. */
  shift?: Point
  /** Линии у начала части проявляются плавно — так рука выходит из плеча без шва. */
  fade?: boolean
  /** Снаряд, а не тело: рисуется как есть, своим стилем. */
  gear?: GearKind
  /** Дальняя нога: рисуется за телом своим силуэтом. */
  far?: boolean
  /** Видимая длина линии по шагам пути — так трос дотягивается ровно до кисти. */
  dashPath?: readonly number[]
}

export interface Joint {
  at: Point
  /** Поворот относительно родителя, градусы по часовой: в исходной позе и в конечной. */
  turn: Pair
  /** Сдвиг начала движения, мс: суставы идут не строго одновременно. */
  delay?: number
  /** Сустав сам переезжает между позами — так движется корень фигуры. */
  move?: readonly [Point, Point]
  /**
   * Поворот по шагам пути от исходной позы к конечной — когда прямой переход между двумя
   * углами не годится: кисть должна оставаться на перекладине, пока тело движется.
   */
  turnPath?: readonly number[]
  /** То же для переезда сустава. */
  movePath?: readonly Point[]
  /** Зеркальная половина: вторая рука на виде спереди. */
  flip?: boolean
  shapes: Shape[]
  kids: Joint[]
}

export interface Figure {
  root: Joint
  /** То, что тянется к фигуре из неподвижной точки: трос тренажёра. */
  tethers: Joint[]
  /** Неподвижная обстановка: пол, скамья, стойка. */
  world: Shape[]
  /** Длина плеча — по ней линии руки проявляются от сустава к локтю. */
  upperArm: number
  viewBox: string
}

/**
 * Поза на виде сбоку, человек смотрит вправо. Угол части — по часовой стрелке от
 * направления «вверх», в градусах.
 */
export interface Pose {
  /** Голень: от лодыжки к колену. */
  s: number
  /** Бедро: от колена к тазу. */
  t: number
  /** Корпус: от таза к плечам. */
  u: number
  /** Голова относительно корпуса. */
  h: number
  /** Плечо: от плечевого сустава к локтю. */
  a: number
  /** Предплечье: от локтя к кисти. */
  f: number
  /** Стопа: 0 — подошва на полу, носок вправо. Нужна, когда человек стоит не на стопах. */
  g?: number
  /** Сгиб в пояснице: на сколько грудь повёрнута относительно таза. */
  b?: number
}

const SHIN = 25
const THIGH = 26
/** Длины плеча и предплечья в долях роста: 18,6 % и 14,6 %. */
const ARM: Pair = [19.6, 15.4]
/** Центр кисти — на столько дальше конца предплечья. */
const PALM = 2

/** Часть конечности, сужающаяся от сустава к суставу: полуширины в начале, по пути и в конце. */
function limb(length: number, w0: number, wa: number, wb: number, w1: number): string {
  return (
    `M${w0} 0C${wa} ${-length * 0.25} ${wb} ${-length * 0.65} ${w1} ${-length}` +
    `A${w1} ${w1} 0 0 0 ${-w1} ${-length}` +
    `C${-wb} ${-length * 0.65} ${-wa} ${-length * 0.25} ${-w0} 0A${w0} ${w0} 0 0 0 ${w0} 0Z`
  )
}

/** Плечо: у сустава шире — это дельта. */
function upperArm(length: number, w0 = 4.2, wm = 3.3, w1 = 2.6): string {
  const side = (sign: 1 | -1) =>
    `C${sign * w0} ${-length * 0.2} ${sign * wm} ${-length * 0.3} ${sign * wm} ${-length * 0.45}` +
    `C${sign * wm} ${-length * 0.7} ${sign * w1} ${-length * 0.85} ${sign * w1} ${-length}`
  const back =
    `C${-w1} ${-length * 0.85} ${-wm} ${-length * 0.7} ${-wm} ${-length * 0.45}` +
    `C${-wm} ${-length * 0.3} ${-w0} ${-length * 0.2} ${-w0} 0`
  return `M${w0} 0${side(1)}A${w1} ${w1} 0 0 0 ${-w1} ${-length}${back}A${w0} ${w0} 0 0 0 ${w0} 0Z`
}

const BODY = {
  foot: 'M-5 4.5L-5.5 1C-5.5-2.5-3.2-4 0-4C2.8-4 5.4-1.6 9.6.4C12.4 1.6 12.8 4.5 11 4.5Z',
  shin: 'M2.2 0C2.4-5 3.3-11 3.5-17C3.6-20 3.6-23 3.5-25A3.5 3.5 0 0 0-3.5-25C-4.9-23.5-5.7-20-5.4-15.5C-5-11-2.8-6-2.2 0A2.2 2.2 0 0 0 2.2 0Z',
  thigh:
    'M3.5 0C3.9-2 5.8-6 6.5-11C7-15 6.6-21 5.6-26A5.9 5.9 0 0 0-6.2-26C-6.6-21.5-6.2-15-5.4-10C-5-6.5-4-3-3.5 0A3.5 3.5 0 0 0 3.5 0Z',
  torso:
    'M5.8 0C5.4-3 5.2-6 5.2-9C5.2-13 6.2-17 7.2-20C8.2-22.5 8.8-24.5 8.6-26.5C8.3-29.5 6.8-31.6 3.8-32.6L-3.8-33.4C-6.6-32.4-8.2-29.6-8.2-25.5C-8.2-19.5-5.6-14-5.4-9C-5.3-6-6-3-6.3 0A6.05 6.05 0 0 0 5.8 0Z',
  // Корпус из двух частей — для упражнений со сгибом в пояснице.
  pelvis:
    'M5.8 0C5.4-3 5.2-6 5.2-9C5.2-11 5.6-13.5 6.2-16L-5.9-16C-5.5-13.5-5.4-11-5.4-9C-5.3-6-6-3-6.3 0A6.05 6.05 0 0 0 5.8 0Z',
  chest:
    'M5.4-10C5.6-13.5 6.4-17.5 7.2-20C8.2-22.5 8.8-24.5 8.6-26.5C8.3-29.5 6.8-31.6 3.8-32.6L-3.8-33.4C-6.6-32.4-8.2-29.6-8.2-25.5C-8.2-19.5-5.8-14.5-5.4-10Z',
  neck: 'M-5.4 4C-4.8 0-3.9-3-3.6-8L3-7.6C3.1-4 3.5-1 4.6 3Z',
  head: 'M-4.8-5.6C-4.8-9.8-1.9-12.1 1.4-12.1C4.6-12.1 6.9-9.8 6.9-6.6C6.9-5.2 7.5-4.2 7.7-3.3C7.9-2.4 6.9-2.2 6.8-1.4C6.6 0 5.5 1.3 3.2 1.5C.4 1.7-1.4.9-2.8-.5C-4.2-1.9-4.8-3.8-4.8-5.6Z',
} as const

/** Плечевой сустав, основание шеи и место грифа на спине — от таза, в координатах корпуса. */
const SHOULDER: Point = [-0.5, -29]
const NECK: Point = [-0.6, -30.5]
const UPPER_BACK: Point = [-7, -30.5]
/** Сгиб в пояснице — от таза; и где таз в координатах груди. */
const WAIST: Point = [0, -13]
const UNDER_WAIST: Point = [0, 13]

const sub = (a: Pair, b: Pair): Pair => [a[0] - b[0], a[1] - b[1]]
const mid = (a: Pair, b: Pair): Pair => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]]
const STILL: Pair = [0, 0]

function moved(shapes: Shape[], by: Point): Shape[] {
  return shapes.map((shape) => ({ ...shape, shift: plus(shape.shift ?? [0, 0], by) }))
}

/** Поза дальней ноги, когда ноги работают по очереди. */
export interface LegPose {
  s: number
  t: number
  g?: number
}

export interface SideFigure {
  /** Что неподвижно: стопы на полу, таз на скамье или сиденье, кисти на перекладине. */
  root: 'foot' | 'hip' | 'hand'
  /** Где стоит неподвижная точка; две точки — она переезжает между позами. */
  at: Point | readonly [Point, Point]
  poses: readonly [Pose, Pose]
  /** Дальняя нога, если она движется не так, как ближняя: ходьба, педали, выпад. */
  farLeg?: readonly [LegPose, LegPose]
  /** Длины плеча и предплечья, если рука видна в ракурсе короче настоящей. */
  arm?: Pair
  /** Кисть сжата в кулак — держит снаряд. */
  grip?: boolean
  /** Снаряд в кисти: координаты от центра кисти. */
  held?: Shape[]
  /** Снаряд на плечах: координаты от места грифа на спине. */
  back?: Shape[]
  /** Валик тренажёра на голени и платформа под стопой: координаты от лодыжки. */
  onShin?: Shape[]
  onFoot?: Shape[]
  /** То, что едет вместе с тазом: сиденье гребного тренажёра. */
  seat?: Shape[]
  /** Трос: тянется от этой точки к кисти и следует за ней. */
  cable?: Point
  world?: Shape[]
  viewBox?: string
}

/** Пол: общий для всех рисунков, где человек на нём стоит или лежит. */
export const FLOOR_Y = 110.5
export const FLOOR: Shape = { layer: 0, gear: 'steel', d: `M14 ${FLOOR_Y}H106` }

/** Шагов на пути от исходной позы к конечной, когда движение идёт по шагам. */
const STEPS = 10
/** Плавный разгон и торможение: доля времени → доля пути. */
const ease = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const stepped = ([from, to]: Pair): number[] =>
  Array.from({ length: STEPS + 1 }, (_, step) => {
    const value = from + (to - from) * ease(step / STEPS)
    return Math.round(value * 100) / 100
  })

const radians = (degrees: number) => (degrees * Math.PI) / 180
/** Куда смотрит часть с таким углом: по часовой от «вверх». */
const toward = (degrees: number, length: number): Point => [
  length * Math.sin(radians(degrees)),
  -length * Math.cos(radians(degrees)),
]
const turned = ([x, y]: Point, degrees: number): Point => {
  const [sin, cos] = [Math.sin(radians(degrees)), Math.cos(radians(degrees))]
  return [x * cos - y * sin, x * sin + y * cos]
}

/** Переводит сустав и всё, что на нём висит, на движение по шагам: без сдвигов по времени. */
function inSteps(joint: Joint): Joint {
  const { delay: _, ...rest } = joint
  return {
    ...rest,
    ...(joint.turn[0] !== joint.turn[1] && { turnPath: stepped(joint.turn) }),
    ...(joint.move && {
      movePath: stepped([joint.move[0][0], joint.move[1][0]]).map((x, step): Point => [
        x,
        stepped([joint.move![0][1], joint.move![1][1]])[step],
      ]),
    }),
    kids: joint.kids.map(inSteps),
  }
}

/** Собирает фигуру на виде сбоку из двух поз. */
export function sideFigure(spec: SideFigure): Figure {
  const [from, to] = spec.poses
  const pair = (key: keyof Pose): Pair => [from[key] ?? 0, to[key] ?? 0]
  const shin = pair('s')
  const thigh = pair('t')
  const torso = pair('u')
  const bend = pair('b')
  const head = pair('h')
  const arm = pair('a')
  const forearm = pair('f')
  const foot = pair('g')
  const bends = bend[0] !== 0 || bend[1] !== 0
  // Грудь повёрнута относительно таза на угол сгиба — от неё считаются шея и рука.
  const chest: Pair = [torso[0] + bend[0], torso[1] + bend[1]]
  const [upper, lower] = spec.arm ?? ARM
  const reach = lower + PALM
  const upperShape = upperArm(upper)
  const lowerShape = limb(lower, 2.7, 3, 2.3, 1.8)
  const palm = (layer: Layer, shift: Point): Shape =>
    spec.grip
      ? { layer, circle: [0, -reach, 2.5], shift }
      : { layer, ellipse: [0.3, -lower - 3.2, 2.1, 3.9], shift }
  const body = (d: string, shift?: Point): Shape => ({ layer: 1, d, ...(shift && { shift }) })
  // Рука входит в общий силуэт (слой 1) и ещё раз рисуется поверх корпуса тонкой линией.
  const upperArmShapes = (shift?: Point): Shape[] => [
    { layer: 2, d: upperShape, fade: true, ...(shift && { shift }) },
    body(upperShape, shift),
  ]
  const forearmShapes = (shift: Point): Shape[] => [
    { layer: 2, d: lowerShape, shift },
    palm(2, shift),
    body(lowerShape, shift),
    palm(1, shift),
  ]
  const glute: Shape = { layer: 1, circle: [-1.2, 1.5, 6.4] }

  /** Шея и голова; `hip` — где таз в координатах груди. */
  const headJoint = (hip: Point): Joint => ({
    at: plus(hip, NECK),
    turn: [2 + head[0] / 2, 2 + head[1] / 2],
    delay: 30,
    shapes: [body(BODY.neck)],
    kids: [
      {
        at: [0.3, -6],
        turn: [head[0] / 2 - 2, head[1] / 2 - 2],
        delay: 60,
        shapes: [body(BODY.head)],
        kids: [],
      },
    ],
  })
  const onBack = (hip: Point): Shape[] => moved(spec.back ?? [], plus(hip, UPPER_BACK))

  /** Рука, которая растёт из груди; угол груди — у родителя. */
  const armJoint = (hip: Point): Joint => ({
    at: plus(hip, SHOULDER),
    turn: sub(arm, chest),
    delay: -90,
    shapes: upperArmShapes(),
    kids: [
      {
        at: [0, -upper],
        turn: sub(forearm, arm),
        delay: 60,
        shapes: [...forearmShapes([0, 0]), ...moved(spec.held ?? [], [0, -reach])],
        kids: [],
      },
    ],
  })

  /** Нога, которая растёт из таза: бедро, голень и стопа — вниз по цепочке. */
  const legJoints = (
    hip: Point,
    parent: Pair,
    leg: { s: Pair; t: Pair; g: Pair },
    far: boolean,
  ): Joint[] => {
    const part = (d: string, shift?: Point): Shape => ({ ...body(d, shift), ...(far && { far }) })
    return [
      {
        at: hip,
        turn: sub(leg.t, parent),
        delay: -40,
        shapes: [part(BODY.thigh, [0, THIGH])],
        kids: [
          {
            at: [0, THIGH],
            turn: sub(leg.s, leg.t),
            delay: 90,
            shapes: [
              part(BODY.shin, [0, SHIN]),
              ...(far ? [] : moved(spec.onShin ?? [], [0, SHIN])),
            ],
            kids: [
              {
                at: [0, SHIN],
                turn: sub(leg.g, leg.s),
                shapes: [part(BODY.foot), ...(far ? [] : (spec.onFoot ?? []))],
                kids: [],
              },
            ],
          },
        ],
      },
    ]
  }
  const near = { s: shin, t: thigh, g: foot }
  const farLeg = spec.farLeg && {
    s: [spec.farLeg[0].s, spec.farLeg[1].s] as Pair,
    t: [spec.farLeg[0].t, spec.farLeg[1].t] as Pair,
    g: [spec.farLeg[0].g ?? 0, spec.farLeg[1].g ?? 0] as Pair,
  }
  const gluteJoint = (hip: Point, parent: Pair): Joint => ({
    at: hip,
    turn: sub(mid(thigh, torso), parent),
    shapes: [glute],
    kids: [],
  })

  /** Корпус: целый или из двух частей со сгибом в пояснице; угол родителя — `parent`. */
  const torsoJoint = (parent: Pair): Joint => ({
    at: [0, 0],
    turn: sub(torso, parent),
    delay: -50,
    ...(bends
      ? {
          shapes: [body(BODY.pelvis)],
          kids: [
            {
              at: WAIST,
              turn: bend,
              delay: -20,
              shapes: [
                body(BODY.chest, UNDER_WAIST),
                { layer: 1, circle: [0, 0, 5.3] },
                ...onBack(UNDER_WAIST),
              ],
              kids: [headJoint(UNDER_WAIST), armJoint(UNDER_WAIST)],
            },
          ],
        }
      : {
          shapes: [body(BODY.torso), ...onBack([0, 0])],
          kids: [headJoint([0, 0]), armJoint([0, 0])],
        }),
  })

  let kids: Joint[]
  let shapes: Shape[] = []
  if (spec.root === 'foot') {
    shapes = [body(BODY.foot), ...(spec.onFoot ?? [])]
    kids = [
      {
        at: [0, 0],
        turn: shin,
        delay: 90,
        shapes: [body(BODY.shin), ...(spec.onShin ?? [])],
        kids: [
          {
            at: [0, -SHIN],
            turn: sub(thigh, shin),
            delay: -40,
            shapes: [body(BODY.thigh)],
            kids: [
              ...(farLeg ? legJoints([0, -THIGH], thigh, farLeg, true) : []),
              gluteJoint([0, -THIGH], thigh),
              { ...torsoJoint(thigh), at: [0, -THIGH] },
            ],
          },
        ],
      },
    ]
  } else if (spec.root === 'hip') {
    shapes = spec.seat ?? []
    kids = [
      ...(farLeg ? legJoints([0, 0], STILL, farLeg, true) : []),
      ...legJoints([0, 0], STILL, near, false),
      gluteJoint([0, 0], STILL),
      torsoJoint(STILL),
    ]
  } else {
    // Вис: цепочка идёт от кисти вниз — предплечье, плечо, корпус, ноги.
    const hip: Point = [-SHOULDER[0], -SHOULDER[1]]
    shapes = spec.held ?? []
    kids = [
      {
        at: [0, 0],
        turn: forearm,
        delay: 60,
        shapes: forearmShapes([0, reach]),
        kids: [
          {
            at: [0, reach],
            turn: sub(arm, forearm),
            delay: -90,
            shapes: upperArmShapes([0, upper]),
            kids: [
              {
                at: [0, upper],
                turn: sub(torso, arm),
                delay: -50,
                shapes: [body(BODY.torso, hip), ...onBack(hip)],
                kids: [
                  headJoint(hip),
                  ...(farLeg ? legJoints(hip, torso, farLeg, true) : []),
                  ...legJoints(hip, torso, near, false),
                  gluteJoint(hip, torso),
                ],
              },
            ],
          },
        ],
      },
    ]
  }

  const moving = Array.isArray(spec.at[0])
  const [start, end] = moving
    ? (spec.at as readonly [Point, Point])
    : [spec.at as Point, spec.at as Point]
  const root: Joint = {
    at: start,
    turn: STILL,
    ...(moving && { move: [start, end] }),
    shapes,
    kids,
  }
  const figure = {
    world: spec.world ?? [FLOOR],
    upperArm: upper,
    viewBox: spec.viewBox ?? '3 1 114 114',
  }
  if (!spec.cable) return { root, tethers: [], ...figure }

  // Трос следует за кистью, только когда всё идёт по одним и тем же шагам пути.
  const anchor = spec.cable
  const angles = {
    s: stepped(shin),
    t: stepped(thigh),
    u: stepped(chest),
    a: stepped(arm),
    f: stepped(forearm),
    x: stepped([start[0], end[0]]),
    y: stepped([start[1], end[1]]),
  }
  const toHand = angles.u.map((u, step): Point => {
    const base: Point = [angles.x[step], angles.y[step]]
    const hip =
      spec.root === 'foot'
        ? plus(plus(base, toward(angles.s[step], SHIN)), toward(angles.t[step], THIGH))
        : base
    const hand = [
      turned(SHOULDER, u),
      toward(angles.a[step], upper),
      toward(angles.f[step], reach),
    ].reduce(plus, hip)
    return [hand[0] - anchor[0], hand[1] - anchor[1]]
  })
  const aim = toHand.map(([x, y]) => Math.round((Math.atan2(x, -y) * 1800) / Math.PI) / 10)
  const length = toHand.map(([x, y]) => Math.round(Math.hypot(x, y) * 10) / 10)
  return {
    root: inSteps(root),
    tethers: [
      {
        at: anchor,
        turn: [aim[0], aim[STEPS]],
        turnPath: aim,
        shapes: [{ layer: 0, gear: 'cable', d: 'M0 0V-400', dashPath: length }],
        kids: [],
      },
    ],
    ...figure,
  }
}

/** Тело на виде спереди — то же, что на карте мышц: правая половина, вторая — зеркалом. */
export const FRONT_BODY = {
  half: 'M29.4 20L36 20.5C40 21 42.5 23 42.5 27C42.5 31 40.5 35 39.5 40C38.8 44 37 46 36.8 49C36.6 52 38.8 55 39.2 59C39.8 65 39.5 72 38.5 79C38 83 37.4 85 37.6 88C37.8 91 38.6 94 38.2 98C37.8 103 36 108 35.8 112L37.5 115.5C37.5 116.5 36.5 117 35.5 117L32.5 117C31.5 117 31.3 116 31.5 115L32.6 111C32.4 106 32.2 100 32.4 96C32.6 92 33 90 33 87C33 84 32.4 81 32 78C31.6 73 31 67 30.6 63L29.4 62.5Z',
  arm: 'M39.5 22.5C43 22 45.5 24.5 45.8 28C46.2 33 46.6 38 47.2 43C47.8 47 49 52 49.4 57C49.7 60 49.8 63 49.8 65C50 67.5 49.4 70 48.3 70C47.2 70 46.6 68 46.4 65.5C46 61 44.6 55 43.8 50C43.2 46 42.2 42 41.6 38C41 34 40.4 30 40 27Z',
  head: [30, 10.5, 6, 7.2],
  neck: 'M27 15h6v7h-6z',
  /** Ширина половины рисунка: зеркало — вокруг этой оси. */
  axis: 30,
  shoulder: [41.2, 24.6],
} as const

/** Поза рук на виде спереди: плечо и предплечье, по часовой от «вверх», для правой руки. */
export interface FrontPose {
  a: number
  f: number
}

/** Вис на перекладине на виде спереди: тело поднимается, кисти остаются на месте. */
export interface FrontHang {
  /** Насколько хват шире плеча. */
  out: number
  /** Насколько плечо ниже перекладины в висе и в верхней точке. */
  far: number
  near: number
}

export interface FrontFigure {
  /** Позы рук, когда тело стоит на месте. */
  poses?: readonly [FrontPose, FrontPose]
  /** Вместо поз — вис: руки подбираются под перекладину на каждом шаге подъёма. */
  hang?: FrontHang
  viewBox?: string
  grip?: boolean
  /** Снаряд в каждой кисти: координаты от центра кисти. */
  held?: Shape[]
  world?: Shape[]
}

/** Собирает фигуру на виде спереди: тело стоит, двигаются руки — обе одинаково. */
export function frontFigure(spec: FrontFigure): Figure {
  const rise = spec.hang && hangPath(spec.hang)
  const [from, to] = rise
    ? [rise[0].pose, rise[rise.length - 1].pose]
    : (spec.poses ?? [REST, REST])
  const arm: Pair = [from.a, to.a]
  const forearm: Pair = [from.f, to.f]
  const upper = 20.5
  const lower = 16
  const reach = lower + PALM
  const upperShape = upperArm(upper, 3.9, 3.1, 2.5)
  const lowerShape = limb(lower, 2.6, 2.9, 2.2, 1.8)
  const palm = (layer: Layer): Shape =>
    spec.grip
      ? { layer, circle: [0, -reach, 2.5] }
      : { layer, ellipse: [0, -lower - 3.2, 2.1, 3.9] }
  const half: Shape = { layer: 1, d: FRONT_BODY.half }
  const armJoint = (flip: boolean): Joint => ({
    at: flip
      ? [2 * FRONT_BODY.axis - FRONT_BODY.shoulder[0], FRONT_BODY.shoulder[1]]
      : FRONT_BODY.shoulder,
    turn: arm,
    // В висе суставы идут строго вместе: иначе кисть съедет с перекладины.
    ...(rise ? { turnPath: rise.map((step) => step.pose.a) } : { delay: -60 }),
    flip,
    // Опущенная рука лежит поверх корпуса: её отделяют тонкие линии, как на виде сбоку.
    shapes: [
      { layer: 2, d: upperShape, fade: true },
      { layer: 1, d: upperShape },
    ],
    kids: [
      {
        at: [0, -upper],
        turn: sub(forearm, arm),
        ...(rise ? { turnPath: rise.map((step) => step.pose.f - step.pose.a) } : { delay: 60 }),
        shapes: [
          { layer: 2, d: lowerShape },
          palm(2),
          { layer: 1, d: lowerShape },
          palm(1),
          ...moved(spec.held ?? [], [0, -reach]),
        ],
        kids: [],
      },
    ],
  })
  return {
    root: {
      at: [30, 1],
      turn: STILL,
      ...(rise && { movePath: rise.map((step): Point => [30, 1 - step.lift]) }),
      shapes: [half, { layer: 1, ellipse: FRONT_BODY.head }, { layer: 1, d: FRONT_BODY.neck }],
      kids: [
        // Вторая половина тела — зеркалом вокруг его оси.
        { at: [2 * FRONT_BODY.axis, 0], turn: STILL, flip: true, shapes: [half], kids: [] },
        armJoint(false),
        armJoint(true),
      ],
    },
    tethers: [],
    // На виде спереди человек выше, чем сбоку: пол и кадр стоят под его стопами.
    world: spec.world ?? [{ ...FLOOR, d: 'M14 119.4H106' }],
    upperArm: upper,
    viewBox: spec.viewBox ?? '0 2 120 120',
  }
}

const REST: FrontPose = { a: 172, f: 176 }

/** Путь подъёма в висе: на каждом шаге — насколько поднято тело и поза рук под перекладину. */
function hangPath({ out, far, near }: FrontHang): { lift: number; pose: FrontPose }[] {
  return Array.from({ length: STEPS + 1 }, (_, step) => {
    const below = far + (near - far) * ease(step / STEPS)
    return { lift: Math.round((far - below) * 100) / 100, pose: frontReach(out, below) }
  })
}

/**
 * Поза руки на виде спереди, при которой кисть лежит на перекладине: `out` — насколько хват
 * шире плеча, `below` — насколько плечо ниже перекладины. Локоть уходит в сторону.
 */
export function frontReach(out: number, below: number): FrontPose {
  const upper = 20.5
  const lower = 16 + PALM
  const span = Math.min(Math.hypot(out, below), upper + lower - 0.01)
  const toHand = Math.atan2(out, below)
  const bend = Math.acos((upper ** 2 + span ** 2 - lower ** 2) / (2 * upper * span))
  // Локоть уходит наружу: при кисти над плечом — по часовой, под плечом — против.
  const a = toHand + (below >= 0 ? bend : -bend)
  const f = Math.atan2(out - upper * Math.sin(a), below - upper * Math.cos(a))
  const degrees = (angle: number) => Math.round((angle * 1800) / Math.PI) / 10
  return { a: degrees(a), f: degrees(f) }
}
