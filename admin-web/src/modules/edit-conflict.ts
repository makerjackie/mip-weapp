import type { OperationValues } from './admin-operation-ui.ts'

/** Rebase only locally changed fields; preserve concurrent edits to untouched fields. */
export function rebaseEdit(original: OperationValues, local: OperationValues, latest: OperationValues): OperationValues {
  const result: OperationValues = { ...latest }
  for (const key of Object.keys(local)) {
    if (key === 'expectedVersion') continue
    const before = original[key]
    const after = local[key]
    if (JSON.stringify(before) === JSON.stringify(after)) continue
    result[key] = isRecord(before) && isRecord(after) && isRecord(latest[key])
      ? rebaseEdit(before, after, latest[key])
      : structuredClone(after)
  }
  return result
}

function isRecord(value: unknown): value is OperationValues {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
