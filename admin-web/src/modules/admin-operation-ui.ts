export type OperationFieldOption = string | { value: string; label: string }

export interface OperationField {
  key?: string
  name?: string
  label: string
  kind: string
  required?: boolean
  hidden?: boolean
  wide?: boolean
  maxLength?: number
  options?: readonly OperationFieldOption[]
  fields?: readonly OperationField[]
}

export type OperationValues = Record<string, unknown>

export function normalizeOperationValues(
  fields: readonly OperationField[],
  submitted: OperationValues,
  previous: OperationValues = {},
) {
  const values = cloneValues(previous)
  for (const field of fields) normalizeSubmittedField(values, submitted, field, '')
  return values
}

function normalizeSubmittedField(
  target: OperationValues,
  submitted: OperationValues,
  field: OperationField,
  prefix: string,
) {
  if (field.hidden) return
  const key = fieldKey(field)
  if (!key) return
  const path = prefix ? `${prefix}.${key}` : key
  if (field.kind === 'group') {
    for (const nested of field.fields || []) normalizeSubmittedField(target, submitted, nested, path)
    return
  }
  const raw = readPath(submitted, path)
  if (field.kind === 'checkbox' || field.kind === 'boolean') {
    writePath(target, path, raw === true)
    return
  }
  if (field.kind === 'multi-select') {
    writePath(target, path, Array.isArray(raw) ? raw.map(String).filter(Boolean) : [])
    return
  }
  if (['id-list', 'profile-ref-list', 'tags'].includes(field.kind)) {
    writePath(target, path, splitLines(String(raw || '')))
    return
  }
  if (field.kind === 'asset-list') {
    writePath(target, path, splitLines(String(raw || '')).map(assetId => ({ assetId, caption: '' })))
    return
  }
  if (['datetime', 'datetime-local', 'date'].includes(field.kind)
    && raw && typeof raw === 'object' && 'toISOString' in raw
    && typeof raw.toISOString === 'function') {
    writePath(target, path, raw.toISOString())
    return
  }
  writePath(target, path, raw ?? '')
}

function fieldKey(field: OperationField) {
  return String(field.name || field.key || '').trim()
}

function splitLines(value: string) {
  return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
}

function readPath(value: OperationValues, path: string) {
  return path.split('.').reduce<unknown>((current, key) => recordValue(current)[key], value)
}

function writePath(value: OperationValues, path: string, next: unknown) {
  const parts = path.split('.')
  let current = value
  for (const part of parts.slice(0, -1)) {
    const child = recordValue(current[part])
    current[part] = child
    current = child
  }
  current[parts.at(-1)!] = next
}

function recordValue(value: unknown): OperationValues {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as OperationValues : {}
}

function cloneValues(value: OperationValues): OperationValues {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as OperationValues
}
