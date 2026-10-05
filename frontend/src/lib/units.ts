// Пересчёт единиц на границе интерфейса: в API и в базе рост всегда в сантиметрах (ADR 0004).

const CM_PER_INCH = 2.54
const INCHES_PER_FOOT = 12

export interface FeetInches {
  feet: number
  inches: number
}

export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH)
  return { feet: Math.floor(totalInches / INCHES_PER_FOOT), inches: totalInches % INCHES_PER_FOOT }
}

export function feetInchesToCm({ feet, inches }: FeetInches): number {
  const cm = (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH
  return Math.round(cm * 10) / 10
}
