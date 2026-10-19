import { useQuery } from '@tanstack/react-query'

import type { LabReport, LabValue } from '@/lib/labs'
import { LAB_COPY, labCopy, labReportsOffline } from '@/offline/labs'
import { readOr, readThrough, write } from '@/offline/queue'
import { offlineState } from '@/offline/store'

import { api, type Schemas } from './client'

export type LabAnalyteList = Schemas['LabAnalyteListOut']

/** Бланки со значениями: любое изменение анализов сбрасывает их. */
export const LAB_REPORTS_KEY = ['lab-reports'] as const

/** Свои показатели и справочник штатных. */
export const LAB_ANALYTES_KEY = ['lab-analytes'] as const

const NO_ANALYTES: LabAnalyteList = { analytes: [], catalog: [] }

/** Свои показатели вместе с убранными и справочник штатных — с сервера или из копии. */
export function useLabAnalytes() {
  return useQuery({
    queryKey: LAB_ANALYTES_KEY,
    networkMode: 'always',
    queryFn: async () =>
      (await readThrough(LAB_COPY.analytes, () => api.GET('/api/lab-analytes'))) ?? NO_ANALYTES,
  })
}

/**
 * Все бланки со значениями, новые первыми: с сервера, а без сети и пока очередь не пуста —
 * по копии, где они лежат целиком вместе с тем, чего сервер ещё не видел (ADR 0020).
 */
export function useLabReports() {
  return useQuery({
    queryKey: LAB_REPORTS_KEY,
    networkMode: 'always',
    queryFn: async () => {
      const { online, queued } = offlineState.get()
      const load = async () => {
        const result = await api.GET('/api/lab-reports')
        // Ответ экрана тоже наполняет копию: связь может пропасть до фонового обновления.
        if (result.data && offlineState.get().queued === 0)
          await labCopy.replaceReports({
            etag: result.response.headers.get('ETag'),
            items: result.data,
          })
        return result
      }
      return (
        (online && queued === 0
          ? await readOr(load, labReportsOffline)
          : await labReportsOffline()) ?? []
      )
    },
  })
}

type ReportRef = Pick<LabReport, 'id' | 'local_date' | 'lab'>

export async function saveLabReport(id: string, body: Schemas['LabReportIn']) {
  return write<LabReport>(
    {
      method: 'PUT',
      path: '/api/lab-reports/{report_id}',
      params: { report_id: id },
      body,
      context: { kind: 'labReport', localDate: body.local_date, lab: { lab: body.lab ?? null } },
    },
    () => labCopy.saveReport(id, body),
  )
}

export async function deleteLabReport(report: ReportRef) {
  return write(
    {
      method: 'DELETE',
      path: '/api/lab-reports/{report_id}',
      params: { report_id: report.id },
      context: { kind: 'labReportRemove', localDate: report.local_date, lab: { lab: report.lab } },
    },
    () => labCopy.removeReport(report.id),
  )
}

export async function saveLabValue(report: ReportRef, id: string, body: Schemas['LabValueIn']) {
  return write<LabValue>(
    {
      method: 'PUT',
      path: '/api/lab-reports/{report_id}/values/{value_id}',
      params: { report_id: report.id, value_id: id },
      body,
      context: {
        kind: 'labValue',
        localDate: report.local_date,
        lab: {
          lab: report.lab,
          preset: body.preset ?? null,
          analyteId: body.analyte_id ?? null,
          value: Number(body.value),
          unit: body.unit ?? null,
        },
      },
    },
    () => labCopy.saveValue(report.id, id, body),
  )
}

export async function deleteLabValue(report: ReportRef, value: LabValue) {
  return write(
    {
      method: 'DELETE',
      path: '/api/lab-reports/{report_id}/values/{value_id}',
      params: { report_id: report.id, value_id: value.id },
      context: {
        kind: 'labValueRemove',
        localDate: report.local_date,
        lab: {
          lab: report.lab,
          preset: value.preset,
          analyteId: value.analyte_id,
          value: value.original_value,
          unit: value.original_unit,
        },
      },
    },
    () => labCopy.removeValue(report.id, value.id),
  )
}

/** Свой показатель: заводит, переименовывает или возвращает убранный в список. */
export async function saveLabAnalyte(id: string, body: Schemas['LabAnalyteIn']) {
  return write<Schemas['LabAnalyteOut']>(
    {
      method: 'PUT',
      path: '/api/lab-analytes/{analyte_id}',
      params: { analyte_id: id },
      body,
      context: { kind: 'labAnalyte', lab: { analyteId: id, name: body.name } },
    },
    () => labCopy.saveAnalyte(id, body),
  )
}

/** Убирает свой показатель из списка; значения в бланках остаются. */
export async function deleteLabAnalyte(analyte: Schemas['LabAnalyteOut']) {
  return write(
    {
      method: 'DELETE',
      path: '/api/lab-analytes/{analyte_id}',
      params: { analyte_id: analyte.id },
      context: { kind: 'labAnalyteRemove', lab: { analyteId: analyte.id, name: analyte.name } },
    },
    () => labCopy.removeAnalyte(analyte.id),
  )
}
