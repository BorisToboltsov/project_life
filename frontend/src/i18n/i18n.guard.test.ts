import { describe, expect, it } from 'vitest'

import { dictionaries } from './index'

type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') result.set(path, value)
    else for (const [nested, text] of leaves(value, path)) result.set(nested, text)
  }
  return result
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1]).sort()
}

// Гейт i18n: любой ключ существует во всех словарях, не пуст и несёт те же подстановки.
describe('словари', () => {
  const reference = leaves(dictionaries.ru)

  for (const [language, dictionary] of Object.entries(dictionaries)) {
    const translated = leaves(dictionary)

    it(`${language}: тот же набор ключей, что и в эталоне`, () => {
      expect([...translated.keys()].sort()).toEqual([...reference.keys()].sort())
    })

    it(`${language}: нет пустых переводов`, () => {
      const empty = [...translated].filter(([, text]) => text.trim() === '').map(([key]) => key)
      expect(empty).toEqual([])
    })

    it(`${language}: подстановки совпадают с эталоном`, () => {
      for (const [key, text] of translated) {
        expect(placeholders(text), key).toEqual(placeholders(reference.get(key) ?? ''))
      }
    })
  }
})
