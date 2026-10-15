export interface RestState {
  until: number
  duration: number
}

export function readRestTimer(key: string): RestState | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as RestState | null
  } catch {
    return null
  }
}

export function startRestTimer(workoutId: string, seconds: number): void {
  if (seconds <= 0) return
  sessionStorage.setItem(
    `workout-rest-${workoutId}`,
    JSON.stringify({
      until: Date.now() + seconds * 1000,
      duration: seconds,
    }),
  )
  window.dispatchEvent(new Event('workout-rest-change'))
}
