import { defaultOperationValues, type OperationField, type OperationValues } from '../../modules/admin-operation-ui'

/** Builds default form values from a content mutation field list. */
export function defaultContentFormValues(fields: readonly OperationField[]): OperationValues {
  return defaultOperationValues(fields)
}
