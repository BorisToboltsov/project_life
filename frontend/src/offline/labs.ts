import type { Schemas } from '@/api/client'
import { labCanonical, type LabReport, type LabValue } from '@/lib/labs'

import { copy } from './copy'

type AnalyteList = Schemas['LabAnalyteListOut']

/** Ключи копии анализов (ADR 0020). */
export const LAB_COPY = {
  analytes: 'lab-analytes',
  reports: 'lab-reports',
} as const

/** Все бланки со значениями, новые первыми, и метка, с которой их отдал сервер. */
export interface LabReportsCopy {
  etag: string | null
  items: LabReport[]
}

/**
 * Порядок сервера: новые дни первыми. В одном дне сервер ставит первым созданный позже —
 * ключ UUIDv7 растёт со временем создания, поэтому порядок тот же.
 */
const newestFirst = (a: LabReport, b: LabReport) =>
  b.local_date.localeCompare(a.local_date) || b.id.localeCompare(a.id)

/** Бланки по копии — тот же ответ, что `GET /api/lab-reports`. */
export async function labReportsOffline(): Promise<LabReport[]> {
  return (await copy.get<LabReportsCopy>(LAB_COPY.reports))?.items ?? []
}

async function edit(change: (items: LabReport[]) => LabReport[]): Promise<void> {
  await copy.update<LabReportsCopy>(LAB_COPY.reports, (current) =>
    current
      ? { ...current, etag: null, items: change(current.items).sort(newestFirst) }
      : undefined,
  )
}

async function editAnalytes(change: (list: AnalyteList) => AnalyteList): Promise<void> {
  await copy.update<AnalyteList>(LAB_COPY.analytes, (current) =>
    current ? change(current) : undefined,
  )
}

/** Значение так, как его вернул бы сервер: у штатного — ещё и в канонической единице. */
async function valueOf(id: string, body: Schemas['LabValueIn']): Promise<LabValue> {
  const original = Number(body.value)
  const unit = body.unit ?? null
  const catalog = (await copy.get<AnalyteList>(LAB_COPY.analytes))?.catalog ?? []
  const preset = catalog.find((item) => item.code === body.preset)
  const optional = (bound: number | string | null | undefined) =>
    bound === null || bound === undefined ? null : Number(bound)
  return {
    id,
    preset: body.preset ?? null,
    analyte_id: body.analyte_id ?? null,
    value: preset && unit ? labCanonical(preset, original, unit) : original,
    original_value: original,
    original_unit: unit,
    ref_low: optional(body.ref_low),
    ref_high: optional(body.ref_high),
  }
}

const blankToNull = (text: string | null | undefined) => text?.trim() || null

/** Изменения анализов в копии — те же, что делает сервер (ADR 0020). */
export const labCopy = {
  async saveReport(id: string, body: Schemas['LabReportIn']): Promise<void> {
    await edit((items) => {
      const values = items.find((item) => item.id === id)?.values ?? []
      const report: LabReport = {
        id,
        local_date: body.local_date,
        lab: blankToNull(body.lab),
        note: blankToNull(body.note),
        values,
      }
      return [...items.filter((item) => item.id !== id), report]
    })
  },

  async removeReport(id: string): Promise<void> {
    await edit((items) => items.filter((item) => item.id !== id))
  },

  async saveValue(reportId: string, id: string, body: Schemas['LabValueIn']): Promise<void> {
    const value = await valueOf(id, body)
    await edit((items) =>
      items.map((report) => {
        if (report.id !== reportId) return report
        const known = report.values.some((item) => item.id === id)
        return {
          ...report,
          values: known
            ? report.values.map((item) => (item.id === id ? value : item))
            : [...report.values, value],
        }
      }),
    )
  },

  async removeValue(reportId: string, id: string): Promise<void> {
    await edit((items) =>
      items.map((report) =>
        report.id === reportId
          ? { ...report, values: report.values.filter((item) => item.id !== id) }
          : report,
      ),
    )
  },

  async saveAnalyte(id: string, body: Schemas['LabAnalyteIn']): Promise<void> {
    const analyte = { id, name: body.name.trim(), unit: body.unit.trim(), archived: false }
    await editAnalytes((list) => {
      const known = list.analytes.some((item) => item.id === id)
      return {
        ...list,
        analytes: known
          ? list.analytes.map((item) => (item.id === id ? analyte : item))
          : [...list.analytes, analyte],
      }
    })
  },

  async removeAnalyte(id: string): Promise<void> {
    await editAnalytes((list) => ({
      ...list,
      analytes: list.analytes.map((item) => (item.id === id ? { ...item, archived: true } : item)),
    }))
  },

  /** Все бланки, как их отдал сервер. */
  async replaceReports(next: LabReportsCopy): Promise<void> {
    await copy.put(LAB_COPY.reports, next)
  },
}
