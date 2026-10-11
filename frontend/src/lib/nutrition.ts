// Питание: запись чисел, калории по БЖУ для форм и подсказка цели на день. Съеденное
// считает сервер; здесь — только вывод и расчёты для полей ввода.

import { formatNumber, parseDecimal } from './numbers'

/** Калории показываются целыми: десятые в итоге дня никому не нужны. */
export function formatKcal(value: number, language: string): string {
  return formatNumber(value, language, 0)
}

/** Граммы — до десятой. */
export function formatGrams(value: number, language: string): string {
  return formatNumber(value, language, 1)
}

/** Доля цели от 0 до 1 для шкалы; без цели шкала пуста. */
export function share(eaten: number, goal: number): number {
  return goal > 0 ? Math.min(eaten / goal, 1) : 0
}

export type Activity = 'sedentary' | 'light' | 'moderate' | 'high'
export type Aim = 'lose' | 'maintain' | 'gain'

export const ACTIVITIES: Activity[] = ['sedentary', 'light', 'moderate', 'high']
export const AIMS: Aim[] = ['lose', 'maintain', 'gain']

/** Во сколько раз суточный расход больше основного обмена. */
const ACTIVITY_FACTOR: Record<Activity, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
}

/** Дефицит 15 % для снижения веса, профицит 10 % для набора. */
const AIM_FACTOR: Record<Aim, number> = { lose: 0.85, maintain: 1, gain: 1.1 }

/** Доли энергии: белки 20 %, жиры 30 %, углеводы 50 %. */
const PROTEIN_SHARE = 0.2
const FAT_SHARE = 0.3
/** Килокалорий в грамме белков, жиров и углеводов — те же, что на сервере. */
const KCAL_PER_G = { protein: 4, fat: 9, carbs: 4 }

/** Белки, жиры и углеводы так, как они набраны в полях формы. */
export interface MacroTexts {
  protein: string
  fat: string
  carbs: string
}

/**
 * Число из поля, которое ещё набирают: «12,» читается как 12 — расчёт не пропадает на миг
 * перед дробной частью.
 */
function typedNumber(text: string): number | null {
  return parseDecimal(text.trim().replace(/[.,]$/, ''))
}

/** Сколько энергии дают набранные БЖУ; пустое или нечисловое поле — ноль. */
export function macrosEnergy(texts: MacroTexts): number {
  const grams = (text: string) => typedNumber(text) ?? 0
  return (
    grams(texts.protein) * KCAL_PER_G.protein +
    grams(texts.fat) * KCAL_PER_G.fat +
    grams(texts.carbs) * KCAL_PER_G.carbs
  )
}

/**
 * Калории по набранным БЖУ — текстом для поля, с точностью до `digits` знаков. Пока хоть
 * одно из трёх не число, считать не из чего: пусто.
 */
export function kcalFromMacros(texts: MacroTexts, digits: number): string {
  if ([texts.protein, texts.fat, texts.carbs].some((text) => typedNumber(text) === null)) {
    return ''
  }
  const factor = 10 ** digits
  return String(Math.round(macrosEnergy(texts) * factor) / factor)
}

/** Калории введены руками, если они есть и расходятся с расчётом по БЖУ. */
export function kcalIsTyped(values: MacroTexts & { kcal: string }, digits: number): boolean {
  return values.kcal.trim() !== '' && values.kcal !== kcalFromMacros(values, digits)
}

export interface Body {
  sex: 'male' | 'female'
  age: number
  heightCm: number
  weightKg: number
}

export interface Targets {
  kcal: number
  protein_g: number
  fat_g: number
  carbs_g: number
}

/** Полных лет на дату `today`; обе даты — `ГГГГ-ММ-ДД`. */
export function ageOn(birthDate: string, today: string): number {
  const years = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4))
  return today.slice(5) < birthDate.slice(5) ? years - 1 : years
}

/**
 * Ориентир цели на день. Основной обмен — по формуле Миффлина — Сан-Жеора, дальше
 * поправка на образ жизни и на цель. Калории округлены до десятков, углеводы — остаток,
 * округлённый вниз: вместе БЖУ не дают больше калорий, чем сама цель.
 */
export function suggestTargets(body: Body, activity: Activity, aim: Aim): Targets {
  const basal =
    10 * body.weightKg + 6.25 * body.heightCm - 5 * body.age + (body.sex === 'male' ? 5 : -161)
  const kcal = Math.round((basal * ACTIVITY_FACTOR[activity] * AIM_FACTOR[aim]) / 10) * 10
  const protein_g = Math.round((kcal * PROTEIN_SHARE) / KCAL_PER_G.protein)
  const fat_g = Math.round((kcal * FAT_SHARE) / KCAL_PER_G.fat)
  const rest = kcal - protein_g * KCAL_PER_G.protein - fat_g * KCAL_PER_G.fat
  return { kcal, protein_g, fat_g, carbs_g: Math.max(0, Math.floor(rest / KCAL_PER_G.carbs)) }
}
