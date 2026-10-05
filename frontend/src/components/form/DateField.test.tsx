import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

import { DateField } from './DateField'

function Harness({ initial, onChange }: { initial: string; onChange: (iso: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <DateField
        label="Дата рождения"
        value={value}
        min="1900-01-01"
        max="2026-10-05"
        onChange={(iso) => {
          setValue(iso)
          onChange(iso)
        }}
      />
      <button onClick={() => setValue('2001-12-03')}>сбросить</button>
    </>
  )
}

function setup(initial = '') {
  const onChange = vi.fn<(iso: string) => void>()
  render(<Harness initial={initial} onChange={onChange} />)
  return { onChange, field: screen.getByLabelText('Дата рождения') }
}

describe('DateField', () => {
  it('одно поле, дата в нём — день/месяц/год', () => {
    const { field } = setup('1990-05-17')

    expect(field).toHaveValue('17/05/1990')
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
  })

  it('пустое поле подсказывает формат', () => {
    const { field } = setup()

    expect(field).toHaveAttribute('placeholder', 'дд/мм/гггг')
  })

  it('дату можно набрать одними цифрами', async () => {
    const { onChange, field } = setup()

    await userEvent.type(field, '17051990')

    expect(field).toHaveValue('17/05/1990')
    expect(onChange).toHaveBeenLastCalledWith('1990-05-17')
  })

  it('недописанная дата уходит в форму как есть — та покажет ошибку', async () => {
    const { onChange, field } = setup()

    await userEvent.type(field, '170')

    expect(onChange).toHaveBeenLastCalledWith('17/0')
  })

  it('очищенное поле означает «дата не указана»', async () => {
    const { onChange, field } = setup('1990-05-17')

    await userEvent.clear(field)

    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('открывает календарь на выбранном месяце и ставит выбранный день', async () => {
    const { onChange, field } = setup('1990-05-17')

    await userEvent.click(screen.getByRole('button', { name: 'Открыть календарь' }))
    const calendar = await screen.findByRole('grid')
    expect(screen.getByLabelText('Выберите год')).toHaveValue('1990')
    expect(within(calendar).getByRole('button', { name: /17 мая 1990.*выбрано/ })).toBeVisible()

    await userEvent.click(within(calendar).getByRole('button', { name: /23 мая 1990/ }))

    expect(field).toHaveValue('23/05/1990')
    expect(onChange).toHaveBeenLastCalledWith('1990-05-23')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('год и месяц выбираются списками, будущие дни недоступны', async () => {
    const { field } = setup()

    await userEvent.click(screen.getByRole('button', { name: 'Открыть календарь' }))
    // Без выбранной даты календарь открывается на последнем доступном месяце.
    expect(await screen.findByLabelText('Выберите год')).toHaveValue('2026')
    expect(screen.getByRole('button', { name: /, 6 октября 2026/ })).toBeDisabled()

    await userEvent.selectOptions(screen.getByLabelText('Выберите год'), '1985')
    await userEvent.selectOptions(screen.getByLabelText('Выберите месяц'), '0')
    await userEvent.click(screen.getByRole('button', { name: /, 9 января 1985/ }))

    expect(field).toHaveValue('09/01/1985')
  })

  it('календарь говорит на языке интерфейса', async () => {
    await i18n.changeLanguage('en')
    setup('1990-05-17')

    await userEvent.click(screen.getByRole('button', { name: 'Open calendar' }))

    expect(await screen.findByLabelText('Choose the Year')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /17 May 1990/ })).toBeInTheDocument()
  })

  it('показывает значение, заданное снаружи', async () => {
    const { field } = setup('1990-05-17')

    await userEvent.click(screen.getByRole('button', { name: 'сбросить' }))

    expect(field).toHaveValue('03/12/2001')
  })

  it('показывает ошибку и помечает поле', () => {
    render(
      <DateField
        label="Дата"
        value="1990-02-31"
        onChange={() => {}}
        error="validation.birthDate"
      />,
    )

    expect(screen.getByText('Проверьте дату рождения')).toBeInTheDocument()
    expect(screen.getByLabelText('Дата')).toBeInvalid()
  })
})
