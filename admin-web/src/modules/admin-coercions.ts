export function identifier(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return text && text.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(text) ? text : ''
}

export function positiveVersion(value: unknown): number | null {
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 1 ? version : null
}

export function nonNegativeVersion(value: unknown): number | null {
  const version = Number(value)
  return Number.isSafeInteger(version) && version >= 0 ? version : null
}

export function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= minimum && number <= maximum ? number : null
}

export function uniqueStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter(item => typeof item === 'string' && item.trim()).map(String))]
    : []
}

export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}
