import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { shiftDays, today } from '@/lib/dates'
import { callsTo, json, mockApi, sequence } from '@/test/api'
import { renderApp } from '@/test/app'
import { anna, cottageCheese, dailyGoal, diaryDay, foodEntry, oatmeal } from '@/test/fixtures'

const DAY = 'GET /api/diary'
const DATE = '2026-10-11'

/** Завтрак из овсянки и творога, ужин из творога: 634,7 ккал за день. */
function loggedDay(date = DATE, goal = dailyGoal) {
  return diaryDay(
    date,
    [
      foodEntry(oatmeal, 60),
      foodEntry(cottageCheese, 150),
      foodEntry(cottageCheese, 200, { meal: 'dinner' }),
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
    expect(breakfast.map((row) => row.textContent)).toEqual([
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

    expect(await screen.findByRole('link', { name: 'Задать цель' })).toBeInTheDocument()
    expect(screen.getByText('182 ккал', { selector: '.text-xl' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
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
      `/diary/${DATE}/add/lunch`,
    )
    expect(screen.getByRole('link', { name: 'Изменить' })).toHaveAttribute(
      'href',
      `/diary/${DATE}/entries/${entry.id}`,
    )
    expect(screen.getAllByRole('link', { name: 'Скопировать из другого дня' })[2]).toHaveAttribute(
      'href',
      `/diary/${DATE}/copy/dinner`,
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
    await router.navigate({ to: '/diary/$date/add/$meal', params: { date: DATE, meal: 'brunch' } })
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
