import type { FullConfig } from '@playwright/test'

import { CAMERA_BARCODE, writeCameraVideo } from './barcode.ts'

/** Перед прогоном готовит кадр для поддельной камеры браузера (см. playwright.config.ts). */
export default function globalSetup(config: FullConfig): void {
  writeCameraVideo(CAMERA_BARCODE, config.metadata.cameraVideo as string)
}
