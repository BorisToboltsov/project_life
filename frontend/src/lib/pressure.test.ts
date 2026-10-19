import { expect, it } from 'vitest'
import { pressureReading } from '@/test/health'
import { aboveHomeLimit, weekAverage } from './pressure'
import { pressureSchema, pressureBody, pressureDefaults } from '@/pages/measurements/pressureValues'

it.each([
  [134, 84, false],
  [135, 80, true],
  [120, 85, true],
  [150, 95, true],
] as const)('порог %s/%s → %s', (systolic, diastolic, expected) => {
  expect(aboveHomeLimit({ systolic, diastolic })).toBe(expected)
})
it('среднее берёт семь календарных дней, пропуски пульса не становятся нулями', () => {
  const rows = [
    pressureReading({ local_date: '2026-10-19', systolic: 140, pulse: 70 }),
    pressureReading({ local_date: '2026-10-13', systolic: 120 }),
    pressureReading({ local_date: '2026-10-12', systolic: 200 }),
    pressureReading({ local_date: '2026-10-20', systolic: 200 }),
  ]
  expect(weekAverage(rows, '2026-10-19')).toEqual({
    systolic: 130,
    diastolic: 82,
    pulse: 70,
    count: 2,
  })
  expect(weekAverage([], '2026-10-19')).toBeNull()
  expect(weekAverage([rows[1]!], '2026-10-19')?.pulse).toBeNull()
})
it('форма валидирует пару, диапазоны, время и переводит пояс профиля', () => {
  const values = { date: '2026-01-01', time: '12:30', systolic: '128', diastolic: '82', pulse: '' }
  expect(pressureSchema.safeParse(values).success).toBe(true)
  for (const bad of [
    { systolic: '82' },
    { systolic: '301' },
    { diastolic: '24' },
    { pulse: '19' },
    { time: '99:99' },
    { date: '2026-02-30' },
  ])
    expect(pressureSchema.safeParse({ ...values, ...bad }).success).toBe(false)
  expect(pressureBody(values, 'Europe/Moscow')).toEqual({
    measured_at: '2026-01-01T09:30:00.000Z',
    local_date: '2026-01-01',
    systolic: 128,
    diastolic: 82,
    pulse: null,
  })
  expect(
    pressureBody({ ...values, date: '2026-03-29', time: '02:30' }, 'Europe/Berlin'),
  ).toBeUndefined()
  expect(
    pressureDefaults(
      pressureReading({ measured_at: '2026-01-01T09:30:00Z', local_date: '2026-01-01' }),
      'Europe/Moscow',
    ).time,
  ).toBe('12:30')
})

it('округление среднего для вывода не меняет сравнение с порогом', () => {
  const average = weekAverage(
    [
      pressureReading({ systolic: 134, diastolic: 80 }),
      pressureReading({ systolic: 135, diastolic: 80 }),
    ],
    pressureReading().local_date,
  )!
  expect(average.systolic).toBe(134.5)
  expect(aboveHomeLimit(average)).toBe(false)
})
