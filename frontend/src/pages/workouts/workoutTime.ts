/** Время тренировки в часовом поясе профиля, независимо от пояса устройства. */
export function workoutLocalTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  return `${value('hour')}:${value('minute')}`
}

/** День и время профиля → UTC. Проверка отсекает несуществующее время при переводе часов. */
export function workoutMoment(date: string, time: string, timeZone: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const clock = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match || !clock) return undefined
  const wanted = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(clock[1]),
    Number(clock[2]),
  )
  if (!Number.isFinite(wanted)) return undefined
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  let moment = wanted
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = format.formatToParts(new Date(moment))
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
    const shown = Date.UTC(
      value('year'),
      value('month') - 1,
      value('day'),
      value('hour'),
      value('minute'),
    )
    const difference = wanted - shown
    if (difference === 0) return new Date(moment).toISOString()
    moment += difference
  }
  return undefined
}
