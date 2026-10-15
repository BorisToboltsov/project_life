import { describe, expect, it } from 'vitest'

import { workoutLocalTime, workoutMoment } from './workoutTime'

describe('время тренировки в часовом поясе профиля', () => {
  it('показывает и сохраняет московское время независимо от пояса устройства', () => {
    expect(workoutLocalTime('2026-10-15T12:30:00Z', 'Europe/Moscow')).toBe('15:30')
    expect(workoutMoment('2026-10-15', '15:30', 'Europe/Moscow')).toBe('2026-10-15T12:30:00.000Z')
  })

  it('отклоняет несуществующее время при переводе часов', () => {
    expect(workoutMoment('2026-03-29', '02:30', 'Europe/Berlin')).toBeUndefined()
  })
})
