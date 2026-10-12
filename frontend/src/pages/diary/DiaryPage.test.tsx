import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import { shiftDays, today } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp, textOf } from '@/test/app'
import {
  anna,
  cottageCheese,
  dailyGoal,
  diaryDay,
  egg,
  foodEntry,
  kefir,
  meals,
  oatmeal,
  secondBreakfast,
} from '@/test/fixtures'

const DAY = 'GET /api/diary'
const DATE = '2026-10-11'

/** Завтрак из овсянки и творога, ужин из творога: 634,7 ккал за день. */
function loggedDay(date = DATE, goal = dailyGoal) {
  return diaryDay(
    date,
    [
      foodEntry(oatmeal, 60),
      foodEntry(cottageCheese, 150),
      foodEntry(cottageCheese, 200, { meal_id: meals.dinner.id }),
    ],
    goal,
  )
}

describe('день дневника', () => {
  it('показывает съеденное против цели и разбивку по приёмам пищи', async () => {
    const calls = mockApi({ [DAY]: json(200, loggedDay()) })
    await renderApp(`/diary/${DATE}`, anna)

    const summary = (await screen.findByText('Итог дня')).closest('[data-slot="card"]')!
    expect(within(summary as HTMLElement).getByText('635 из 2 100 ккал')).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('67,6 из 130 г')).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('21,2 из 70 г')).toBeInTheDocument()
    expect(within(summary as HTMLElement).getByText('43,4 из 230 г')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Калории' })).toHaveAttribute(
      'aria-valuenow',
      '30',
    )
    expect(screen.getByRole('link', { name: 'Изменить цель' })).toHaveAttribute(
      'href',
      '/diary/goal',
    )

    const breakfast = within(screen.getByRole('list', { name: 'Завтрак' })).getAllByRole('listitem')
    expect(breakfast.map(textOf)).toEqual([
      'Овсяные хлопья60 г · 211 ккал',
      'Творог 5 %150 г · 182 ккал',
    ])
    expect(screen.getByText('393 ккал')).toBeInTheDocument()
    expect(
      screen.getByText('242 ккал', { selector: '[data-slot="card-description"]' }),
    ).toBeInTheDocument()
    // Обед и перекус пусты.
    expect(screen.getAllByText('Пока пусто.')).toHaveLength(2)
    expect(callsTo(calls, DAY)[0].query).toEqual({ date: DATE })
  })

  it('без цели показывает только съеденное и предлагает её задать', async () => {
    mockApi({ [DAY]: json(200, diaryDay(DATE, [foodEntry(cottageCheese, 150)])) })
    await renderApp(`/diary/${DATE}`, anna)

    // Цель предлагают задать и итог дня, и вода.
    expect(await screen.findAllByRole('link', { name: 'Задать цель' })).toHaveLength(2)
    expect(screen.getByText('182 ккал', { selector: '.text-xl' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('цель по части показателей сверяет только их', async () => {
    const onlyKcalAndProtein = {
      ...dailyGoal,
      kcal: 2000,
      fat_g: null,
      carbs_g: null,
      water_ml: null,
    }
    mockApi({
      [DAY]: json(200, diaryDay(DATE, [foodEntry(cottageCheese, 150)], onlyKcalAndProtein)),
    })
    await renderApp(`/diary/${DATE}`, anna)

    expect(await screen.findByText('182 из 2 000 ккал')).toBeInTheDocument()
    expect(screen.getByText('25,8 из 130 г')).toBeInTheDocument()
    // Жиры и углеводы без цели — только съеденное, без шкалы.
    expect(screen.getByText('7,5 г')).toBeInTheDocument()
    expect(screen.getByText('2,7 г')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar').map((bar) => bar.getAttribute('aria-label'))).toEqual(
      ['Калории', 'Белки'],
    )
    expect(screen.getByRole('link', { name: 'Изменить цель' })).toBeInTheDocument()
  })

  it('жидкость показывает в миллилитрах', async () => {
    mockApi({ [DAY]: json(200, diaryDay(DATE, [foodEntry(kefir, 250)])) })
    await renderApp(`/diary/${DATE}`, anna)

    const breakfast = await screen.findByRole('list', { name: 'Завтрак' })
    expect(within(breakfast).getByRole('listitem')).toHaveTextContent('Кефир 1 %250 мл · 100 ккал')
  })

  describe('запись, внесённая порциями', () => {
    const entries = () =>
      (
        [
          [60, 'serving', 60, 1],
          [120, 'serving', 60, 2],
          [300, 'serving', 60, 5],
          [90, 'serving', 60, 1.5],
          [600, 'package', 600, 1],
          [400, 'package', 200, 2],
          [500, 'package', 100, 5],
        ] as const
      ).map(([amount, kind, size, count]) =>
        foodEntry(egg, amount, { portion: { kind, size, count } }),
      )
    const rows = () =>
      within(screen.getByRole('list', { name: /Завтрак|Breakfast/ }))
        .getAllByRole('listitem')
        .map((row) => textOf(row).replace('Яйцо куриное', ''))

    it('показана так, как её внесли: слово к числу — по правилам языка', async () => {
      mockApi({ [DAY]: json(200, diaryDay(DATE, entries())) })
      await renderApp(`/diary/${DATE}`, anna)

      await screen.findByRole('list', { name: 'Завтрак' })
      expect(rows()).toEqual([
        '1 порция · 60 г · 94 ккал',
        '2 порции · 120 г · 188 ккал',
        '5 порций · 300 г · 471 ккал',
        '1,5 порции · 90 г · 141 ккал',
        '1 упаковка · 600 г · 942 ккал',
        '2 упаковки · 400 г · 628 ккал',
        '5 упаковок · 500 г · 785 ккал',
      ])
    })

    it('по-английски — в единственном и множественном числе', async () => {
      mockApi({ [DAY]: json(200, diaryDay(DATE, entries())) })
      await renderApp(`/diary/${DATE}`, anna)
      await screen.findByRole('list', { name: 'Завтрак' })

      await i18n.changeLanguage('en')

      await screen.findByRole('list', { name: 'Breakfast' })
      expect(rows()).toEqual([
        '1 serving · 60 g · 94 kcal',
        '2 servings · 120 g · 188 kcal',
        '5 servings · 300 g · 471 kcal',
        '1.5 servings · 90 g · 141 kcal',
        '1 package · 600 g · 942 kcal',
        '2 packages · 400 g · 628 kcal',
        '5 packages · 500 g · 785 kcal',
      ])
    })
  })

  it('превышение цели отмечает шкалой', async () => {
    const feast = diaryDay(DATE, [foodEntry(oatmeal, 700)], dailyGoal)
    mockApi({ [DAY]: json(200, feast) })
    await renderApp(`/diary/${DATE}`, anna)

    const bar = await screen.findByRole('progressbar', { name: 'Калории' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
    expect(bar.firstElementChild).toHaveClass('bg-destructive')
  })

  it('удаляет запись после подтверждения', async () => {
    const entry = foodEntry(cottageCheese, 150)
    const calls = mockApi({
      [DAY]: sequence(json(200, diaryDay(DATE, [entry])), json(200, diaryDay(DATE))),
      'DELETE /api/diary/entries/*': json(204),
    })
    await renderApp(`/diary/${DATE}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    expect(screen.getByText('Удалить запись?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await userEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    await waitFor(() => expect(screen.getAllByText('Пока пусто.')).toHaveLength(4))
    expect(callsTo(calls, `DELETE /api/diary/entries/${entry.id}`)).toHaveLength(1)
  })

  it('показывает отказ сервера при удалении', async () => {
    mockApi({
      [DAY]: json(200, diaryDay(DATE, [foodEntry(cottageCheese, 150)])),
      'DELETE /api/diary/entries/*': json(404, { detail: 'not_found' }),
    })
    await renderApp(`/diary/${DATE}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить' }))
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it('ведёт к добавлению, правке, копированию и каталогу', async () => {
    const entry = foodEntry(cottageCheese, 150)
    mockApi({ [DAY]: json(200, diaryDay(DATE, [entry])) })
    await renderApp(`/diary/${DATE}`, anna)

    expect(await screen.findByRole('link', { name: 'Добавить: Обед' })).toHaveAttribute(
      'href',
      `/diary/${DATE}/add/${meals.lunch.id}`,
    )
    expect(screen.getByRole('link', { name: 'Изменить' })).toHaveAttribute(
      'href',
      `/diary/${DATE}/entries/${entry.id}`,
    )
    expect(screen.getAllByRole('link', { name: 'Скопировать из другого дня' })[2]).toHaveAttribute(
      'href',
      `/diary/${DATE}/copy/${meals.dinner.id}`,
    )
    expect(screen.getByRole('link', { name: 'Добавить приём пищи' })).toHaveAttribute(
      'href',
      `/diary/${DATE}/meals/new`,
    )
    expect(screen.getByRole('link', { name: 'Скопировать день' })).toHaveAttribute(
      'href',
      `/diary/${DATE}/copy/day`,
    )
    expect(screen.getByRole('link', { name: 'Каталог продуктов' })).toHaveAttribute(
      'href',
      '/products',
    )
  })
})

describe('приёмы пищи', () => {
  const withOwn = [...Object.values(meals), secondBreakfast]

  it('показывает свой приём пищи под его названием и вносит в него', async () => {
    const entry = foodEntry(cottageCheese, 100, { meal_id: secondBreakfast.id })
    mockApi({ [DAY]: json(200, diaryDay(DATE, [entry], null, withOwn)) })
    await renderApp(`/diary/${DATE}`, anna)

    const own = await screen.findByRole('list', { name: 'Второй завтрак' })
    expect(within(own).getByRole('listitem')).toHaveTextContent('Творог 5 %100 г · 121 ккал')
    expect(screen.getByRole('link', { name: 'Добавить: Второй завтрак' })).toHaveAttribute(
      'href',
      `/diary/${DATE}/add/${secondBreakfast.id}`,
    )
  })

  it('убирает приём пищи из списка после подтверждения', async () => {
    const calls = mockApi({
      [DAY]: sequence(json(200, diaryDay(DATE, [], null, withOwn)), json(200, diaryDay(DATE))),
      'DELETE /api/diary/meals/*': json(204),
    })
    await renderApp(`/diary/${DATE}`, anna)

    const remove = await screen.findByRole('button', { name: 'Удалить приём пищи: Второй завтрак' })
    await userEvent.click(remove)
    expect(
      screen.getByText('Убрать приём пищи из списка? Его записи останутся в своих днях.'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Отмена' }))
    await userEvent.click(
      screen.getByRole('button', { name: 'Удалить приём пищи: Второй завтрак' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Добавить: Второй завтрак' })).toBeNull(),
    )
    expect(callsTo(calls, `DELETE /api/diary/meals/${secondBreakfast.id}`)).toHaveLength(1)
    // Предустановленный приём убирается так же.
    expect(screen.getByRole('button', { name: 'Удалить приём пищи: Завтрак' })).toBeInTheDocument()
  })

  it('показывает отказ сервера при удалении приёма пищи', async () => {
    mockApi({
      [DAY]: json(200, diaryDay(DATE)),
      'DELETE /api/diary/meals/*': json(404, { detail: 'not_found' }),
    })
    await renderApp(`/diary/${DATE}`, anna)

    await userEvent.click(await screen.findByRole('button', { name: 'Удалить приём пищи: Обед' }))
    await userEvent.click(screen.getByRole('button', { name: 'Да, удалить' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Не найдено.')
  })

  it('убранный приём остаётся в дне со своими записями, но нового в него не внести', async () => {
    const archived = { ...meals.snack, archived: true }
    const entry = foodEntry(cottageCheese, 150, { meal_id: archived.id })
    mockApi({
      [DAY]: json(200, diaryDay(DATE, [entry], null, [meals.breakfast, archived])),
    })
    await renderApp(`/diary/${DATE}`, anna)

    const snack = await screen.findByRole('list', { name: 'Перекус' })
    expect(within(snack).getByRole('listitem')).toHaveTextContent('Творог 5 %')
    expect(
      screen.getByText('Приём пищи убран из списка. Записи этого дня остались.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Добавить: Перекус' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить приём пищи: Перекус' })).toBeNull()
    // Запись убранного приёма по-прежнему правится и удаляется.
    expect(within(snack).getByRole('link', { name: 'Изменить' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Скопировать из другого дня' })).toHaveLength(1)
  })

  it('с пустым списком предлагает добавить приём пищи', async () => {
    mockApi({ [DAY]: json(200, diaryDay(DATE, [], null, [])) })
    await renderApp(`/diary/${DATE}`, anna)

    expect(
      await screen.findByText('В списке нет приёмов пищи. Добавьте хотя бы один.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Добавить приём пищи' })).toBeInTheDocument()
  })

  it('создаёт свой приём пищи и возвращает в день', async () => {
    const calls = mockApi({
      [DAY]: json(200, diaryDay(DATE)),
      'PUT /api/diary/meals/*': sequence(
        json(401, { detail: 'not_authenticated' }),
        json(201, secondBreakfast),
      ),
    })
    const { router } = await renderApp(`/diary/${DATE}`, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Добавить приём пищи' }))
    expect(await screen.findByRole('heading', { name: 'Новый приём пищи' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Заполните поле')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Название'), 'я'.repeat(41))
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByText('Название — до 40 символов')).toBeInTheDocument()
    expect(callsTo(calls, 'PUT /api/diary/meals/*')).toEqual([])

    await userEvent.clear(screen.getByLabelText('Название'))
    await userEvent.type(screen.getByLabelText('Название'), '  Второй завтрак ')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеанс истёк. Войдите снова.')
    await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${DATE}`))
    const saves = callsTo(calls, 'PUT /api/diary/meals/*')
    expect(saves.map((call) => call.body)).toEqual([
      { name: 'Второй завтрак' },
      { name: 'Второй завтрак' },
    ])
    // Повтор после сбоя идёт с тем же ключом: второго приёма не появится.
    expect(saves[1].path).toBe(saves[0].path)
    expect(saves[0].path).toMatch(/\/meals\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
  })

  it('отмена на экране нового приёма пищи возвращает в день', async () => {
    mockApi({ [DAY]: json(200, diaryDay(DATE)) })
    const { router } = await renderApp(`/diary/${DATE}/meals/new`, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Отмена' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${DATE}`))
  })
})

describe('переход между днями', () => {
  it('стрелки ведут на соседние дни, поле даты — на любой', async () => {
    const calls = mockApi({ [DAY]: (call) => json(200, diaryDay(call.query.date))(call) })
    const { router } = await renderApp(`/diary/${DATE}`, anna)

    expect(await screen.findByLabelText('День')).toHaveValue('11/10/2026')
    await userEvent.click(screen.getByRole('link', { name: 'Предыдущий день' }))
    await waitFor(() => expect(screen.getByLabelText('День')).toHaveValue('10/10/2026'))
    await userEvent.click(screen.getByRole('link', { name: 'Следующий день' }))
    await userEvent.click(screen.getByRole('link', { name: 'Следующий день' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary/2026-10-12'))

    // Недописанная дата никуда не ведёт; дописанная открывает свой день.
    const field = screen.getByLabelText('День')
    await userEvent.clear(field)
    await userEvent.type(field, '0109')
    expect(router.state.location.pathname).toBe('/diary/2026-10-12')
    await userEvent.type(field, '2026')
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary/2026-09-01'))
    expect(callsTo(calls, DAY).at(-1)?.query).toEqual({ date: '2026-09-01' })
  })

  it('из другого дня возвращает к сегодняшнему', async () => {
    mockApi({ [DAY]: (call) => json(200, diaryDay(call.query.date))(call) })
    const { router } = await renderApp(`/diary/${shiftDays(today(), -3)}`, anna)

    await userEvent.click(await screen.findByRole('link', { name: 'К сегодняшнему дню' }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${today()}`))
    expect(screen.queryByRole('link', { name: 'К сегодняшнему дню' })).not.toBeInTheDocument()
  })

  it('раздел «Питание» открывает сегодняшний день, а не дата в адресе — тоже', async () => {
    mockApi({ [DAY]: (call) => json(200, diaryDay(call.query.date))(call) })
    const { router } = await renderApp('/', anna)

    await userEvent.click(await screen.findByRole('link', { name: 'Питание' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${today()}`))

    await router.navigate({ to: '/diary/$date', params: { date: 'вчера' } })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${today()}`))
    // Приём пищи, которого в списке нет, не открывается — оттуда есть дорога в день.
    await router.navigate({ to: '/diary/$date/add/$meal', params: { date: DATE, meal: 'brunch' } })
    expect(await screen.findByText('Такого приёма пищи нет.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'К дневнику' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/diary/${DATE}`))
  })
})

describe('главная', () => {
  it('показывает сегодняшние калории и ведёт в дневник', async () => {
    const calls = mockApi({ [DAY]: json(200, loggedDay(today())) })
    await renderApp('/', anna)

    expect(await screen.findByText('635 из 2 100 ккал')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Открыть дневник' })).toHaveAttribute(
      'href',
      `/diary/${today()}`,
    )
    expect(callsTo(calls, DAY)[0].query).toEqual({ date: today() })
  })
})
