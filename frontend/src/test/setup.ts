import '@testing-library/jest-dom/vitest'
// IndexedDB для копии и очереди без сети (ADR 0020): в jsdom её нет.
import 'fake-indexeddb/auto'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import i18n from '@/i18n'
import { offlineSession } from '@/offline/session'

import { resetApp } from './app'
import { removeCamera } from './camera'

vi.mock('@/components/chart/LineChart', async () => ({
  default: (await import('./chartStub')).ChartStub,
}))

// jsdom не умеет прокручивать окно, а роутер делает это при каждом переходе.
window.scrollTo = () => {}

// `findBy…` и `waitFor` по умолчанию ждут секунду — на загруженной машине экран появляется
// позже. Пять секунд втрое меньше `testTimeout`: несбывшееся ожидание по-прежнему
// показывает DOM, а не обрывается таймаутом теста.
configure({ asyncUtilTimeout: 5000 })

beforeEach(async () => {
  await i18n.changeLanguage('ru')
})

afterEach(async () => {
  cleanup()
  await offlineSession.erase()
  resetApp()
  vi.unstubAllGlobals()
  removeCamera()
  vi.restoreAllMocks()
  localStorage.clear()
  window.location.hash = ''
})
