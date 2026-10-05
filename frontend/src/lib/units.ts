// Пересчёт единиц на границе интерфейса (ADR 0004). В API и в базе значения лежат в
// канонических единицах: килограммы и сантиметры. В единицу, в которой пользователь ввёл
// значение, его пересчитывает сервер; здесь — только вывод в единицах профиля.

import type { Schemas } from '@/api/client'

export type Unit = Schemas['Unit']
export type Quantity = Schemas['Quantity']
export type UnitSystem = Schemas['UnitSystem']
type Measurement = Schemas['MeasurementOut']

const CM_PER_INCH = 2.54
const KG_PER_POUND = 0.45359237
const INCHES_PER_FOOT = 12

/** Сколько канонических единиц в одной данной. */
const CANONICAL_PER_UNIT: Record<Unit, number> = {
  kg: 1,
  lb: KG_PER_POUND,
  cm: 1,
  in: CM_PER_INCH,
}

const DISPLAY_UNITS: Record<UnitSystem, Record<Quantity, Unit>> = {
  metric: { mass: 'kg', length: 'cm' },
  imperial: { mass: 'lb', length: 'in' },
}

/** Единица, в которой величину видит и вводит пользователь с такой системой единиц. */
export function displayUnit(quantity: Quantity, system: UnitSystem): Unit {
  return DISPLAY_UNITS[system][quantity]
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Значение в единице `unit` → в канонической единице той же величины. */
export function toCanonical(value: number, unit: Unit): number {
  return round(value * CANONICAL_PER_UNIT[unit], 3)
}

/** Каноническое значение → в единице `unit`, с точностью до десятой. */
export function fromCanonical(value: number, unit: Unit): number {
  return round(value / CANONICAL_PER_UNIT[unit], 1)
}

/**
 * Значение измерения в единице `unit`. Если оно в ней и было введено, возвращается ровно
 * введённое число, без следов пересчёта туда и обратно.
 */
export function measuredIn(measurement: Measurement, unit: Unit): number {
  if (measurement.original_unit === unit) return measurement.original_value
  return fromCanonical(measurement.value, unit)
}

export interface FeetInches {
  feet: number
  inches: number
}

export function cmToFeetInches(cm: number): FeetInches {
  const totalInches = Math.round(cm / CM_PER_INCH)
  return { feet: Math.floor(totalInches / INCHES_PER_FOOT), inches: totalInches % INCHES_PER_FOOT }
}

export function feetInchesToCm({ feet, inches }: FeetInches): number {
  return round((feet * INCHES_PER_FOOT + inches) * CM_PER_INCH, 1)
}
