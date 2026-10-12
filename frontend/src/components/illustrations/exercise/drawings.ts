import type { Schemas } from '@/api/client'

import {
  bench,
  benchFromAbove,
  DUMBBELL_END,
  DUMBBELL_SIDE,
  KETTLEBELL,
  KETTLEBELL_AT_CHEST,
  plate,
  pullUpBar,
  pullUpFrame,
  step,
} from './gear'
import { type Figure, frontFigure, type Pose, sideFigure } from './rig'

type ExercisePreset = Schemas['ExercisePreset']

/** Штанга на плечах: хват шире плеч, сбоку рука видна короче настоящей. */
const UNDER_BAR = { arm: [15, 13.5], grip: true } as const
const underBar = (pose: Omit<Pose, 'a' | 'f'>): Pose => ({
  ...pose,
  a: pose.u + 207,
  f: pose.u + 365.5,
})

/** Где стоят стопы на рисунках стоя. */
const FEET = [50, 105.5] as const
const STANDING = { s: 3, t: -1, u: 1, h: 0 }

/**
 * Рисунки техники штатных упражнений: две позы и снаряд. У упражнения без рисунка
 * показывается общий — гантель.
 */
export const DRAWINGS: Partial<Record<ExercisePreset, Figure>> = {
  barbell_squat: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [underBar(STANDING), underBar({ s: 28, t: -84, u: 40, h: -28 })],
    ...UNDER_BAR,
    back: plate(),
  }),
  deadlift: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { s: 2, t: 0, u: 0, h: 0, a: 179, f: 178 },
      { s: 12, t: -70, u: 70, h: -44, a: 180, f: 180 },
    ],
    grip: true,
    held: plate(),
  }),
  dumbbell_bench_press: sideFigure({
    root: 'hip',
    at: [62, 76],
    poses: [
      { s: -5, t: -79, u: -90, h: 0, a: 3, f: 0, g: 0 },
      { s: -5, t: -79, u: -90, h: 0, a: 105, f: -3, g: 0 },
    ],
    arm: [16, 15.4],
    grip: true,
    held: DUMBBELL_END,
    world: bench(10, 80, 84.5),
  }),
  plank: sideFigure({
    root: 'hip',
    at: [63.3, 90.9],
    poses: [
      { s: 84, t: 82, u: 83, h: 0, a: 180, f: 90, g: 90 },
      { s: 84, t: 82, u: 83, h: 0, a: 180, f: 90, g: 90 },
    ],
    grip: true,
  }),
  pull_up: frontFigure({
    hang: { out: 7.8, far: 37.5, near: 6 },
    grip: true,
    // Вис выше обычного кадра: рисунок мельче, пол ниже.
    world: pullUpFrame(27, 93, -11.9, 127),
    viewBox: '-21 -32 162 162',
  }),
  goblet_squat: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { ...STANDING, a: 168, f: 12 },
      { s: 27, t: -84, u: 28, h: -20, a: 196, f: 40 },
    ],
    arm: [16, 13],
    grip: true,
    held: KETTLEBELL_AT_CHEST,
  }),
  romanian_deadlift: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { s: 2, t: 0, u: 0, h: 0, a: 179, f: 178 },
      { s: -3, t: -38, u: 70, h: -42, a: 180, f: 180 },
    ],
    grip: true,
    held: plate(),
  }),
  barbell_row: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { s: 8, t: -30, u: 65, h: -40, a: 180, f: 180 },
      { s: 8, t: -30, u: 65, h: -40, a: 250, f: 170 },
    ],
    grip: true,
    held: plate(8.5),
  }),
  overhead_press: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { s: 2, t: -1, u: 0, h: 0, a: 150, f: -12 },
      { s: 2, t: -1, u: -2, h: 4, a: 6, f: 2 },
    ],
    grip: true,
    held: plate(8.5),
    // Гриф уходит над головой — кадр выше обычного.
    viewBox: '-13 -25 140 140',
  }),
  ez_bar_curl: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { ...STANDING, a: 178, f: 172 },
      { ...STANDING, a: 172, f: 22 },
    ],
    grip: true,
    held: plate(7),
  }),
  hammer_curl: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { ...STANDING, a: 178, f: 172 },
      { ...STANDING, a: 172, f: 22 },
    ],
    grip: true,
    held: DUMBBELL_SIDE,
  }),
  kettlebell_swing: sideFigure({
    root: 'foot',
    at: FEET,
    poses: [
      { s: 10, t: -42, u: 58, h: -36, a: 212, f: 206 },
      { s: 3, t: -1, u: -2, h: 2, a: 84, f: 82 },
    ],
    grip: true,
    held: KETTLEBELL,
  }),
  calf_raise: sideFigure({
    root: 'hip',
    at: [
      [48, 49.5],
      [48, 44.1],
    ],
    poses: [
      { s: 3, t: -1, u: 1, h: 0, a: 179, f: 176, g: 0 },
      { s: 3, t: -1, u: 1, h: 0, a: 179, f: 176, g: 25 },
    ],
    grip: true,
    held: DUMBBELL_END,
    world: step(51, 66),
    // Человек стоит на подставке и поднимается ещё выше — кадр сдвинут вверх.
    viewBox: '0 -9 120 120',
  }),
  lateral_overhead_raise: frontFigure({
    poses: [
      { a: 172, f: 176 },
      { a: 14, f: 8 },
    ],
    grip: true,
    held: DUMBBELL_END,
    // Гантели сходятся над головой — кадр выше обычного.
    viewBox: '-12 -22 144 144',
  }),
  bench_press: sideFigure({
    root: 'hip',
    at: [62, 76],
    poses: [
      { s: -5, t: -79, u: -90, h: 0, a: 3, f: 0, g: 0 },
      { s: -5, t: -79, u: -90, h: 0, a: 105, f: -3, g: 0 },
    ],
    arm: [16, 15.4],
    grip: true,
    held: plate(),
    world: bench(10, 80, 84.5),
  }),
  french_press: sideFigure({
    root: 'hip',
    at: [62, 76],
    poses: [
      { s: -5, t: -79, u: -90, h: 0, a: -6, f: -4, g: 0 },
      { s: -5, t: -79, u: -90, h: 0, a: -14, f: -104, g: 0 },
    ],
    grip: true,
    held: plate(7),
    world: bench(10, 80, 84.5),
  }),
  // Вид сверху: человек лежит на скамье, руки расходятся в стороны.
  dumbbell_fly: frontFigure({
    poses: [
      { a: 96, f: -70 },
      { a: 98, f: 92 },
    ],
    grip: true,
    held: DUMBBELL_END,
    world: benchFromAbove(43, 77, 3.5, 78),
  }),
  push_up: sideFigure({
    root: 'hand',
    at: [91, 106.7],
    poses: [
      { s: 76, t: 75, u: 75, h: 0, a: 180, f: 180, g: 90 },
      { s: 86, t: 85, u: 85, h: 0, a: 255, f: 142, g: 90 },
    ],
    arm: [14, 15.4],
    grip: true,
  }),
  glute_bridge: sideFigure({
    root: 'foot',
    at: [92, 105.5],
    poses: [
      { s: -25, t: -137.4, u: -90, h: 0, a: 92, f: 90 },
      { s: -14, t: -112.6, u: -112.6, h: 22, a: 95, f: 92 },
    ],
  }),
  hanging_leg_raise: sideFigure({
    root: 'hand',
    at: [58, 14],
    poses: [
      { s: 3, t: -3, u: 1, h: -6, a: 0, f: 0, g: 70 },
      { s: -86, t: -88, u: -6, h: 0, a: 4, f: 0, g: -76 },
    ],
    arm: [17, 15.4],
    grip: true,
    // Вис с прямыми ногами выше обычного кадра: рисунок мельче, пол ниже.
    world: pullUpBar(58, 14, 143),
    viewBox: '-18 -5 152 152',
  }),
  lateral_raise: frontFigure({
    poses: [
      { a: 172, f: 176 },
      { a: 96, f: 92 },
    ],
    grip: true,
    held: DUMBBELL_END,
  }),
}
