import type { Schemas } from '@/api/client'
import { today } from '@/lib/dates'
import type { LabReport, LabValue, LabPresetInfo } from '@/lib/labs'
import type { PressureReading } from '@/lib/pressure'

export const REPORT_ID = '0199b7a0-0000-7000-8000-00000000ab01'
export const VALUE_ID = '0199b7a0-0000-7000-8000-00000000ab02'
export const OWN_ID = '0199b7a0-0000-7000-8000-00000000ab03'
export const hemoglobin: LabPresetInfo = {
  code: 'hemoglobin',
  group: 'cbc',
  unit: 'g_l',
  min_value: 0,
  max_value: 300,
  units: [
    { unit: 'g_l', factor: 1 },
    { unit: 'g_dl', factor: 10 },
  ],
}
export const ownAnalyte = { id: OWN_ID, name: 'Антитела', unit: 'МЕ/мл', archived: false }
export const labCatalog: Schemas['LabAnalyteListOut'] = {
  catalog: [hemoglobin],
  analytes: [ownAnalyte],
}
export function labValue(fields: Partial<LabValue> = {}): LabValue {
  return {
    id: VALUE_ID,
    preset: 'hemoglobin',
    analyte_id: null,
    value: 142,
    original_value: 142,
    original_unit: 'g_l',
    ref_low: 120,
    ref_high: 160,
    ...fields,
  }
}
export function labReport(fields: Partial<LabReport> = {}): LabReport {
  return {
    id: REPORT_ID,
    local_date: today(),
    lab: 'Инвитро',
    note: null,
    values: [labValue()],
    ...fields,
  }
}
export function pressureReading(fields: Partial<PressureReading> = {}): PressureReading {
  return {
    id: VALUE_ID,
    local_date: today(),
    measured_at: `${today()}T09:00:00Z`,
    systolic: 128,
    diastolic: 82,
    pulse: null,
    ...fields,
  }
}
export const pressureMetric: Schemas['MetricOut'] = {
  id: OWN_ID,
  preset: 'blood_pressure',
  name: null,
  quantity: 'pressure',
  unit: 'mmhg',
  min_value: 50,
  max_value: 300,
  archived: false,
}
