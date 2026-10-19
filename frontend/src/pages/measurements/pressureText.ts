import { useTranslation } from 'react-i18next'
import type { PressureReading } from '@/lib/pressure'

/** «128/82» — верхнее и нижнее через косую черту. */
export function usePressureText() {
  const { t } = useTranslation()
  return (reading: Pick<PressureReading, 'systolic' | 'diastolic'>) =>
    t('pressure.value', {
      systolic: Math.round(reading.systolic),
      diastolic: Math.round(reading.diastolic),
    })
}
