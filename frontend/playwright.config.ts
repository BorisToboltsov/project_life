import path from 'node:path'

import { defineConfig, devices } from '@playwright/test'

// Камеры у прогона нет: браузер показывает странице этот видеофайл со штрихкодом. Пишет его
// e2e/global-setup.ts перед прогоном.
const cameraVideo = path.resolve(import.meta.dirname, 'node_modules/.tmp/camera.y4m')

// Смоук идёт против собранного стенда из deploy/compose.yaml: Caddy → статика и /api → бэкенд → БД.
export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  metadata: { cameraVideo },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    trace: 'retain-on-failure',
    // Доступ к «камере» браузер даёт без вопроса.
    permissions: ['camera'],
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${cameraVideo}`,
      ],
    },
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
})
