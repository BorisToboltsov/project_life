import type { Schemas } from '@/api/client'

import { bench, DUMBBELL_END, plate, pullUpFrame } from './gear'
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
  lateral_raise: frontFigure({
    poses: [
      { a: 172, f: 176 },
      { a: 96, f: 92 },
    ],
    grip: true,
    held: DUMBBELL_END,
  }),
}
