import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

import i18n from '@/i18n'

import { resetApp } from './app'
import { removeCamera } from './camera'

vi.mock('@/components/chart/LineChart', async () => ({
  default: (await import('./chartStub')).ChartStub,
}))

// jsdom не умеет прокручивать окно, а роутер делает это при каждом переходе.
window.scrollTo = () => {}

beforeEach(async () => {
  await i18n.changeLanguage('ru')
})

afterEach(() => {
  cleanup()
  resetApp()
  vi.unstubAllGlobals()
  removeCamera()
  vi.restoreAllMocks()
  localStorage.clear()
  window.location.hash = ''
})
