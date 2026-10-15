import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { callsTo, json, mockApi, page } from '@/test/api'
import { renderApp } from '@/test/app'
import {
  anna,
  cottageCheese,
  diaryDay,
  egg,
  kefir,
  meals,
  noLabel,
  noPortions,
  oatmeal,
  outsideOf,
  suggestionOf,
} from '@/test/fixtures'

const DATE = '2026-10-11'
const PAGE = `/diary/${DATE}/add/${meals.breakfast.id}`
// Экран узнаёт приём пищи по дню: без него название взять неоткуда.
const DAY = { 'GET /api/diary': json(200, diaryDay(DATE)) }
const SUGGESTIONS = 'GET /api/diary/suggestions'
const SEARCH = 'GET /api/products'
const OUTSIDE = 'GET /api/products/external'
const LOOKUP = 'POST /api/products/lookup'
const SAVE = 'PUT /api/diary/entries/*'
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const suggestions = {
  in_meal: [],
  frequent: [{ ...cottageCheese, amount: 180 }],
  recent: [
    { ...oatmeal, amount: 60 },
    { ...cottageCheese, amount: 180 },
  ],
}
const nothing = { in_meal: [], frequent: [], recent: [] }

describe('добавление в приём пищи', () => {
  it('предлагает частые и недавние продукты с прошлой граммовкой', async () => {
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, suggestions),
      [SAVE]: json(201, {}),
    })
    await renderApp(PAGE, anna)

    expect(await screen.findByRole('heading', { name: 'Завтрак, 11/10/2026' })).toBeInTheDocument()
    const frequent = await screen.findByRole('list', { name: 'Частые' })
    expect(
      within(frequent).getByText('121 ккал · Б 17,2 · Ж 5 · У 1,8 на 100 г'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: 'Недавние' })).getAllByRole('listitem'),
    ).toHaveLength(2)

    // Раскрывается одна строка — та, что нажата, хотя творог есть в обоих списках.
    await userEvent.click(within(frequent).getByRole('button', { name: /Творог/ }))
    expect(screen.getAllByLabelText('Сколько, г')).toHaveLength(1)
    expect(screen.getByLabelText('Сколько, г')).toHaveValue('180')
    // У творога нет ни порции, ни упаковки: выбирать меру не из чего.
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Творог 5 %, 180 г')
    const [saved] = callsTo(calls, SAVE)
    expect(saved.path.split('/').at(-1)).toMatch(UUID7)
    expect(saved.body).toEqual({
      local_date: DATE,
      meal_id: meals.breakfast.id,
      product_id: cottageCheese.id,
      amount: 180,
    })
    // Форма закрылась: можно выбирать следующий продукт.
    expect(screen.queryByLabelText('Сколько, г')).not.toBeInTheDocument()
    // Подсказки спрошены для этого приёма пищи.
    expect(callsTo(calls, SUGGESTIONS)[0].query).toEqual({ meal_id: meals.breakfast.id })
  })

  it('первым показывает то, что обычно едят в этот приём пищи', async () => {
    const usual = {
      in_meal: [
        { ...oatmeal, amount: 60 },
        { ...kefir, amount: 250 },
      ],
      frequent: [{ ...cottageCheese, amount: 180 }],
      recent: [{ ...cottageCheese, amount: 180 }],
    }
    const calls = mockApi({ ...DAY, [SUGGESTIONS]: json(200, usual), [SAVE]: json(201, {}) })
    await renderApp(PAGE, anna)

    const inMeal = await screen.findByRole('list', { name: 'Часто в этом приёме пищи' })
    expect(within(inMeal).getAllByRole('listitem')).toHaveLength(2)
    // Общие «частые» уступают место, «недавние» остаются.
    expect(screen.queryByRole('list', { name: 'Частые' })).not.toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Недавние' })).toBeInTheDocument()

    // Жидкость вносится в миллилитрах, с прошлым количеством из этого приёма.
    expect(within(inMeal).getByText('40 ккал · Б 3 · Ж 1 · У 4 на 100 мл')).toBeInTheDocument()
    await userEvent.click(within(inMeal).getByRole('button', { name: /Кефир/ }))
    expect(screen.getByLabelText('Сколько, мл')).toHaveValue('250')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Кефир 1 %, 250 мл')
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ product_id: kefir.id, amount: 250 })
  })

  it('ищет по каталогу и вносит найденное с введённой граммовкой', async () => {
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, nothing),
      [SEARCH]: (call) => json(200, call.query.q === 'овс' ? [oatmeal] : [])(call),
      [SAVE]: json(201, {}),
    })
    await renderApp(PAGE, anna)
    expect(
      await screen.findByText('Введите название продукта. Если его нет в каталоге — создайте.'),
    ).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Поиск продукта'), 'овс')
    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    const amount = screen.getByLabelText('Сколько, г')
    expect(amount).toHaveValue('100')
    await userEvent.clear(amount)
    await userEvent.type(amount, '62,5')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Овсяные хлопья, 62,5 г')
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ product_id: oatmeal.id, amount: 62.5 })
    // Поиск очищен — снова видны подсказки.
    expect(screen.getByLabelText('Поиск продукта')).toHaveValue('')
  })

  it('говорит, когда ничего не найдено', async () => {
    mockApi({ ...DAY, [SUGGESTIONS]: json(200, suggestions), [SEARCH]: json(200, []) })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'кефир')

    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Частые' })).not.toBeInTheDocument()
  })

  it('каталог приходит страницами: остальное — по «Показать ещё»', async () => {
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, nothing),
      [SEARCH]: (call) =>
        (call.query.offset === '0' ? page([oatmeal], 20) : json(200, [kefir]))(call),
    })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'е')
    const list = await screen.findByRole('list', { name: 'В каталоге' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Показать ещё' }))

    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))
    expect(callsTo(calls, SEARCH).map((call) => call.query)).toEqual([
      { q: 'е', offset: '0' },
      { q: 'е', offset: '20' },
    ])
    // Дальше ничего нет — и кнопки нет. Одна буква в Open Food Facts не уходит.
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Искать в Open Food Facts' }),
    ).not.toBeInTheDocument()
  })

  it('по кнопке ищет в Open Food Facts; выбранный продукт ждёт количества', async () => {
    const yogurt = {
      barcode: '4600000000008',
      name: 'Йогурт натуральный',
      unit: 'g' as const,
      kcal: 68,
      protein_g: 5,
      fat_g: 3.2,
      carbs_g: 4.7,
    }
    const imported = {
      ...cottageCheese,
      ...yogurt,
      id: '0199b7a0-0000-7000-8000-0000000000c9',
      source: 'open_food_facts' as const,
    }
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, nothing),
      [SEARCH]: json(200, []),
      [OUTSIDE]: json(200, outsideOf([yogurt])),
      [LOOKUP]: json(200, { status: 'found', barcode: yogurt.barcode, product: imported }),
      'GET /api/products/*': json(200, imported),
      [SAVE]: json(201, {}),
    })
    const { router } = await renderApp(PAGE, anna)

    // Пока текст набирают, наружу он не уходит: только свой каталог.
    await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'йогурт')
    expect(await screen.findByText('Ничего не найдено.')).toBeInTheDocument()
    expect(
      screen.getByText('Текст поиска будет отправлен в открытую базу продуктов Open Food Facts.'),
    ).toBeInTheDocument()
    expect(callsTo(calls, OUTSIDE)).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Искать в Open Food Facts' }))
    const outside = await screen.findByRole('list', { name: 'Open Food Facts' })
    expect(callsTo(calls, OUTSIDE).map((call) => call.query)).toEqual([{ q: 'йогурт', page: '1' }])
    expect(within(outside).getByText('68 ккал · Б 5 · Ж 3,2 · У 4,7 на 100 г')).toBeInTheDocument()

    // Выбор — запрос по штрихкоду: продукт уже в каталоге и раскрыт для количества.
    await userEvent.click(within(outside).getByRole('button', { name: /Йогурт натуральный/ }))
    const picked = await screen.findByRole('list', { name: 'Из Open Food Facts' })
    expect(callsTo(calls, LOOKUP)[0].body).toEqual({ barcode: yogurt.barcode })
    expect(router.state.location.search).toEqual({ picked: imported.id })
    expect(screen.getByLabelText('Поиск продукта')).toHaveValue('')
    expect(
      screen.getByText('Состав взят из Open Food Facts. Сверьте его с упаковкой.'),
    ).toBeInTheDocument()
    await userEvent.clear(within(picked).getByLabelText('Сколько, г'))
    await userEvent.type(within(picked).getByLabelText('Сколько, г'), '350')
    await userEvent.click(within(picked).getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Добавлено: Йогурт натуральный, 350 г',
    )
    expect(callsTo(calls, SAVE)[0].body).toMatchObject({ product_id: imported.id, amount: 350 })
    await waitFor(() => expect(router.state.location.search).toEqual({}))
  })

  it('продукт из Open Food Facts с неполным составом дополняют в форме', async () => {
    const tea = {
      barcode: '4600000000008',
      name: 'Чай чёрный',
      unit: 'ml' as const,
      kcal: null,
      protein_g: null,
      fat_g: null,
      carbs_g: null,
    }
    const created = { ...kefir, name: tea.name, barcode: tea.barcode }
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, nothing),
      [SEARCH]: json(200, []),
      [OUTSIDE]: json(200, outsideOf([tea])),
      // Запрос по штрихкоду источник не застал: известное берётся из выдачи поиска.
      [LOOKUP]: json(200, { status: 'unavailable', barcode: tea.barcode }),
      'PUT /api/products/*': json(201, created),
      'GET /api/products/*': json(200, created),
    })
    await renderApp(PAGE, anna)

    await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'чай')
    await userEvent.click(await screen.findByRole('button', { name: 'Искать в Open Food Facts' }))
    const row = await screen.findByRole('button', { name: /Чай чёрный/ })
    expect(row).toHaveTextContent('Состав неполный — его нужно будет дополнить с упаковки.')
    await userEvent.click(row)

    expect(await screen.findByRole('heading', { name: 'Новый продукт' })).toBeInTheDocument()
    expect(screen.getByLabelText('Название')).toHaveValue('Чай чёрный')
    expect(screen.getByLabelText('В чём измеряется')).toHaveValue('ml')
    expect(screen.getByLabelText('Штрихкод')).toHaveValue(tea.barcode)

    // «Отмена» возвращает к поиску, а не уводит с экрана.
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    expect(await screen.findByLabelText('Поиск продукта')).toHaveValue('чай')
    await userEvent.click(screen.getByRole('button', { name: 'Искать в Open Food Facts' }))
    await userEvent.click(await screen.findByRole('button', { name: /Чай чёрный/ }))

    await userEvent.type(await screen.findByLabelText('Белки, г'), '0')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '0')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    // Сохранённый продукт ждёт количества, как созданный по пути.
    const list = await screen.findByRole('list', { name: 'Только что создан' })
    expect(within(list).getByLabelText('Сколько, мл')).toHaveValue('100')
    expect(callsTo(calls, 'PUT /api/products/*')[0].body).toMatchObject({
      name: 'Чай чёрный',
      unit: 'ml',
      barcode: tea.barcode,
    })
  })

  it('не принимает граммовку вне диапазона', async () => {
    const calls = mockApi({ ...DAY, [SUGGESTIONS]: json(200, suggestions) })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    await userEvent.clear(screen.getByLabelText('Сколько, г'))
    await userEvent.type(screen.getByLabelText('Сколько, г'), '0')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByText('От 0,1 до 5000')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toEqual([])
  })

  it('после отказа повторная отправка идёт с тем же ключом записи', async () => {
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, suggestions),
      [SAVE]: json(404, { detail: 'product_not_found' }),
    })
    await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('button', { name: /Овсяные хлопья/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Этого продукта больше нет в каталоге.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(2))
    const [first, second] = callsTo(calls, SAVE)
    expect(second.path).toBe(first.path)
  })

  it('кнопка «Готово» возвращает в день', async () => {
    mockApi({ ...DAY, [SUGGESTIONS]: json(200, nothing) })
    await renderApp(PAGE, anna)

    expect(await screen.findByRole('link', { name: 'Готово' })).toHaveAttribute(
      'href',
      `/diary/${DATE}`,
    )
  })

  it('ведёт к сканеру штрихкода для этого приёма пищи', async () => {
    mockApi({ ...DAY, [SUGGESTIONS]: json(200, nothing) })
    await renderApp(PAGE, anna)

    expect(await screen.findByRole('link', { name: 'Сканировать штрихкод' })).toHaveAttribute(
      'href',
      `${PAGE}/scan`,
    )
  })

  it('продукт, найденный сканером, ждёт количества первым — с числом из этого приёма', async () => {
    const scanned = { ...kefir, barcode: '46012340' }
    mockApi({
      ...DAY,
      [`GET /api/products/${kefir.id}`]: json(200, scanned),
      [SUGGESTIONS]: json(200, {
        in_meal: [{ ...scanned, amount: 250 }],
        frequent: [],
        recent: [{ ...scanned, amount: 200 }],
      }),
    })
    await renderApp(`${PAGE}?scanned=${kefir.id}`, anna)

    const found = await screen.findByRole('list', { name: 'По штрихкоду' })
    // Количество — из прошлого раза в этом же приёме пищи, а не из последнего вообще.
    expect(await within(found).findByLabelText('Сколько, мл')).toHaveValue('250')
    // Форма одна, хотя продукт есть ещё в двух списках.
    expect(screen.getAllByLabelText('Сколько, мл')).toHaveLength(1)
    // Состав внёс человек: об Open Food Facts речи нет.
    expect(screen.queryByText(/Open Food Facts/)).not.toBeInTheDocument()
  })

  it('в приём пищи, которого нет в дне, не вносит', async () => {
    const calls = mockApi({ ...DAY, [SUGGESTIONS]: json(200, suggestions) })
    await renderApp(`/diary/${DATE}/add/0199b7a0-0000-7000-8000-0000000000ff`, anna)

    expect(await screen.findByText('Такого приёма пищи нет.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'К дневнику' })).toHaveAttribute(
      'href',
      `/diary/${DATE}`,
    )
    expect(callsTo(calls, SUGGESTIONS)).toEqual([])
  })
})

describe('порции и упаковки', () => {
  const TWO_EGGS = suggestionOf(egg, 120, { kind: 'serving', size: 60, count: 2 })
  const saved = (portion: object) => ({
    local_date: DATE,
    meal_id: meals.breakfast.id,
    product_id: egg.id,
    ...portion,
  })

  async function openEgg(suggested: Record<keyof typeof nothing, unknown[]> = nothing) {
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, suggested),
      [SEARCH]: json(200, [egg]),
      [SAVE]: json(201, {}),
    })
    await renderApp(PAGE, anna)
    if (suggested === nothing) {
      await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'яйц')
    }
    // Знакомый продукт стоит в двух списках сразу — берём верхний.
    await userEvent.click((await screen.findAllByRole('button', { name: /Яйцо куриное/ }))[0])
    return calls
  }

  it('продукт с порцией открывается одной порцией и вносится порциями', async () => {
    const calls = await openEgg()

    expect(screen.getByRole('radio', { name: 'порция · 60 г' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'упаковка · 600 г' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'г' })).not.toBeChecked()
    const count = screen.getByLabelText('Сколько порций')
    expect(count).toHaveValue('1')
    expect(screen.getByText('= 60 г · 94 ккал')).toBeInTheDocument()
    await userEvent.clear(count)
    await userEvent.type(count, '2')
    expect(screen.getByText('= 120 г · 188 ккал')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Добавлено: Яйцо куриное, 2 порции · 120 г',
    )
    // Граммы считает сервер: уходит только вид порции и их число.
    expect(callsTo(calls, SAVE)[0].body).toEqual(saved({ portion: { kind: 'serving', count: 2 } }))
  })

  it('знакомый продукт открывается так, как его вносили в прошлый раз', async () => {
    const half = suggestionOf(egg, 300, { kind: 'package', size: 600, count: 0.5 })
    const calls = await openEgg({ in_meal: [half], frequent: [], recent: [half] })

    expect(screen.getByRole('radio', { name: 'упаковка · 600 г' })).toBeChecked()
    expect(screen.getByLabelText('Сколько упаковок')).toHaveValue('0.5')
    expect(screen.getByText('= 300 г · 471 ккал')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Добавлено: Яйцо куриное, 0,5 упаковки · 300 г',
    )
    expect(callsTo(calls, SAVE)[0].body).toEqual(
      saved({ portion: { kind: 'package', count: 0.5 } }),
    )
  })

  it('смена меры пересчитывает количество, а граммы уходят граммами', async () => {
    const calls = await openEgg({ in_meal: [TWO_EGGS], frequent: [], recent: [TWO_EGGS] })
    expect(screen.getByLabelText('Сколько порций')).toHaveValue('2')

    await userEvent.click(screen.getByRole('radio', { name: 'упаковка · 600 г' }))
    expect(screen.getByLabelText('Сколько упаковок')).toHaveValue('0.2')
    await userEvent.click(screen.getByRole('radio', { name: 'г' }))
    expect(screen.getByLabelText('Сколько, г')).toHaveValue('120')
    // В единицах продукта пересчитывать нечего.
    expect(screen.queryByText(/^= /)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Яйцо куриное, 120 г')
    expect(callsTo(calls, SAVE)[0].body).toEqual(saved({ amount: 120 }))
  })

  it('набранное число смена меры не подменяет', async () => {
    await openEgg()
    await userEvent.click(screen.getByRole('radio', { name: 'г' }))
    const amount = screen.getByLabelText('Сколько, г')
    expect(amount).toHaveValue('60')

    // Человек набрал «2», думая о яйцах, и только потом выбрал меру: два грамма в порциях
    // ровно не выражаются — число остаётся его.
    await userEvent.clear(amount)
    await userEvent.type(amount, '2')
    await userEvent.click(screen.getByRole('radio', { name: 'порция · 60 г' }))

    expect(screen.getByLabelText('Сколько порций')).toHaveValue('2')
    expect(screen.getByText('= 120 г · 188 ккал')).toBeInTheDocument()
  })

  it('не принимает число порций вне диапазона и количество больше возможного', async () => {
    const calls = await openEgg()
    const count = screen.getByLabelText('Сколько порций')

    await userEvent.clear(count)
    await userEvent.type(count, '0')
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByText('От 0,01 до 100')).toBeInTheDocument()

    await userEvent.clear(count)
    await userEvent.type(count, '84')
    expect(
      await screen.findByText('Должно получиться от 0,1 до 5000 в единицах продукта'),
    ).toBeInTheDocument()
    // Со сменой меры поле проверяется заново: 84 порции — это 5040 г, и это тоже много.
    await userEvent.click(screen.getByRole('radio', { name: 'г' }))
    expect(screen.getByLabelText('Сколько, г')).toHaveValue('5040')
    expect(await screen.findByText('От 0,1 до 5000')).toBeInTheDocument()
    expect(callsTo(calls, SAVE)).toHaveLength(0)
  })

  it('показывает отказ, когда порции у продукта уже нет', async () => {
    mockApi({
      ...DAY,
      [SUGGESTIONS]: json(200, { in_meal: [TWO_EGGS], frequent: [], recent: [TWO_EGGS] }),
      [SAVE]: json(404, { detail: 'portion_not_found' }),
    })
    await renderApp(PAGE, anna)

    await userEvent.click((await screen.findAllByRole('button', { name: /Яйцо куриное/ }))[0])
    await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'У этого продукта больше нет такой порции или упаковки.',
    )
  })
})

describe('новый продукт по пути в приём пищи', () => {
  it('создаёт продукт и возвращает к вводу граммов для него', async () => {
    const created = { ...oatmeal, editable: true }
    // Продукт попадает в «недавние», когда запись с ним сохранена.
    let logged = false
    const calls = mockApi({
      ...DAY,
      [SUGGESTIONS]: (call) =>
        json(200, logged ? { ...nothing, recent: [{ ...created, amount: 100 }] } : nothing)(call),
      'PUT /api/products/*': json(201, created),
      'GET /api/products/*': json(200, created),
      [SAVE]: (call) => {
        logged = true
        return json(201, {})(call)
      },
    })
    const { router } = await renderApp(PAGE, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Создать продукт' }))
    await userEvent.type(await screen.findByLabelText('Название'), 'Овсяные хлопья')
    await userEvent.type(screen.getByLabelText('Калории, ккал'), '352')
    await userEvent.type(screen.getByLabelText('Белки, г'), '12,3')
    await userEvent.type(screen.getByLabelText('Жиры, г'), '6,2')
    await userEvent.type(screen.getByLabelText('Углеводы, г'), '61,8')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    const list = await screen.findByRole('list', { name: 'Только что создан' })
    const [saved] = callsTo(calls, 'PUT /api/products/*')
    const id = saved.path.split('/').at(-1)
    expect(id).toMatch(UUID7)
    expect(saved.body).toEqual({
      name: 'Овсяные хлопья',
      unit: 'g',
      kcal: 352,
      protein_g: 12.3,
      fat_g: 6.2,
      carbs_g: 61.8,
      ...noLabel,
      ...noPortions,
      barcode: null,
    })
    expect(router.state.location.search).toEqual({ product: id })
    expect(callsTo(calls, `GET /api/products/${id}`)).toHaveLength(1)

    // Форма граммов уже открыта: осталось ввести и добавить.
    expect(within(list).getByLabelText('Сколько, г')).toHaveValue('100')
    await userEvent.click(within(list).getByRole('button', { name: 'Добавить' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Добавлено: Овсяные хлопья, 100 г')
    // Внесённый продукт переехал в «недавние» и отдельно больше не показывается.
    expect(await screen.findByRole('list', { name: 'Недавние' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Только что создан' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Сколько, г')).not.toBeInTheDocument()
  })

  it('«Отмена» возвращает к выбору продукта', async () => {
    mockApi({ ...DAY, [SUGGESTIONS]: json(200, nothing) })
    await renderApp(`${PAGE}/new`, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Отмена' }))

    expect(await screen.findByLabelText('Поиск продукта')).toBeInTheDocument()
  })
})

it('поиск вспоминает продукт за пределами коротких списков подсказок', async () => {
  const calls = mockApi({
    ...DAY,
    [SEARCH]: json(200, [egg]),
    [SUGGESTIONS]: (call) =>
      json(
        200,
        call.query.product_id
          ? {
              in_meal: [suggestionOf(egg, 180, { kind: 'serving', size: 60, count: 3 })],
              recent: [suggestionOf(egg, 300, { kind: 'package', size: 600, count: 0.5 })],
              frequent: [],
            }
          : nothing,
      )(call),
    [SAVE]: json(201, {}),
  })
  await renderApp(PAGE, anna)
  await userEvent.type(await screen.findByLabelText('Поиск продукта'), 'яйцо')
  await userEvent.click(await screen.findByRole('button', { name: /Яйцо куриное/ }))
  expect(await screen.findByLabelText('Сколько порций')).toHaveValue('3')
  await userEvent.click(screen.getByRole('button', { name: 'Добавить' }))
  await waitFor(() => expect(callsTo(calls, SAVE)).toHaveLength(1))
  expect(callsTo(calls, SAVE)[0].body).toMatchObject({ portion: { kind: 'serving', count: 3 } })
  expect(callsTo(calls, SUGGESTIONS).some((call) => call.query.product_id === egg.id)).toBe(true)
})
