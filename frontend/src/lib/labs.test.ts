import { expect, it } from 'vitest'
import { hemoglobin, labReport, labValue, REPORT_ID } from '@/test/health'
import {
  referenceMark,
  markOf,
  labCanonical,
  previousEntry,
  historyOf,
  knownLabs,
  latestByAnalyte,
  outOfRange,
} from './labs'

it.each([
  [119, 120, 160, 'low'],
  [161, 120, 160, 'high'],
  [120, 120, 160, null],
  [160, 120, 160, null],
  [0, null, null, null],
  [4, null, 3, 'high'],
  [0, 1, null, 'low'],
] as const)('референс %s [%s, %s] → %s', (value, low, high, mark) => {
  expect(referenceMark(value, low, high)).toBe(mark)
})
it('отметка сравнивает исходное число, а график переводит единицы', () => {
  expect(
    markOf(labValue({ original_value: 14.2, original_unit: 'g_dl', ref_low: 12, ref_high: 16 })),
  ).toBeNull()
  expect(labCanonical(hemoglobin, 14.2, 'g_dl')).toBe(142)
})
it('референс предпочитает ту же лабораторию, история и последние значения не смешивают показатели', () => {
  const newer = labReport({ id: 'new', lab: 'Другая', values: [labValue({ original_value: 155 })] })
  const older = labReport({
    id: 'old',
    lab: ' инВИТРО ',
    values: [labValue({ original_value: 100 })],
  })
  const reports = [newer, older, labReport()]
  expect(previousEntry(reports, 'hemoglobin', { id: REPORT_ID, lab: 'Инвитро' })?.report.id).toBe(
    'old',
  )
  expect(
    previousEntry(reports, 'hemoglobin', { id: REPORT_ID, lab: 'Неизвестная' })?.report.id,
  ).toBe('new')
  expect(previousEntry(reports, 'glucose', { id: REPORT_ID, lab: null })).toBeUndefined()
  expect(historyOf(reports, 'hemoglobin')).toHaveLength(3)
  expect(latestByAnalyte(reports).get('hemoglobin')?.value.original_value).toBe(155)
  expect(knownLabs(reports)).toEqual(['Другая', 'инВИТРО'])
  expect(outOfRange(older)).toBe(1)
})
