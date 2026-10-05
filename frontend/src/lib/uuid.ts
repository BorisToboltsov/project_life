/**
 * UUID версии 7: первые 48 бит — время в миллисекундах, остальное случайно. Ключ записи
 * выбирает клиент, чтобы повторная отправка не создавала дубль (ADR 0002).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let timestamp = now
  for (let index = 5; index >= 0; index--) {
    bytes[index] = timestamp % 256
    timestamp = Math.floor(timestamp / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70 // версия 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // вариант RFC 9562
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
