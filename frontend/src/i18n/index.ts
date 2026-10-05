import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import { en } from './en'
import { ru } from './ru'

export const dictionaries = { ru, en }

export type Language = keyof typeof dictionaries

export const LANGUAGES = Object.keys(dictionaries) as Language[]

// Самоназвания языков не переводятся: в любом интерфейсе русский — «Русский».
export const LANGUAGE_NAMES: Record<Language, string> = { ru: 'Русский', en: 'English' }

const STORAGE_KEY = 'life.language'

function isLanguage(value: string | null | undefined): value is Language {
  return LANGUAGES.includes(value as Language)
}

export function detectLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    // Хранилище недоступно (приватный режим) — определяем по браузеру.
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export async function setLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language)
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Выбор не сохранится между запусками, но в текущем сеансе язык уже переключён.
  }
}

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof ru }
  }
}

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
