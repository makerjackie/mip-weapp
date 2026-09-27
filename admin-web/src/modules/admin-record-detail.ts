/** A read-only detail view a list row can carry when the server exposes no `*.get`. */
export interface RecordDetailEntry {
  label: string
  value: string
}

export interface RecordDetail {
  title: string
  entries: readonly RecordDetailEntry[]
}

export function isRecordDetail(value: unknown): value is RecordDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Partial<RecordDetail>
  return typeof candidate.title === 'string' && Array.isArray(candidate.entries)
}
