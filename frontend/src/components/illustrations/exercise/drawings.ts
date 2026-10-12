import type { Schemas } from '@/api/client'

import {
  BAR_END,
  bench,
  benchFromAbove,
  BIKE,
  cableTower,
  dipBars,
  DUMBBELL_END,
  DUMBBELL_SIDE,
  ELLIPTICAL,
  HANDLE,
  HYPER_BENCH,
  KETTLEBELL,
  KETTLEBELL_AT_CHEST,
  LAT_MACHINE,
  LEG_EXTENSION,
  LEG_PRESS,
  LEVER_ROW,
  PADDLE,
  PEDAL,
  plate,
  PLATFORM,
  pullUpBar,
  pullUpFrame,
  roller,
  ROPE,
  ROW_MACHINE,
  ROWER,
  SLIDING_SEAT,
  step,
  TABLE,
  TREADMILL,
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
/** Сидя на скамье: таз на подушке, бёдра вперёд, голени вниз, стопы на полу. */
const SEAT = [46, 80.5] as const
const SEATED = { s: 0, t: -88, u: 0, h: 0, g: 0 }

/**
 * Рисунки техники штатных упражнений: две позы и снаряд. Рисунок обязан быть у каждого:
 * новое штатное упражнение без него не скомпилируется.
 */
export const DRAWINGS: Record<ExercisePreset, Figure> = {
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
  seated_front_raise: sideFigure({
    root: 'hip',
    at: SEAT,
    poses: [
      { ...SEATED, a: 178, f: 174 },
      { ...SEATED, a: 88, f: 86 },
    ],
    grip: true,
    held: DUMBBELL_END,
    world: bench(28, 62, 86.5),
  }),
  seated_dumbbell_press: sideFigure({
    root: 'hip',
    at: SEAT,
    poses: [
      { ...SEATED, a: 165, f: 5 },
      { ...SEATED, a: 6, f: 2 },
    ],
    grip: true,
    held: DUMBBELL_SIDE,
    world: bench(28, 62, 86.5),
  }),
  leg_extension: sideFigure({
    root: 'hip',
    at: [40, 72],
    poses: [
      { s: 6, t: -88, u: -12, h: 8, a: 150, f: 150, g: 0 },
      { s: -84, t: -88, u: -12, h: 8, a: 150, f: 150, g: -80 },
    ],
    grip: true,
    onShin: roller(5.5),
    world: LEG_EXTENSION,
  }),
  lying_leg_curl: sideFigure({
    root: 'hip',
    at: [58, 79.5],
    poses: [
      { s: 90, t: 90, u: 90, h: -20, a: 110, f: 80, g: 160 },
      { s: 150, t: 90, u: 90, h: -20, a: 110, f: 80, g: 220 },
    ],
    grip: true,
    onShin: roller(-5.5),
    // Лёжа человек длиннее обычного кадра.
    world: bench(32, 98, 86.5),
    viewBox: '-12 -9 136 136',
  }),
  leg_press: sideFigure({
    root: 'hip',
    at: [52, 90],
    poses: [
      { s: -84, t: -183, u: -45, h: 10, a: 140, f: 120, g: -135 },
      { s: -135, t: -135, u: -45, h: 10, a: 140, f: 120, g: -135 },
    ],
    grip: true,
    onFoot: PLATFORM,
    world: LEG_PRESS,
  }),
  lever_row: sideFigure({
    root: 'hip',
    at: [40, 80.5],
    poses: [
      { ...SEATED, u: 6, a: 92, f: 90 },
      { ...SEATED, u: 6, a: 210, f: 95 },
    ],
    grip: true,
    held: HANDLE,
    cable: [86, 22],
    world: LEVER_ROW,
  }),
  back_extension: sideFigure({
    root: 'hip',
    at: [56, 64],
    poses: [
      { s: 45, t: 45, u: 110, h: -30, a: 260, f: 100, g: 45 },
      { s: 45, t: 45, u: 45, h: 0, a: 195, f: 35, g: 45 },
    ],
    grip: true,
    world: HYPER_BENCH,
  }),
  dip: frontFigure({
    hang: { out: 2, far: -37, near: -16 },
    grip: true,
    world: dipBars(46.8, 73.2, 62.6, 146),
    viewBox: '-15 -2 150 150',
  }),
  crunch: sideFigure({
    root: 'hip',
    at: [60, 101.9],
    poses: [
      { s: -25, t: -137.4, u: -90, b: 0, h: 0, a: 85, f: -50, g: 0 },
      { s: -25, t: -137.4, u: -90, b: 28, h: 12, a: 113, f: -22, g: 0 },
    ],
  }),
  russian_twist: sideFigure({
    root: 'hip',
    at: [48, 101.7],
    poses: [
      { s: -35, t: -130, u: -35, b: -5, h: 4, a: 138, f: 58, g: 0 },
      { s: -35, t: -130, u: -35, b: 5, h: -4, a: 166, f: 96, g: 0 },
    ],
    arm: [16, 14],
    grip: true,
    held: plate(6),
  }),
  table_tennis: sideFigure({
    root: 'foot',
    at: [38, 105.5],
    poses: [
      { s: 14, t: -22, u: 22, h: -12, a: 205, f: 150 },
      { s: 12, t: -18, u: 16, h: -8, a: 118, f: 52 },
    ],
    grip: true,
    held: PADDLE,
    world: TABLE,
  }),
  rope_pushdown: sideFigure({
    root: 'foot',
    at: [48, 105.5],
    poses: [
      { s: 4, t: -3, u: 8, h: -4, a: 176, f: 40 },
      { s: 4, t: -3, u: 8, h: -4, a: 176, f: 172 },
    ],
    grip: true,
    held: ROPE,
    cable: [70, 7],
    world: cableTower(90, [70, 7]),
  }),
  lat_pulldown: sideFigure({
    root: 'hip',
    at: SEAT,
    poses: [
      { ...SEATED, u: -8, h: 6, a: 10, f: 5 },
      { ...SEATED, u: -8, h: 6, a: 150, f: 0 },
    ],
    grip: true,
    held: BAR_END,
    cable: [50, 5],
    world: LAT_MACHINE,
  }),
  seated_cable_row: sideFigure({
    root: 'hip',
    at: [30, 80.5],
    poses: [
      { s: -60, t: -100, u: 12, h: -8, a: 95, f: 92, g: -70 },
      { s: -60, t: -100, u: -6, h: 4, a: 215, f: 98, g: -70 },
    ],
    grip: true,
    held: HANDLE,
    cable: [106, 58],
    world: ROW_MACHINE,
  }),
  dumbbell_lunge: sideFigure({
    root: 'hip',
    at: [
      [48.6, 57.9],
      [45.6, 76.5],
    ],
    poses: [
      { s: -14, t: -26, u: 2, h: 0, a: 178, f: 176, g: 0 },
      { s: 12, t: -80, u: 5, h: -3, a: 178, f: 176, g: 0 },
    ],
    farLeg: [
      { s: 45, t: 28, g: 70 },
      { s: 100, t: 10, g: 80 },
    ],
    grip: true,
    held: DUMBBELL_END,
  }),
  treadmill_walk: sideFigure({
    root: 'hip',
    at: [50, 50.5],
    poses: [
      { s: -18, t: -22, u: 3, h: 0, a: 200, f: 186, g: -15 },
      { s: 38, t: 18, u: 3, h: 0, a: 160, f: 122, g: 35 },
    ],
    farLeg: [
      { s: 38, t: 18, g: 35 },
      { s: -18, t: -22, g: -15 },
    ],
    world: TREADMILL,
  }),
  exercise_bike: sideFigure({
    root: 'hip',
    at: [44, 62],
    poses: [
      { s: 28.4, t: -94.4, u: 30, h: -22, a: 110, f: 100, g: 10 },
      { s: 22.6, t: -65.2, u: 30, h: -22, a: 110, f: 100, g: -5 },
    ],
    farLeg: [
      { s: 22.6, t: -65.2, g: -5 },
      { s: 28.4, t: -94.4, g: 10 },
    ],
    grip: true,
    onFoot: PEDAL,
    world: BIKE,
  }),
  elliptical: sideFigure({
    root: 'hip',
    at: [50, 52],
    poses: [
      { s: 7.1, t: -35.5, u: 6, h: -2, a: 172, f: 72, g: -5 },
      { s: 22.3, t: 5.5, u: 6, h: -2, a: 150, f: 96, g: 15 },
    ],
    farLeg: [
      { s: 22.3, t: 5.5, g: 15 },
      { s: 7.1, t: -35.5, g: -5 },
    ],
    grip: true,
    onFoot: PEDAL,
    world: ELLIPTICAL,
  }),
  rowing_machine: sideFigure({
    root: 'hip',
    at: [
      [56, 92],
      [38, 92],
    ],
    poses: [
      { s: -23.8, t: -136.6, u: 25, h: -16, a: 100, f: 98, g: -70 },
      { s: -59.5, t: -109.6, u: -20, h: 12, a: 215, f: 95, g: -70 },
    ],
    grip: true,
    held: HANDLE,
    seat: SLIDING_SEAT,
    cable: [98, 72],
    world: ROWER,
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
