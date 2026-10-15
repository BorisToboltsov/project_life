import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { Schemas } from '@/api/client'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { stubCamera } from '@/test/camera'
import { anna, cottageCheese, diaryDay, meals, noLabel, noPortions } from '@/test/fixtures'

const DATE = '2026-10-11'
const MEAL = `/diary/${DATE}/add/${meals.breakfast.id}`
const PAGE = `${MEAL}/scan`
const BARCODE = '4600000000008'
const LOOKUP = 'POST /api/products/lookup'
const SUGGESTIONS = 'GET /api/diary/suggestions'
const SAVE_ENTRY = 'PUT /api/diary/entries/*'
const SAVE_PRODUCT = 'PUT /api/products/*'
const DAY = { 'GET /api/diary': json(200, diaryDay(DATE)) }
const nothing = { in_meal: [], frequent: [], recent: [] }

const scannedCheese: Schemas['ProductOut'] = { ...cottageCheese, barcode: BARCODE }

function lookupOf(
  status: Schemas['LookupStatus'],
  rest: Partial<Schemas['BarcodeLookupOut']> = {},
): Schemas['BarcodeLookupOut'] {
  return { status, barcode: BARCODE, product: null, draft: null, ...rest }
}

async function typeBarcode(barcode: string) {
  await userEvent.type(await screen.findByLabelText('Штрихкод цифрами'), barcode)
  await userEvent.click(screen.getByRole('button', { name: 'Найти' }))
}

describe('сканер по пути в приём пищи', () => {
  it('камера → продукт из каталога → количество из прошлого раза → запись в дневнике', async () => {
    const camera = stubCamera()
    const calls = mockApi({
      ...DAY,
      [LOOKUP]: json(200, lookupOf('found', { product: scannedCheese })),
      'GET /api/products/*': json(200, scannedCheese),
      [SUGGESTIONS]: json(200, { ...nothing, recent: [{ ...scannedCheese, amount: 180 }] }),
      [SAVE_ENTRY]: json(201, {}),
    })
    const { router } = await renderApp(MEAL, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Сканировать штрихкод' }))
    expect(await screen.findByRole('heading', { name: 'Штрихкод' })).toBeInTheDocument()
    await screen.findByText('Наведите камеру на штрихкод на упаковке.')
    camera.show(BARCODE)

    // Продукт найден: сканер закрыт, камера выключена, осталось ввести количество.
    const found = await screen.findByRole('list', { name: 'По штрихкоду' })
    expect(camera.isOff()).toBe(true)
    expect(callsTo(calls, LOOKUP)[0].body).toEqual({ barcode: BARCODE })
    expect(router.state.location.pathname).toBe(MEAL)
    expect(router.state.location.search).toEqual({ scanned: scannedCheese.id })
    expect(within(found).getByText('Творог 5 %')).toBeInTheDocument()
    expect(await within(found).findByLabelText('Сколько, г')).toHaveValue('180')

    await userEvent.click(within(found).getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('Добавлено: Творог 5 %, 180 г')).toBeInTheDocument()
    expect(callsTo(calls, SAVE_ENTRY)[0].body).toEqual({
      local_date: DATE,
      meal_id: meals.breakfast.id,
      product_id: scannedCheese.id,
      amount: 180,
    })
    // Внесённый продукт больше не всплывает первым — и после возврата на экран тоже.
    await waitFor(() =>
      expect(screen.queryByRole('list', { name: 'По штрихкоду' })).not.toBeInTheDocument(),
    )
    expect(router.state.location.search).toEqual({})
  })

  it('штрихкод цифрами → продукт из Open Food Facts с пометкой об источнике', async () => {
    stubCamera('absent')
    const imported = { ...scannedCheese, source: 'open_food_facts' as const }
    const calls = mockApi({
      ...DAY,
      [LOOKUP]: json(200, lookupOf('found', { product: imported })),
      'GET /api/products/*': json(200, imported),
      [SUGGESTIONS]: json(200, nothing),
    })
    await renderApp(PAGE, anna)

    expect(
      await screen.findByText('Сканер недоступен. Введите штрихкод цифрами.'),
    ).toBeInTheDocument()
    // Как на упаковке: с пробелами.
    await typeBarcode('4 600000 000008')

    const found = await screen.findByRole('list', { name: 'По штрихкоду' })
    expect(callsTo(calls, LOOKUP)[0].body).toEqual({ barcode: BARCODE })
    // Продукт новый: количества из прошлого раза нет.
    expect(await within(found).findByLabelText('Сколько, г')).toHaveValue('100')
    expect(
      screen.getByText('Состав взят из Open Food Facts. Сверьте его с упаковкой.'),
    ).toBeInTheDocument()
  })

  it('опечатку в цифрах выдаёт контрольная цифра — на сервер она не уходит', async () => {
    stubCamera()
    const calls = mockApi({ ...DAY })
    await renderApp(PAGE, anna)

    await typeBarcode('4600000000000')

    expect(await screen.findByText('Проверьте штрихкод: 8, 12 или 13 цифр')).toBeInTheDocument()
    expect(callsTo(calls, LOOKUP)).toEqual([])
  })

  it('ненайденный штрихкод открывает форму продукта с ним; сохранённый — вносится', async () => {
    const camera = stubCamera()
    const created = { ...scannedCheese, name: 'Сырок' }
    const calls = mockApi({
      ...DAY,
      [LOOKUP]: json(200, lookupOf('not_found')),
      [SUGGESTIONS]: json(200, nothing),
      [SAVE_PRODUCT]: json(201, created),
      'GET /api/products/*': json(200, created),
    })
    const { router } = await renderApp(PAGE, anna)
    await screen.findByText('Наведите камеру на штрихкод на упаковке.')
    camera.show(BARCODE)

    expect(await screen.findByRole('heading', { name: 'Новый продукт' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      `Штрихкод ${BARCODE} не найден. Заполните состав с упаковки — в следующий раз продукт найдётся сразу.`,
    )
    expect(camera.isOff()).toBe(true)
    expect(screen.getByLabelText('Штрихкод')).toHaveValue(BARCODE)
    expect(screen.getByLabelText('Название')).toHaveValue('')

    await userEvent.type(screen.getByLabelText('Название'), 'Сырок')
    await userEvent.type(screen.getByLabelText('Белки, г'), '17,2')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '5')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '1,8')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    const list = await screen.findByRole('list', { name: 'Только что создан' })
    expect(callsTo(calls, SAVE_PRODUCT)[0].body).toEqual({
      name: 'Сырок',
      unit: 'g',
      kcal: 121,
      protein_g: 17.2,
      fat_g: 5,
      carbs_g: 1.8,
      ...noLabel,
      ...noPortions,
      barcode: BARCODE,
    })
    expect(router.state.location.pathname).toBe(MEAL)
    expect(await within(list).findByLabelText('Сколько, г')).toHaveValue('100')
  })

  it('неполный продукт из Open Food Facts — форма с тем, что известно', async () => {
    stubCamera()
    mockApi({
      ...DAY,
      [LOOKUP]: json(
        200,
        lookupOf('draft', {
          draft: {
            name: 'Кефир 1 %, Простоквашино',
            unit: 'ml',
            kcal: 40,
            protein_g: 3,
            fat_g: 1,
            carbs_g: null,
            ...noLabel,
            ...noPortions,
            sugars_g: 3.9,
          },
        }),
      ),
    })
    await renderApp(PAGE, anna)

    await typeBarcode(BARCODE)

    expect(
      await screen.findByText(
        `Продукт ${BARCODE} есть в Open Food Facts, но состав там неполный. Дополните его с упаковки.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('Кефир 1 %, Простоквашино')
    expect(screen.getByLabelText('В чём измеряется')).toHaveValue('ml')
    expect(screen.getByLabelText('Калории, ккал')).toHaveValue('40')
    expect(screen.getByLabelText('Белки, г')).toHaveValue('3')
    expect(screen.getByLabelText('Углеводы, г')).toHaveValue('')
    // Известное с этикетки подставлено тоже.
    expect(screen.getByLabelText('Сахара, г')).toHaveValue('3.9')
    expect(screen.getByLabelText('Клетчатка, г')).toHaveValue('')
    expect(screen.getByLabelText('Штрихкод')).toHaveValue(BARCODE)
    // Калории с упаковки расчётом не затираются.
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '4')
    expect(screen.getByLabelText('Калории, ккал')).toHaveValue('40')
  })

  it('источник не отвечает — продукт заводят вручную или сканируют ещё раз', async () => {
    const camera = stubCamera()
    mockApi({ ...DAY, [LOOKUP]: json(200, lookupOf('unavailable')) })
    await renderApp(PAGE, anna)

    await typeBarcode(BARCODE)

    expect(
      await screen.findByText(
        `Штрихкода ${BARCODE} нет в каталоге, а Open Food Facts не отвечает. Заполните состав с упаковки или попробуйте позже.`,
      ),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Штрихкод')).toHaveValue(BARCODE)

    await userEvent.click(screen.getByRole('button', { name: 'Сканировать ещё раз' }))

    expect(await screen.findByText('Наведите камеру на штрихкод на упаковке.')).toBeInTheDocument()
    expect(camera.tracks).toHaveLength(2)
  })

  it('отказ сервера остаётся на экране; поиск можно повторить', async () => {
    stubCamera()
    const calls = mockApi({
      ...DAY,
      [LOOKUP]: sequence(
        json(429, { detail: 'too_many_attempts' }),
        json(200, lookupOf('found', { product: scannedCheese })),
      ),
      'GET /api/products/*': json(200, scannedCheese),
      [SUGGESTIONS]: json(200, nothing),
    })
    await renderApp(PAGE, anna)

    await typeBarcode(BARCODE)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Слишком много попыток. Подождите немного и попробуйте снова.',
    )
    // Камера не включается сама: тот же штрихкод в кадре запустил бы поиск по кругу.
    expect(screen.queryByLabelText('Штрихкод цифрами')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Повторить' }))

    expect(await screen.findByRole('list', { name: 'По штрихкоду' })).toBeInTheDocument()
    expect(callsTo(calls, LOOKUP)).toHaveLength(2)
  })

  it('ответ поиска не возвращает на экран, с которого уже ушли', async () => {
    stubCamera()
    let answer: (response: Response) => void = () => {}
    mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, nothing),
      [LOOKUP]: () => new Promise<Response>((resolve) => (answer = resolve)) as never,
    })
    const { router } = await renderApp(PAGE, anna)

    await typeBarcode(BARCODE)
    expect(await screen.findByText(`Ищем продукт ${BARCODE}…`)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Назад' }))
    await screen.findByLabelText('Поиск продукта')
    answer(json(200, lookupOf('found', { product: scannedCheese }))({} as never))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(router.state.location.search).toEqual({})
    expect(screen.queryByRole('list', { name: 'По штрихкоду' })).not.toBeInTheDocument()
  })
})
