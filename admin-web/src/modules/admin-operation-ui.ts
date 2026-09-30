import { record } from './admin-read-formatters.ts'
import type { AdminRequestInput } from '../domain/contracts'

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
  visibleWhen?: {
    path: string
    value: string | readonly string[]
  }
  /** Upload purpose for asset/asset-list fields, used by AssetUploader. */
  assetPurpose?: string
  /** Renders a session-backed searchable user picker instead of a static Select. */
  remoteUserSearch?: boolean
  /** Renders a session-backed catalog Select loaded from this query action. */
  optionsAction?: string
  optionsInput?: Record<string, unknown>
  optionsValueKey?: string
  userSearchInput?: AdminRequestInput
  userSearchAction?: string
  optionsKey?: string
  optionsFilter?: { path: string; key: string }
  optionsActionByValue?: { path: string; actions: Record<string, string> }
  valueScale?: number
  readOnly?: boolean
  readOnlyReason?: string
}

export type OperationValues = Record<string, unknown>

/** Field kinds that hold a list of values rather than a scalar. */
export const MULTI_VALUE_KINDS: readonly string[] = ['id-list', 'profile-ref-list', 'asset-list', 'tags', 'multi-select', 'commercial-locations']
/** Field kinds whose editor is a textarea / line list. */
export const TEXTAREA_LIKE_KINDS: readonly string[] = ['asset-list', 'id-list', 'profile-ref-list', 'tags']
/** Field kinds serialized as newline-joined id lists. */
export const LINE_LIST_KINDS: readonly string[] = ['id-list', 'profile-ref-list', 'tags']
/** Field kinds bound to a Dayjs value. */
export const DATE_KINDS: readonly string[] = ['datetime', 'datetime-local', 'date']

export function operationFieldName(field: OperationField) {
  return String(field.name || field.key || '')
}

/** Builds default form values from an operation field list (recurses into groups). */
export function defaultOperationValues(fields: readonly OperationField[]): OperationValues {
  const values: OperationValues = {}
  for (const field of fields) {
    const key = operationFieldName(field)
    if (!key) continue
    if (field.kind === 'group') values[key] = defaultOperationValues(field.fields || [])
    else if (field.kind === 'checkbox' || field.kind === 'boolean') values[key] = false
    else if (MULTI_VALUE_KINDS.includes(field.kind)) values[key] = []
    else if (field.kind === 'select') {
      const first = field.options?.[0]
      values[key] = field.required && first ? (typeof first === 'string' ? first : first.value) : ''
    }
    else values[key] = ''
  }
  return values
}

export function normalizeOperationValues(
  fields: readonly OperationField[],
  submitted: OperationValues,
  previous: OperationValues = {},
) {
  const values = cloneValues(previous)
  for (const field of fields) normalizeSubmittedField(values, submitted, field, '')
  return values
}

export function operationFieldVisible(field: OperationField, values: OperationValues) {
  if (!field.visibleWhen) return true
  const actual = readPath(values, field.visibleWhen.path)
  return Array.isArray(field.visibleWhen.value) ? field.visibleWhen.value.includes(actual) : actual === field.visibleWhen.value
}

function normalizeSubmittedField(
  target: OperationValues,
  submitted: OperationValues,
  field: OperationField,
  prefix: string,
) {
  if (!operationFieldVisible(field, submitted)) return
  if (field.hidden) return
  const key = fieldKey(field)
  if (!key) return
  const path = prefix ? `${prefix}.${key}` : key
  if (field.kind === 'group') {
    for (const nested of field.fields || []) normalizeSubmittedField(target, submitted, nested, path)
    return
  }
  const raw = readPath(submitted, path)
  if (field.kind === 'money') {
    const value = raw === null || raw === undefined || raw === '' ? null : Math.round(Number(raw) * (field.valueScale || 100))
    writePath(target, path, value)
    return
  }
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
    writePath(target, path, normalizeAssetList(raw, readPath(target, path)))
    return
  }
  if (field.kind === 'date' && raw && typeof raw === 'object'
    && 'format' in raw && typeof raw.format === 'function') {
    writePath(target, path, raw.format('YYYY-MM-DD'))
    return
  }
  if (['datetime', 'datetime-local'].includes(field.kind)
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

function normalizeAssetList(value: unknown, previous: unknown) {
  const previousItems = assetListItems(previous)
  const previousById = new Map<string, OperationValues>()
  for (const item of previousItems) {
    const assetId = assetIdFrom(item)
    if (assetId && !previousById.has(assetId)) previousById.set(assetId, record(item))
  }

  const submittedItems = typeof value === 'string'
    ? splitLines(value)
    : Array.isArray(value) ? value : []
  const seen = new Set<string>()
  const normalized: OperationValues[] = []
  for (const item of submittedItems) {
    const assetId = assetIdFrom(item)
    if (!assetId || seen.has(assetId)) continue
    seen.add(assetId)

    const submittedItem = record(item)
    const previousItem = previousById.get(assetId)
    const caption = Object.hasOwn(submittedItem, 'caption')
      ? String(submittedItem.caption ?? '')
      : String(previousItem?.caption ?? '')
    normalized.push({ assetId, caption })
  }
  return normalized
}

function assetListItems(value: unknown) {
  if (typeof value === 'string') return splitLines(value)
  return Array.isArray(value) ? value : []
}

function assetIdFrom(value: unknown) {
  const candidate = typeof value === 'string' ? value : record(value).assetId
  return String(candidate ?? '').trim()
}

function readPath(value: OperationValues, path: string) {
  return path.split('.').reduce<unknown>((current, key) => record(current)[key], value)
}

function writePath(value: OperationValues, path: string, next: unknown) {
  const parts = path.split('.')
  let current = value
  for (const part of parts.slice(0, -1)) {
    const child = record(current[part])
    current[part] = child
    current = child
  }
  current[parts.at(-1)!] = next
}

function cloneValues(value: OperationValues): OperationValues {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as OperationValues
}
