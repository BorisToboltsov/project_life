import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { COOPER_SECONDS } from '@/lib/fitness'

import { readUntil, writeUntil } from './timerStorage'

/** Пока идёт отсчёт, экран не гаснет; вкладка, ушедшая в фон, теряет блокировку — берём снова. */
function useScreenAwake(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | undefined
    let stopped = false
    const acquire = () => {
      if (document.visibilityState !== 'visible') return
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (stopped) void sentinel.release()
          else lock = sentinel
        })
        .catch(() => {
          // Браузер отказал (экономия заряда): отсчёт идёт и без блокировки.
        })
    }
    acquire()
    document.addEventListener('visibilitychange', acquire)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', acquire)
      void lock?.release()
    }
  }, [active])
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

/** Таймер теста Купера: 12 минут, в конце — вибрация и приглашение внести дистанцию. */
export function CooperTimer() {
  const { t } = useTranslation()
  const [until, setUntil] = useState(readUntil)
  const [now, setNow] = useState(() => Date.now())
  const [done, setDone] = useState(false)
  useScreenAwake(until !== null)

  useEffect(() => {
    if (until === null) return
    const finish = () => {
      const moment = Date.now()
      setNow(moment)
      if (moment < until) return
      navigator.vibrate?.([300, 150, 300])
      writeUntil(null)
      setUntil(null)
      setDone(true)
    }
    finish()
    const timer = window.setInterval(finish, 250)
    return () => window.clearInterval(timer)
  }, [until])

  function start() {
    const next = Date.now() + COOPER_SECONDS * 1000
    writeUntil(next)
    setDone(false)
    setNow(Date.now())
    setUntil(next)
  }

  function stop() {
    writeUntil(null)
    setUntil(null)
  }

  const remaining = until === null ? COOPER_SECONDS : Math.max(0, Math.ceil((until - now) / 1000))

  return (
    <section
      aria-label={t('fitness.timer')}
      className="grid justify-items-center gap-3 rounded-lg border p-4"
    >
      <h3 className="text-sm font-medium">{t('fitness.timer')}</h3>
      <p role="timer" aria-live="off" className="text-5xl font-semibold tabular-nums">
        {clock(remaining)}
      </p>
      {until === null ? (
        <Button className="h-11 w-full max-w-xs" onClick={start}>
          {t('fitness.timerStart')}
        </Button>
      ) : (
        <Button variant="outline" className="h-11 w-full max-w-xs" onClick={stop}>
          {t('fitness.timerStop')}
        </Button>
      )}
      {done ? (
        <p role="status" className="grid justify-items-center gap-2 text-center text-sm">
          {t('fitness.timerDone')}
          <Link
            to="/workouts/tests/$test/new"
            params={{ test: 'cooper' }}
            className="text-primary underline"
          >
            {t('fitness.enter')}
          </Link>
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">{t('fitness.timerHint')}</p>
      )}
    </section>
  )
}
