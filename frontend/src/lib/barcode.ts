const EAN_8 = 8
const UPC_A = 12
const EAN_13 = 13

/** Контрольная цифра GS1: веса 3 и 1 чередуются от правого края. */
function checkDigit(body: string): number {
  let weighted = 0
  for (let index = 0; index < body.length; index++) {
    weighted += Number(body[body.length - 1 - index]) * (index % 2 === 0 ? 3 : 1)
  }
  return (10 - (weighted % 10)) % 10
}

/**
 * Штрихкод продукта в том виде, в каком его хранит каталог (ADR 0009): EAN-8 или EAN-13;
 * UPC-A из 12 цифр — тот же EAN-13 без ведущего нуля. `null` — это не штрихкод товара: не
 * цифры, не та длина или не сходится контрольная цифра. Сервер проверяет так же.
 */
export function normalizeBarcode(text: string): string | null {
  const code = text.replace(/[\s-]/g, '')
  if (!/^[0-9]+$/.test(code) || ![EAN_8, UPC_A, EAN_13].includes(code.length)) return null
  if (checkDigit(code.slice(0, -1)) !== Number(code.at(-1))) return null
  return code.length === UPC_A ? `0${code}` : code
}
