export function createLabelPresenter<Value extends string>(
  labels: Partial<Record<Value, string>>,
  fallback: (value: Value) => string = value => value,
) {
  return (value: Value) => labels[value] || fallback(value)
}

export function formatMinorUnits(
  amount: number,
  options: {
    fractionDigits?: number
    prefix?: string
    scale?: number
  } = {},
) {
  const scale = options.scale ?? 100
  const fractionDigits = options.fractionDigits ?? 2
  const prefix = options.prefix ?? '¥'
  if (!Number.isFinite(amount) || !Number.isFinite(scale) || scale <= 0) {
    throw new Error('A finite amount and positive scale are required')
  }
  return `${prefix}${(amount / scale).toFixed(fractionDigits)}`
}

export function formatRecordCode(
  id: string,
  options: {
    length?: number
    prefix?: string
    uppercase?: boolean
  } = {},
) {
  const length = Math.max(1, options.length ?? 8)
  const raw = id.slice(-length)
  const code = options.uppercase === false ? raw : raw.toUpperCase()
  return options.prefix ? `${options.prefix} ${code}` : code
}
