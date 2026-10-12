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
