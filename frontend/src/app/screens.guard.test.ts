import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
})

// Статический импорт из каталога экранов; `import type` не в счёт — в сборку он не попадает.
const STATIC_IMPORT = /import\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"](?:@\/|(?:\.\.\/)+)pages\//
const LAZY_IMPORT = /import\(\s*['"]@\/pages\//g

// Гейт I12: экран приходит при переходе, а не с первой загрузкой.
describe('экраны подгружаются лениво', () => {
  it('вне каталога экранов никто не импортирует экран статически', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.startsWith('/src/pages/') && !path.startsWith('/src/test/'))
      .filter(([path, code]) => !path.includes('.test.') && STATIC_IMPORT.test(code))
      .map(([path]) => path)

    expect(Object.keys(sources).length).toBeGreaterThan(50)
    expect(offenders).toEqual([])
  })

  it('маршруты подключают экраны через import()', () => {
    const router = sources['/src/app/router.tsx']

    // Проверка выше не должна пройти по пустому месту: экраны в маршрутах есть.
    expect(router.match(LAZY_IMPORT)?.length).toBeGreaterThanOrEqual(20)
  })
})
