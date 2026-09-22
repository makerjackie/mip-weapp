import type { OperationField, OperationValues } from '../../modules/admin-operation-ui'

/**
 * Builds default form values from a content mutation field list,
 * mirroring the logic in operation-model.ts defaultValues().
 */
export function defaultContentFormValues(fields: readonly OperationField[]): OperationValues {
  const values: OperationValues = {}
  for (const field of fields) {
    const key = String(field.key || field.name || '')
    if (!key) continue
    if (field.kind === 'group') values[key] = defaultContentFormValues(field.fields || [])
    else if (field.kind === 'checkbox' || field.kind === 'boolean') values[key] = false
    else if (['id-list', 'profile-ref-list', 'asset-list', 'tags', 'multi-select'].includes(field.kind)) values[key] = []
    else if (field.kind === 'select') {
      const first = field.options?.[0]
      values[key] = field.required && first ? (typeof first === 'string' ? first : first.value) : ''
    }
    else values[key] = ''
  }
  return values
}
