// Анализы на границе интерфейса (ADR 0022): отметка «вне референса», пересчёт в
// каноническую единицу для графика и подстановка референса из прошлого бланка.

import type { Schemas } from '@/api/client'

export type LabPreset = Schemas['LabPreset']
export type LabUnit = Schemas['LabUnit']
export type LabGroup = Schemas['LabGroup']
export type LabReport = Schemas['LabReportOut']
export type LabValue = Schemas['LabValueOut']
export type LabPresetInfo = Schemas['LabPresetOut']
export type OwnAnalyte = Schemas['LabAnalyteOut']

/** Значение анализа в своём бланке. */
export interface LabEntry {
  report: LabReport
  value: LabValue
}

/** Сколько знаков после запятой показывать: бланки печатают до тысячных (ТТГ 0,005). */
export const LAB_DIGITS = 4

/**
 * Ключ показателя — код штатного или ключ своего: им показатель назван в адресе экрана и
 * по нему значения разных бланков собираются в одну историю.
 */
export function keyOf(value: Pick<LabValue, 'preset' | 'analyte_id'>): string {
  return value.preset ?? value.analyte_id ?? ''
}

/** Где значение относительно референса бланка. */
export type Mark = 'low' | 'high' | null

/**
 * Отметка «вне референса» (инвариант I22): ниже нижней границы или выше верхней; границы
 * входят в референс. Нет границы — сравнивать не с чем: встроенных норм нет.
 */
export function referenceMark(value: number, low: number | null, high: number | null): Mark {
  if (low !== null && value < low) return 'low'
  if (high !== null && value > high) return 'high'
  return null
}

/** Отметка значения: число и границы — в единице бланка. */
export function markOf(value: Pick<LabValue, 'original_value' | 'ref_low' | 'ref_high'>): Mark {
  return referenceMark(value.original_value, value.ref_low, value.ref_high)
}

/** Сколько канонических единиц штатного показателя в одной `unit`; единицы нет — 1. */
export function factorOf(preset: LabPresetInfo, unit: LabUnit | null): number {
  return preset.units.find((item) => item.unit === unit)?.factor ?? 1
}

/** Значение в канонической единице штатного показателя — как его хранит сервер. */
export function labCanonical(preset: LabPresetInfo, value: number, unit: LabUnit): number {
  return Math.round(value * factorOf(preset, unit) * 10_000) / 10_000
}

/** Лаборатории совпадают, если совпадают их названия без учёта регистра и пробелов. */
function sameLab(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLocaleLowerCase() === (b ?? '').trim().toLocaleLowerCase()
}

/** Все значения показателя по бланкам, новые первыми — в порядке бланков. */
export function historyOf(reports: readonly LabReport[], key: string): LabEntry[] {
  return reports.flatMap((report) =>
    report.values.filter((value) => keyOf(value) === key).map((value) => ({ report, value })),
  )
}

/**
 * Прошлое значение показателя, чей референс подставляется в новое: сначала из той же
 * лаборатории, иначе — самое свежее. Бланк, в который вносят, не учитывается.
 */
export function previousEntry(
  reports: readonly LabReport[],
  key: string,
  current: Pick<LabReport, 'id' | 'lab'>,
): LabEntry | undefined {
  const earlier = historyOf(reports, key).filter((entry) => entry.report.id !== current.id)
  return earlier.find((entry) => sameLab(entry.report.lab, current.lab)) ?? earlier[0]
}

/** Лаборатории своих бланков — для подсказки в поле: от недавних к давним, без повторов. */
export function knownLabs(reports: readonly LabReport[]): string[] {
  const seen = new Map<string, string>()
  for (const report of reports) {
    const name = report.lab?.trim()
    if (name && !seen.has(name.toLocaleLowerCase())) seen.set(name.toLocaleLowerCase(), name)
  }
  return [...seen.values()]
}

/** Последнее значение каждого показателя, у которого они есть. */
export function latestByAnalyte(reports: readonly LabReport[]): Map<string, LabEntry> {
  const latest = new Map<string, LabEntry>()
  for (const report of reports) {
    for (const value of report.values) {
      if (!latest.has(keyOf(value))) latest.set(keyOf(value), { report, value })
    }
  }
  return latest
}

/** Сколько значений бланка вне референса. */
export function outOfRange(report: LabReport): number {
  return report.values.filter((value) => markOf(value) !== null).length
}
