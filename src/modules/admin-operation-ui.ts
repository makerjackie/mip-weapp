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

export interface OperationDialogState {
  title: string
  description: string
  fields: readonly OperationField[]
  values: OperationValues
  busy: boolean
  error: string
}

type HtmlEscaper = (value: unknown) => string

export function renderOperationDialog(state: OperationDialogState, escapeHtml: HtmlEscaper) {
  const fields = renderFields(state.fields, state.values, escapeHtml)
  const error = state.error
    ? `<div class="mutation-error" role="alert">${escapeHtml(state.error)}<small>请求结果不确定时，请先刷新并核对服务端记录。</small></div>`
    : ''
  return `<div class="mutation-backdrop" id="operation-backdrop"><section class="mutation-dialog operation-dialog" role="dialog" aria-modal="true" aria-labelledby="operation-title"><button id="operation-close-button" class="login-close" aria-label="关闭" ${state.busy ? 'disabled' : ''}>×</button><span class="login-kicker">运营操作</span><h2 id="operation-title">${escapeHtml(state.title)}</h2><p>${escapeHtml(state.description)}</p><form id="operation-form"><div class="mutation-fields operation-fields">${fields}</div>${error}<div class="mutation-actions"><button type="button" class="outline-button" id="operation-cancel-button" ${state.busy ? 'disabled' : ''}>取消</button><button type="submit" class="primary-button" ${state.busy ? 'disabled' : ''}>${state.busy ? '提交中' : '确认提交'}</button></div></form></section></div>`
}

export function readOperationValues(
  fields: readonly OperationField[],
  data: FormData,
  previous: OperationValues,
) {
  const values = cloneValues(previous)
  for (const field of fields) readFieldValue(values, field, data, '')
  return values
}

function renderFields(
  fields: readonly OperationField[],
  values: OperationValues,
  escapeHtml: HtmlEscaper,
  prefix = '',
): string {
  return fields.filter(field => !field.hidden).map((field) => {
    const key = fieldKey(field)
    if (!key) return ''
    const path = prefix ? `${prefix}.${key}` : key
    if (field.kind === 'group') {
      const nested = recordValue(readPath(values, path))
      return `<fieldset class="operation-group"><legend>${escapeHtml(field.label)}</legend>${renderFields(field.fields || [], nested, escapeHtml, '')}</fieldset>`
    }
    return renderField(field, path, readPath(values, path), escapeHtml)
  }).join('')
}

function renderField(field: OperationField, path: string, raw: unknown, escapeHtml: HtmlEscaper) {
  const required = field.required ? 'required' : ''
  const maximum = Number.isSafeInteger(field.maxLength) ? `maxlength="${field.maxLength}"` : ''
  const className = field.wide || ['textarea', 'asset-list', 'id-list', 'profile-ref-list', 'tags'].includes(field.kind)
    ? ' class="mutation-wide"'
    : ''
  if (field.kind === 'checkbox' || field.kind === 'boolean') {
    const checkboxClass = field.wide ? ' class="mutation-wide mutation-checkbox"' : ' class="mutation-checkbox"'
    return `<label${checkboxClass}><input name="${escapeHtml(path)}" type="checkbox" ${raw === true ? 'checked' : ''} />${escapeHtml(field.label)}</label>`
  }
  if (field.kind === 'select' || field.kind === 'multi-select') {
    const selected = new Set(Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')])
    const options = (field.options || []).map((option) => {
      const normalized = typeof option === 'string' ? { value: option, label: option } : option
      return `<option value="${escapeHtml(normalized.value)}" ${selected.has(normalized.value) ? 'selected' : ''}>${escapeHtml(normalized.label)}</option>`
    }).join('')
    return `<label${className}>${escapeHtml(field.label)}<select name="${escapeHtml(path)}" ${field.kind === 'multi-select' ? 'multiple' : ''} ${required}>${field.required ? '' : '<option value="">未设置</option>'}${options}</select></label>`
  }
  if (field.kind === 'textarea') {
    return `<label${className}>${escapeHtml(field.label)}<textarea name="${escapeHtml(path)}" rows="4" ${maximum} ${required}>${escapeHtml(raw ?? '')}</textarea></label>`
  }
  if (['asset-list', 'id-list', 'profile-ref-list', 'tags'].includes(field.kind)) {
    const value = listText(raw, field.kind)
    return `<label${className}>${escapeHtml(field.label)}<textarea name="${escapeHtml(path)}" rows="3" ${required}>${escapeHtml(value)}</textarea><small>每行填写一项</small></label>`
  }
  const inputType = field.kind === 'datetime' || field.kind === 'datetime-local'
    ? 'datetime-local'
    : field.kind === 'date' || field.kind === 'time' || field.kind === 'url'
      ? field.kind
      : ['number', 'integer'].includes(field.kind)
        ? 'number'
        : 'text'
  return `<label${className}>${escapeHtml(field.label)}<input name="${escapeHtml(path)}" type="${inputType}" value="${escapeHtml(inputValue(raw, inputType))}" ${maximum} ${required} /></label>`
}

function readFieldValue(target: OperationValues, field: OperationField, data: FormData, prefix: string) {
  if (field.hidden) return
  const key = fieldKey(field)
  if (!key) return
  const path = prefix ? `${prefix}.${key}` : key
  if (field.kind === 'group') {
    for (const nested of field.fields || []) readFieldValue(target, nested, data, path)
    return
  }
  if (field.kind === 'checkbox' || field.kind === 'boolean') {
    writePath(target, path, data.get(path) === 'on')
    return
  }
  if (field.kind === 'multi-select') {
    writePath(target, path, data.getAll(path).map(String).filter(Boolean))
    return
  }
  const raw = String(data.get(path) || '').trim()
  if (['id-list', 'profile-ref-list', 'tags'].includes(field.kind)) {
    writePath(target, path, splitLines(raw))
    return
  }
  if (field.kind === 'asset-list') {
    writePath(target, path, splitLines(raw).map(assetId => ({ assetId, caption: '' })))
    return
  }
  if (['number', 'integer'].includes(field.kind)) {
    writePath(target, path, raw === '' ? '' : Number(raw))
    return
  }
  writePath(target, path, raw)
}

function fieldKey(field: OperationField) {
  return String(field.name || field.key || '').trim()
}

function splitLines(value: string) {
  return value.split(/[\n,，]/).map(item => item.trim()).filter(Boolean)
}

function listText(value: unknown, kind: string) {
  if (!Array.isArray(value)) return ''
  if (kind === 'asset-list') return value.map(item => String(recordValue(item).assetId || '')).filter(Boolean).join('\n')
  return value.map(String).join('\n')
}

function inputValue(value: unknown, inputType: string) {
  if (inputType !== 'datetime-local' || typeof value !== 'string') return value ?? ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
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
