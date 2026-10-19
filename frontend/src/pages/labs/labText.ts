import { useTranslation } from 'react-i18next'

import { LAB_DIGITS, type LabPresetInfo, type LabValue, type OwnAnalyte } from '@/lib/labs'
import { formatNumber } from '@/lib/numbers'

/** Показатель по ключу: штатный — из справочника, свой — из списка пользователя. */
export type Analyte = { kind: 'preset'; info: LabPresetInfo } | { kind: 'own'; analyte: OwnAnalyte }

export function analyteOf(
  key: string,
  catalog: readonly LabPresetInfo[],
  analytes: readonly OwnAnalyte[],
): Analyte | undefined {
  const info = catalog.find((item) => item.code === key)
  if (info) return { kind: 'preset', info }
  const analyte = analytes.find((item) => item.id === key)
  return analyte ? { kind: 'own', analyte } : undefined
}

/** Название показателя: штатного — на языке интерфейса, своего — как его назвали. */
export function useAnalyteName() {
  const { t } = useTranslation()
  return (analyte: Analyte | undefined): string =>
    analyte?.kind === 'preset'
      ? t(`labAnalytes.${analyte.info.code}`)
      : (analyte?.analyte.name ?? '')
}

/** Название значения по его показателю. */
export function useValueName() {
  const { t } = useTranslation()
  return (value: Pick<LabValue, 'preset' | 'analyte_id'>, analytes: readonly OwnAnalyte[]) =>
    value.preset
      ? t(`labAnalytes.${value.preset}`)
      : (analytes.find((item) => item.id === value.analyte_id)?.name ?? '')
}

/** Единица значения так, как на бланке: штатного — по коду, своего — из показателя. */
export function useValueUnit() {
  const { t } = useTranslation()
  return (
    value: Pick<LabValue, 'original_unit' | 'analyte_id'>,
    analytes: readonly OwnAnalyte[],
  ) =>
    value.original_unit
      ? t(`labUnits.${value.original_unit}`)
      : (analytes.find((item) => item.id === value.analyte_id)?.unit ?? '')
}

/** Число анализа в записи языка интерфейса — до десятитысячных, как на бланке. */
export function useLabNumber() {
  const { i18n } = useTranslation()
  return (value: number) => formatNumber(value, i18n.language, LAB_DIGITS)
}

/** Референс текстом: «120 – 160», «до 5,2», «от 1,0»; без границ — пусто. */
export function useReferenceText() {
  const { t } = useTranslation()
  const number = useLabNumber()
  return (low: number | null, high: number | null): string => {
    if (low !== null && high !== null)
      return t('labs.range', { low: number(low), high: number(high) })
    if (low !== null) return t('labs.rangeFrom', { low: number(low) })
    if (high !== null) return t('labs.rangeTo', { high: number(high) })
    return ''
  }
}
