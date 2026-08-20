function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function replaceCloudFileUrls<T>(value: T, urls: ReadonlyMap<string, string>): T {
  if (typeof value === 'string') {
    return (urls.has(value) ? urls.get(value) : value) as T
  }
  if (Array.isArray(value)) {
    return value.map(item => replaceCloudFileUrls(item, urls)) as T
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceCloudFileUrls(item, urls)]),
    ) as T
  }
  return value
}
