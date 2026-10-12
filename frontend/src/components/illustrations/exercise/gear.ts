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
