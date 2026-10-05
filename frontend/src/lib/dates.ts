// Даты в интерфейсе всегда идут в порядке «день, месяц, год» (инвариант I7) — на любом
// языке и независимо от настроек браузера.

/**
 * Локаль форматирования для языка интерфейса. Английский — британский: в американском
 * месяц стоит перед днём, а время 12-часовое.
 */
const LOCALES: Record<string, string> = { ru: 'ru-RU', en: 'en-GB' }

/** Дата и время в языке интерфейса и часовом поясе пользователя (ADR 0003). */
export function formatDateTime(iso: string, language: string, timeZone: string): string {
  return new Intl.DateTimeFormat(LOCALES[language] ?? language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso))
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const DISPLAY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
/** Длины частей в поле ввода: день, месяц, год. */
const LENGTHS = [2, 2, 4]

/** `ГГГГ-ММ-ДД` → `ДД/ММ/ГГГГ` для поля ввода; всё прочее — пустая строка. */
export function isoToDisplay(iso: string): string {
  const match = ISO.exec(iso)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

/**
 * Текст поля → значение формы: пустая строка («дата не указана»), `ГГГГ-ММ-ДД` или,
 * если дата недописана, сам текст — он не пройдёт `isRealDate`, и форма покажет ошибку.
 */
export function displayToIso(text: string): string {
  const trimmed = text.trim()
  const match = DISPLAY.exec(trimmed)
  if (!match) return trimmed
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`
}

/**
 * Приводит набираемый текст к виду `ДД/ММ/ГГГГ`: оставляет цифры, любые разделители
 * заменяет на «/» и сам переносит лишние цифры в следующую часть, так что дату можно
 * набрать одними цифрами: `17051990` → `17/05/1990`.
 */
export function formatDateInput(text: string): string {
  // Разделитель до первой цифры ничего не значит.
  const typed = text.replace(/^\D+/, '').split(/\D+/)
  const parts: string[] = []
  let carry = ''
  for (const [index, length] of LENGTHS.entries()) {
    const digits = carry + (typed[index] ?? '')
    carry = digits.slice(length)
    // Часть появляется, если в ней есть цифры или пользователь уже поставил после неё разделитель.
    if (digits !== '' || index < typed.length - 1) parts.push(digits.slice(0, length))
    else break
  }
  const endsWithSeparator = /\D$/.test(text) && parts.length < LENGTHS.length
  return parts.join('/') + (endsWithSeparator && parts.length > 0 ? '/' : '')
}

/** Существующая календарная дата в виде `ГГГГ-ММ-ДД`: 31 февраля и 13-й месяц не проходят. */
export function isRealDate(iso: string): boolean {
  const date = isoToLocalDate(iso)
  if (!date) return false
  // Date молча переносит лишние дни в следующий месяц — сверяем, что ничего не «уехало».
  return localDateToIso(date) === iso
}

/** `ГГГГ-ММ-ДД` → полночь этого дня по местному времени (так с датами работает календарь). */
export function isoToLocalDate(iso: string): Date | undefined {
  const match = ISO.exec(iso)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  // Конструктор считает годы 0–99 двадцатым веком.
  date.setFullYear(Number(match[1]))
  return date
}

/** Местная дата → `ГГГГ-ММ-ДД`. Не через toISOString: тот сдвинул бы день на пояс. */
export function localDateToIso(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
