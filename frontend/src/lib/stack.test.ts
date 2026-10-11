import { describe, expect, it } from 'vitest'

import { parseStack } from './stack'

const ORIGIN = 'https://life.example.com'

describe('parseStack', () => {
  it('разбирает стек Chrome и не берёт из него текст ошибки', () => {
    const stack = [
      "TypeError: Cannot read properties of undefined (reading 'weight')",
      `    at Zr (${ORIGIN}/assets/index-B3x9.js:45:12345)`,
      `    at ${ORIGIN}/assets/index-B3x9.js:45:999`,
      `    at async save (${ORIGIN}/assets/index-B3x9.js:46:7)`,
      `    at new Chart (${ORIGIN}/assets/LineChart-Qw12.js:2:30)`,
      `    at Object.onClick [as handler] (${ORIGIN}/assets/index-B3x9.js:50:1)`,
      `    at HTMLButtonElement.<anonymous> (${ORIGIN}/assets/index-B3x9.js:51:2)`,
    ].join('\n')

    expect(parseStack(stack, ORIGIN)).toEqual([
      { file: 'assets/index-B3x9.js', line: 45, column: 12345, function: 'Zr' },
      { file: 'assets/index-B3x9.js', line: 45, column: 999, function: '' },
      { file: 'assets/index-B3x9.js', line: 46, column: 7, function: 'save' },
      { file: 'assets/LineChart-Qw12.js', line: 2, column: 30, function: 'Chart' },
      { file: 'assets/index-B3x9.js', line: 50, column: 1, function: 'Object.onClick' },
      {
        file: 'assets/index-B3x9.js',
        line: 51,
        column: 2,
        function: 'HTMLButtonElement.<anonymous>',
      },
    ])
  })

  it('разбирает стек Safari и Firefox', () => {
    const stack = [
      `Zr@${ORIGIN}/assets/index-B3x9.js:45:12345`,
      `@${ORIGIN}/assets/index-B3x9.js:45:999`,
      `async*save@${ORIGIN}/assets/index-B3x9.js:46:7`,
      `render/<@${ORIGIN}/assets/index-B3x9.js:47:8`,
    ].join('\n')

    expect(parseStack(stack, ORIGIN)).toEqual([
      { file: 'assets/index-B3x9.js', line: 45, column: 12345, function: 'Zr' },
      { file: 'assets/index-B3x9.js', line: 45, column: 999, function: '' },
      { file: 'assets/index-B3x9.js', line: 46, column: 7, function: 'save' },
      { file: 'assets/index-B3x9.js', line: 47, column: 8, function: '' },
    ])
  })

  it('отбрасывает строку запроса у адреса скрипта', () => {
    const stack = `Error: x\n    at load (${ORIGIN}/src/pages/HomePage.tsx?t=1760000000000:12:5)`

    expect(parseStack(stack, ORIGIN)).toEqual([
      { file: 'src/pages/HomePage.tsx', line: 12, column: 5, function: 'load' },
    ])
  })

  it('оставляет только скрипты приложения', () => {
    const stack = [
      'Error: anna@example.com:1:2',
      '    at <anonymous>',
      '    at eval (eval at run (https://life.example.com/assets/a.js:1:2), <anonymous>:1:1)',
      '    at inject (chrome-extension://abcdef/content.js:1:2)',
      '    at other (https://elsewhere.example.com/assets/a.js:1:2)',
      `    at inline (${ORIGIN}/measurements/weight/0199b7a0-0000-7000-8000-000000000001:3:4)`,
      '    at local (/Users/anna/project/src/main.tsx:1:2)',
    ].join('\n')

    expect(parseStack(stack, ORIGIN)).toEqual([])
  })

  it('в стеке без «at» текст ошибки не принимает за кадр', () => {
    expect(parseStack('weight of anna@example.com:72:4', ORIGIN)).toEqual([])
    expect(parseStack('', ORIGIN)).toEqual([])
  })

  it('берёт только ближайшие к сбою кадры', () => {
    const stack = Array.from(
      { length: 40 },
      (_, index) => `    at f${index} (${ORIGIN}/assets/a.js:${index + 1}:1)`,
    ).join('\n')

    const frames = parseStack(stack, ORIGIN)

    expect(frames).toHaveLength(30)
    expect(frames[0].function).toBe('f0')
    expect(frames.at(-1)?.function).toBe('f29')
  })
})
