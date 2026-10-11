import type { Schemas } from '@/api/client'

export type Frame = Schemas['ErrorFrameIn']

/** Столько кадров уходит в отчёт — ближайшие к месту сбоя. */
const MAX_FRAMES = 30

// Формы полей — те же, что проверяет сервер (инвариант I9). Кадр, который в них не
// укладывается, отбрасывается здесь: иначе из-за него сервер отклонил бы весь отчёт.
const SCRIPT = /^[A-Za-z0-9_.@/-]{1,157}\.(js|mjs|jsx|ts|tsx)$/
const FUNCTION = /^[A-Za-z0-9_$.<>]{0,80}$/

// Chrome: `    at name (https://host/assets/a.js:1:2)` или `    at https://host/assets/a.js:1:2`.
const V8 = /^\s*at (?:(.*?) \()?(\S+?):(\d+):(\d+)\)?$/
// Safari и Firefox: `name@https://host/assets/a.js:1:2`.
const GECKO = /^(.*?)@(\S+?):(\d+):(\d+)$/

/** Путь скрипта приложения без адреса сайта и строки запроса; всё прочее — `null`. */
function scriptPath(location: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(location)
  } catch {
    return null
  }
  // Чужой скрипт — например, расширение браузера — к приложению не относится.
  if (url.origin !== origin) return null
  const path = url.pathname.replace(/^\/+/, '')
  return SCRIPT.test(path) ? path : null
}

/** Имя функции одним словом: `async foo`, `new Foo`, `foo [as bar]` → `foo`, `Foo`, `foo`. */
function functionName(raw: string): string {
  const name =
    raw
      .replace(/ \[as .*]$/, '')
      .split(/[\s*]/)
      .at(-1) ?? ''
  return FUNCTION.test(name) ? name : ''
}

/**
 * Стек исключения → кадры «файл, строка, колонка, функция» в скриптах приложения,
 * ближайший к сбою — первым. Текст ошибки, с которого стек начинается в Chrome, в
 * кадры не попадает.
 */
export function parseStack(stack: string, origin: string): Frame[] {
  const lines = stack.split('\n')
  const pattern = lines.some((line) => /^\s*at /.test(line)) ? V8 : GECKO
  const frames: Frame[] = []
  for (const line of lines) {
    const match = pattern.exec(line)
    const file = match && scriptPath(match[2], origin)
    if (!match || !file) continue
    frames.push({
      file,
      line: Number(match[3]),
      column: Number(match[4]),
      function: functionName(match[1] ?? ''),
    })
    if (frames.length === MAX_FRAMES) break
  }
  return frames
}
