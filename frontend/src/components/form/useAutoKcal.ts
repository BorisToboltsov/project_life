import { type ChangeEvent, useRef } from 'react'

import { kcalFromMacros, kcalIsTyped, type MacroTexts } from '@/lib/nutrition'

type Values = MacroTexts & { kcal: string }

/**
 * Калории следуют за БЖУ, пока их не ввели руками: поле пересчитывается при каждой правке
 * белков, жиров или углеводов. Введённое число остаётся как есть; стёртое — снова считается.
 */
export function useAutoKcal({
  initial,
  digits,
  read,
  write,
}: {
  /** С чем открыта форма: калории, которые расходятся с расчётом, считаются введёнными. */
  initial: Values
  /** Сколько знаков после запятой у калорий. */
  digits: number
  /** Что сейчас набрано в полях БЖУ. */
  read: () => MacroTexts
  /** Записывает расчёт в поле калорий. */
  write: (kcal: string) => void
}) {
  const typed = useRef(kcalIsTyped(initial, digits))

  function follow() {
    if (!typed.current) write(kcalFromMacros(read(), digits))
  }

  return {
    /** Обработчики поля калорий. */
    kcal: {
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        typed.current = event.target.value.trim() !== ''
      },
      // Стёртое поле заполняется расчётом, когда из него вышли, а не под пальцами.
      onBlur: follow,
    },
    /** Вызывается после правки белков, жиров или углеводов. */
    follow,
    /** Форму заполнили целиком другими значениями — например, подсказкой расчёта. */
    reset(values: Values) {
      typed.current = kcalIsTyped(values, digits)
    },
  }
}
