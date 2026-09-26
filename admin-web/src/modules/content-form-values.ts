import type { OperationField, OperationValues } from './admin-operation-ui'
import { getContentMutationForm, USER_CONTENT_ROLE_FIELDS, type ContentMutationAction } from './content-mutation-forms'

/** Project the selected content type and role; Ant Form preserves hidden fields. */
function buildUserContentDraft(values: OperationValues) {
  const kind = String(values.kind || '')
  const draft = record(values.draft)
  if (kind === 'COOPERATION_CARD') {
    const roleKey = String(draft.roleKey || '') as keyof typeof USER_CONTENT_ROLE_FIELDS
    const sourceRoleFields = record(draft.roleFields)
    const roleFields = Object.fromEntries((USER_CONTENT_ROLE_FIELDS[roleKey] || [])
      .flatMap(key => nonEmpty(sourceRoleFields[key]) ? [[key, sourceRoleFields[key]]] : []))
    return {
      kind,
      roleKey,
      positioning: draft.positioning,
      targetSummary: draft.targetSummary,
      roleFields,
      abilityScores: record(draft.abilityScores),
      status: draft.status,
    }
  }
  const output: OperationValues = { kind }
  for (const key of ['projectName', 'summary', 'startedOn', 'endedOn', 'responsibility', 'cityTagId', 'industryTagId', 'caseType', 'description', 'coverAssetId', 'mediaAssetIds', 'status']) {
    const value = draft[key]
    if (value !== undefined && (nonEmpty(value) || key === 'mediaAssetIds')) output[key] = dateOnly(key, value)
  }
  return output
}

function dateOnly(key: string, value: unknown) {
  return ['startedOn', 'endedOn'].includes(key) && typeof value === 'string' && value.length >= 10
    ? value.slice(0, 10)
    : value
}

function nonEmpty(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? Boolean(value.trim()) : value !== undefined && value !== null
}

function record(value: unknown): OperationValues {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as OperationValues : {}
}

export function contentFormValues(action: ContentMutationAction, values: OperationValues, idempotencyKey: string) {
  const next = pruneEmptyGroups({ ...values })
  const form = getContentMutationForm(action)
  if (form.idempotencyRequired) next.idempotencyKey = idempotencyKey
  if (action === 'mip.admin.opportunities.save') {
    const draft = record(next.draft)
    const terms = record(draft.commercialTerms)
    if (!terms.minAmountCents && !terms.maxAmountCents && !Array.isArray(terms.locations)) delete draft.commercialTerms
    next.draft = draft
  }
  if (action === 'mip.admin.userContent.save') next.draft = buildUserContentDraft(next)
  return next
}

export function normalizeContentFields(fields: readonly OperationField[]): readonly OperationField[] {
  return fields.map(field => ({
    ...field,
    ...(String(field.key || field.name || '') === 'roleKeys' ? { kind: 'multi-select' } : {}),
    ...(field.fields ? { fields: normalizeContentFields(field.fields) } : {}),
  })) as readonly OperationField[]
}

function pruneEmptyGroups(value: OperationValues): OperationValues {
  const output: OperationValues = {}
  for (const [key, item] of Object.entries(value)) {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const nested = pruneEmptyGroups(item as OperationValues)
      if (Object.keys(nested).length) output[key] = nested
    }
    else output[key] = item
  }
  return output
}
