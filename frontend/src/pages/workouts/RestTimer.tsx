import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

import { readRestTimer } from './restStorage'

export function RestTimer({ workoutId }: { workoutId: string }) {
  const { t } = useTranslation()
  const key = `workout-rest-${workoutId}`
  const [state, setState] = useState(() => readRestTimer(key))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const refresh = () => setState(readRestTimer(key))
    window.addEventListener('workout-rest-change', refresh)
    const timer = window.setInterval(() => {
      const current = readRestTimer(key)
      const moment = Date.now()
      if (current && current.until <= moment) {
        navigator.vibrate?.(200)
        sessionStorage.removeItem(key)
        setState(null)
      }
      setNow(moment)
    }, 250)
    return () => {
      window.removeEventListener('workout-rest-change', refresh)
      window.clearInterval(timer)
    }
  }, [key])

  const remaining = state ? Math.max(0, Math.ceil((state.until - now) / 1000)) : 0
  if (!state || remaining <= 0) return null
  const progress = Math.min(100, (remaining / state.duration) * 100)

  return (
    <section
      aria-label={t('workouts.rest')}
      className="grid justify-items-center gap-3 rounded-2xl border bg-card p-5"
    >
      <h2 className="font-medium">{t('workouts.rest')}</h2>
      <div
        className="grid size-44 place-items-center rounded-full p-3"
        style={{ background: `conic-gradient(var(--primary) ${progress}%, var(--muted) 0)` }}
      >
        <div
          className="grid size-full place-items-center rounded-full bg-card text-5xl font-semibold tabular-nums"
          role="timer"
          aria-live="off"
        >
          {remaining}
        </div>
      </div>
      <Button
        variant="ghost"
        onClick={() => {
          sessionStorage.removeItem(key)
          setState(null)
        }}
      >
        {t('workouts.restStop')}
      </Button>
    </section>
  )
}
