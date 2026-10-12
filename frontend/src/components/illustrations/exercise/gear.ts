import { FLOOR, FLOOR_Y, type Shape } from './rig'

/**
 * Снаряды и обстановка. То, что человек двигает, — цветом бренда; то, на чём он стоит,
 * сидит или висит, — контуром, как пол.
 */

/** Блин штанги с торца: сбоку штанга видна кругом. */
export function plate(radius = 10): Shape[] {
  return [
    { layer: 3, gear: 'plate', circle: [0, 0, radius] },
    { layer: 3, gear: 'hub', circle: [0, 0, 2] },
  ]
}

/** Гантель сбоку: рукоять поперёк предплечья, по блину с каждой стороны. */
export const DUMBBELL_SIDE: Shape[] = [
  { layer: 3, gear: 'bar', d: 'M-5 0H5' },
  { layer: 3, gear: 'plate', d: 'M-8.6-4h3.2v8h-3.2z' },
  { layer: 3, gear: 'plate', d: 'M5.4-4h3.2v8h-3.2z' },
]

/** Гиря: шар на дужке, висит под кистью — вдоль предплечья. */
export const KETTLEBELL: Shape[] = [
  { layer: 3, gear: 'bar', d: 'M-3.4-4.5C-4.6-1 4.6-1 3.4-4.5' },
  { layer: 3, gear: 'plate', circle: [0, -9.5, 5.6] },
]

/** Гиря у груди: её держат за дужку, шар — под кистями. */
export const KETTLEBELL_AT_CHEST: Shape[] = [
  { layer: 3, gear: 'bar', d: 'M-2.6 3.4C-4.4 0 4.4 0 2.6 3.4' },
  { layer: 3, gear: 'plate', circle: [1.5, 8, 5.6] },
]

/** Скамья сверху: подушка под спиной и головой лежащего. */
export function benchFromAbove(left: number, right: number, top: number, end: number): Shape[] {
  return [
    {
      layer: 0,
      gear: 'pad',
      d: `M${left + 3} ${top}H${right - 3}a3 3 0 0 1 3 3V${end - 3}a3 3 0 0 1-3 3H${left + 3}a3 3 0 0 1-3-3V${top + 3}a3 3 0 0 1 3-3Z`,
    },
  ]
}

/** Гантель с торца. */
export const DUMBBELL_END: Shape[] = [
  { layer: 3, gear: 'plate', circle: [0, 0, 4.8] },
  { layer: 3, gear: 'hub', circle: [0, 0, 1.4] },
]

const bottom = FLOOR_Y - 1.25

/** Горизонтальная скамья: подушка на высоте `top` и две опоры. */
export function bench(left: number, right: number, top: number): Shape[] {
  const leg = (x: number): Shape => ({
    layer: 0,
    gear: 'steel',
    d: `M${x} ${top + 5}V${bottom}M${x - 4} ${bottom}H${x + 4}`,
  })
  return [
    leg(left + 8),
    leg(right - 8),
    {
      layer: 0,
      gear: 'pad',
      d: `M${left + 2.5} ${top}H${right - 2.5}a2.5 2.5 0 0 1 0 5H${left + 2.5}a2.5 2.5 0 0 1 0-5Z`,
    },
    FLOOR,
  ]
}

/** Подставка под носки: низкая ступенька на полу. */
export function step(left: number, right: number, height = 5): Shape[] {
  return [
    {
      layer: 0,
      gear: 'pad',
      d: `M${left} ${bottom - height}H${right}V${bottom}H${left}Z`,
    },
    FLOOR,
  ]
}

/** Турник сбоку: стойка и перекладина с торца; `floor` — где под ним пол. */
export function pullUpBar(x: number, y: number, floor = FLOOR_Y): Shape[] {
  const foot = floor - 1.25
  return [
    { layer: 0, gear: 'steel', d: `M${x} ${y}V${foot}M${x - 6} ${foot}H${x + 6}` },
    { layer: 0, gear: 'steel', d: `M${x - 46} ${floor}H${x + 46}` },
    { layer: 3, gear: 'steel', circle: [x, y, 2.6] },
  ]
}

/** Турник спереди: перекладина на двух стойках. */
export function pullUpFrame(left: number, right: number, y: number, floor: number): Shape[] {
  const foot = floor - 1.25
  return [
    { layer: 0, gear: 'steel', d: `M${left} ${y}V${foot}M${right} ${y}V${foot}` },
    { layer: 0, gear: 'steel', d: `M${left - 8} ${floor}H${right + 8}` },
    { layer: 3, gear: 'steel', d: `M${left} ${y}H${right}` },
  ]
}

const steel = (d: string): Shape => ({ layer: 0, gear: 'steel', d })
const pad = (d: string): Shape => ({ layer: 0, gear: 'pad', d })

/** Валик тренажёра у лодыжки: `x` — спереди голени (плюс) или сзади (минус). */
export function roller(x: number): Shape[] {
  return [{ layer: 3, gear: 'plate', circle: [x, -4, 3.4] }]
}

/** Платформа жима ногами под подошвой. */
export const PLATFORM: Shape[] = [{ layer: 0, gear: 'plate', d: 'M-9 5.6h26v3.4h-26z' }]

/** Рукоять рычага или блока в кисти: поперёк предплечья. */
export const HANDLE: Shape[] = [{ layer: 3, gear: 'bar', d: 'M-4 0H4' }]

/** Тренажёр для разгибания ног: сиденье со спинкой на стойке. */
export const LEG_EXTENSION: Shape[] = [
  steel(`M46 83V${bottom}M34 ${bottom}H58`),
  pad('M24 78.5H66a2.5 2.5 0 0 1 0 5H24a2.5 2.5 0 0 1 0-5Z'),
  pad('M27.5 78L19.6 44.6a2.5 2.5 0 0 1 4.9-1.1L32.4 77Z'),
  FLOOR,
]

/** Тренажёр жима ногами: спинка под углом и направляющая платформы. */
export const LEG_PRESS: Shape[] = [
  steel(`M62 ${bottom}L108 63M40 ${bottom}H74`),
  pad('M62 101.5L31.5 71a2.5 2.5 0 0 1 3.5-3.5L65.5 98Z'),
  FLOOR,
]

/** Рычажная тяга: сиденье, упор в грудь и стойка, на которой ходит рычаг. */
export const LEVER_ROW: Shape[] = [
  steel(`M40 91V${bottom}M30 ${bottom}H50M57 74V${bottom}M86 20V${bottom}M78 ${bottom}H94`),
  pad('M26 86.5H56a2.5 2.5 0 0 1 0 5H26a2.5 2.5 0 0 1 0-5Z'),
  pad('M54.5 48h5v26h-5z'),
  FLOOR,
]

/** Скамья для гиперэкстензии: упор под бёдра и валик за лодыжками. */
export const HYPER_BENCH: Shape[] = [
  steel(`M64 76V${bottom}M17 104L64 ${bottom}M10 ${bottom}H72`),
  { layer: 0, gear: 'pad', circle: [64, 71.5, 4.6] },
  { layer: 3, gear: 'pad', circle: [14.5, 92, 3.2] },
  FLOOR,
]

/** Брусья спереди: две перекладины с торца на стойках. */
export function dipBars(left: number, right: number, y: number, floor: number): Shape[] {
  const foot = floor - 1.25
  return [
    steel(`M${left} ${y}V${foot}M${right} ${y}V${foot}`),
    steel(`M${left - 12} ${floor}H${right + 12}`),
    { layer: 3, gear: 'steel', circle: [left, y, 2.6] },
    { layer: 3, gear: 'steel', circle: [right, y, 2.6] },
  ]
}

/** Теннисный стол сбоку: столешница с сеткой на ножке. */
export const TABLE: Shape[] = [
  steel(`M80 80H116M98 80V${bottom}M92 ${bottom}H104M100 80V73`),
  FLOOR,
]

/** Ракетка в кисти: вдоль предплечья. */
export const PADDLE: Shape[] = [
  { layer: 3, gear: 'bar', d: 'M0 0V-3' },
  { layer: 3, gear: 'plate', ellipse: [0, -8, 4.2, 5] },
]

/** Канатная рукоять в кисти: вдоль предплечья. */
export const ROPE: Shape[] = [{ layer: 3, gear: 'bar', d: 'M0 1V-5' }]

/** Гриф блока в кисти с торца. */
export const BAR_END: Shape[] = [{ layer: 3, gear: 'hub', circle: [0, 0, 2.8] }]

/** Блочная стойка: мачта с блоком наверху. */
export function cableTower(post: number, pulley: readonly [number, number]): Shape[] {
  return [
    steel(`M${post} ${pulley[1]}V${bottom}M${post - 8} ${bottom}H${post + 8}`),
    steel(`M${post} ${pulley[1]}H${pulley[0]}`),
    { layer: 0, gear: 'steel', circle: [pulley[0], pulley[1], 2.4] },
    FLOOR,
  ]
}

/** Тяга сверху: стойка с блоком над сидящим, сиденье и валик над бёдрами. */
export const LAT_MACHINE: Shape[] = [
  ...cableTower(20, [50, 5]),
  steel(`M46 91V${bottom}M36 ${bottom}H56M64 77V86`),
  pad('M28 86.5H62a2.5 2.5 0 0 1 0 5H28a2.5 2.5 0 0 1 0-5Z'),
  { layer: 3, gear: 'pad', circle: [64, 73.2, 3.6] },
]

/** Тяга к поясу: низкая скамья, упор для стоп и блок на уровне рук. */
export const ROW_MACHINE: Shape[] = [
  steel(`M30 91V${bottom}M22 ${bottom}H38M84 76L90 98M108 30V${bottom}M100 ${bottom}H116`),
  pad('M14 86.5H44a2.5 2.5 0 0 1 0 5H14a2.5 2.5 0 0 1 0-5Z'),
  { layer: 0, gear: 'steel', circle: [106, 58, 2.4] },
  FLOOR,
]

/** Беговая дорожка: полотно под ногами и стойка с поручнем. */
export const TREADMILL: Shape[] = [
  steel('M90 106L98 56M90 60H104'),
  pad('M16 106H96a2.25 2.25 0 0 1 0 4.5H16a2.25 2.25 0 0 1 0-4.5Z'),
  { ...FLOOR, d: 'M10 112.6H108' },
]

/** Велотренажёр: седло, рама, маховик и руль. */
export const BIKE: Shape[] = [
  steel(`M45 70L58 92L84 94M58 92V${bottom}M88 96L93 47M88 47H98M40 ${bottom}H100`),
  { layer: 0, gear: 'steel', circle: [84, 94, 11] },
  { layer: 0, gear: 'steel', circle: [58, 92, 2.4] },
  pad('M37 67.5H51a2 2 0 0 1 0 4H37a2 2 0 0 1 0-4Z'),
  FLOOR,
]

/** Педаль под стопой: у эллипса и велотренажёра. */
export const PEDAL: Shape[] = [{ layer: 0, gear: 'plate', d: 'M-5 5.4h17v2.6h-17z' }]

/** Эллипс: кожух маховика сзади, направляющие и стойка с рукоятями. */
export const ELLIPTICAL: Shape[] = [
  steel(`M24 104H90M86 ${bottom}L90 30M84 34H96M14 ${bottom}H98`),
  { layer: 0, gear: 'steel', circle: [22, 94, 12] },
  FLOOR,
]

/** Гребной тренажёр: направляющая, упор для стоп и маховик. */
export const ROWER: Shape[] = [
  steel(`M14 101.5H92M20 101.5V${bottom}M88 86L94 104M98 96V${bottom}`),
  { layer: 0, gear: 'steel', circle: [100, 82, 12] },
  FLOOR,
]

/** Сиденье гребного тренажёра: едет вместе с тазом. */
export const SLIDING_SEAT: Shape[] = [{ layer: 0, gear: 'pad', d: 'M-8 7.2h15v3.4h-15z' }]
