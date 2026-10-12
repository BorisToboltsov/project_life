import { describe, expect, it } from 'vitest'

import { GROUPS, inGroup, KINDS, MUSCLES } from './exerciseText'

describe('метки групп мышц', () => {
  it('«Все» подходит любому упражнению', () => {
    expect(inGroup({ kind: 'time', muscles: [] }, 'all')).toBe(true)
  })

  it.each([
    ['quads', 'legs'],
    ['calves', 'legs'],
    ['chest', 'chest'],
    ['lower_back', 'back'],
    ['delts', 'shoulders'],
    ['forearms', 'arms'],
    ['obliques', 'core'],
  ] as const)('%s → %s', (muscle, group) => {
    const others = GROUPS.filter((item) => item !== 'all' && item !== group)

    expect(inGroup({ kind: 'weight_reps', muscles: [muscle] }, group)).toBe(true)
    expect(others.some((item) => inGroup({ kind: 'reps', muscles: [muscle] }, item))).toBe(false)
  })

  it('кардио стоит только под своей меткой', () => {
    const walk = { kind: 'cardio', muscles: ['quads', 'glutes'] } as const

    expect(inGroup({ ...walk, muscles: [...walk.muscles] }, 'cardio')).toBe(true)
    expect(inGroup({ ...walk, muscles: [...walk.muscles] }, 'legs')).toBe(false)
  })

  it('упражнение без мышц под метки групп не попадает', () => {
    expect(GROUPS.filter((group) => inGroup({ kind: 'time', muscles: [] }, group))).toEqual(['all'])
  })

  it('форма предлагает все виды подхода и все мышцы', () => {
    expect(KINDS).toHaveLength(4)
    expect(new Set(MUSCLES).size).toBe(14)
  })
})
