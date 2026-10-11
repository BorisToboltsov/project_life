import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { stubCamera } from '@/test/camera'

import { BarcodeScanner } from './BarcodeScanner'

function setVisibility(state: 'visible' | 'hidden') {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

describe('сканер штрихкода', () => {
  it('включает заднюю камеру, находит штрихкод товара и выключает камеру', async () => {
    const camera = stubCamera()
    const onDetected = vi.fn<(barcode: string) => void>()
    render(<BarcodeScanner onDetected={onDetected} />)

    expect(screen.getByRole('status')).toHaveTextContent('Включаем камеру…')
    expect(await screen.findByText('Наведите камеру на штрихкод на упаковке.')).toBeInTheDocument()
    expect(camera.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
    })
    expect(screen.getByLabelText('Изображение с камеры')).toBeVisible()
    expect(camera.isOff()).toBe(false)

    camera.show('4600000000008')

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('4600000000008'))
    expect(onDetected).toHaveBeenCalledTimes(1)
    expect(camera.isOff()).toBe(true)
  })

  it('пропускает то, что не штрихкод товара, и приводит UPC-A к EAN-13', async () => {
    const camera = stubCamera()
    const onDetected = vi.fn<(barcode: string) => void>()
    render(<BarcodeScanner onDetected={onDetected} />)
    await screen.findByText('Наведите камеру на штрихкод на упаковке.')

    // Считано с ошибкой: контрольная цифра не сходится — ждём следующий кадр.
    camera.show('4600000000000', 'https://example.com')
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(onDetected).not.toHaveBeenCalled()
    expect(camera.isOff()).toBe(false)

    camera.show('мусор', '036000291452')

    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('0036000291452'))
  })

  it('выключает камеру, когда сканер убран с экрана', async () => {
    const camera = stubCamera()
    const { unmount } = render(<BarcodeScanner onDetected={vi.fn<(barcode: string) => void>()} />)
    await screen.findByText('Наведите камеру на штрихкод на упаковке.')

    unmount()

    expect(camera.isOff()).toBe(true)
  })

  it('выключает камеру, если сканер закрыли, пока она включалась', async () => {
    const camera = stubCamera()
    const { unmount } = render(<BarcodeScanner onDetected={vi.fn<(barcode: string) => void>()} />)

    unmount()

    await waitFor(() => expect(camera.tracks).toHaveLength(1))
    await waitFor(() => expect(camera.isOff()).toBe(true))
  })

  it('свёрнутое приложение камеру не держит, развёрнутое — включает снова', async () => {
    const camera = stubCamera()
    const onDetected = vi.fn<(barcode: string) => void>()
    render(<BarcodeScanner onDetected={onDetected} />)
    await screen.findByText('Наведите камеру на штрихкод на упаковке.')

    setVisibility('hidden')
    expect(camera.isOff()).toBe(true)

    setVisibility('visible')
    await waitFor(() => expect(camera.tracks).toHaveLength(2))
    camera.show('46012340')
    await waitFor(() => expect(onDetected).toHaveBeenCalledWith('46012340'))
  })

  it('без доступа к камере говорит, как быть', async () => {
    stubCamera(new DOMException('denied', 'NotAllowedError'))
    render(<BarcodeScanner onDetected={vi.fn<(barcode: string) => void>()} />)

    expect(
      await screen.findByText(
        'Нет доступа к камере. Разрешите его в настройках браузера или введите штрихкод цифрами.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Изображение с камеры')).not.toBeVisible()
  })

  it.each([
    ['камеры нет', new DOMException('no camera', 'NotFoundError')],
    ['браузер не даёт камеру странице', 'absent' as const],
  ])('%s — сканер недоступен', async (_name, access) => {
    stubCamera(access)
    render(<BarcodeScanner onDetected={vi.fn<(barcode: string) => void>()} />)

    expect(
      await screen.findByText('Сканер недоступен. Введите штрихкод цифрами.'),
    ).toBeInTheDocument()
  })
})
