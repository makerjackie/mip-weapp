import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { MediaPreviewContext } from './media-preview-context'
export function MediaPreviewProvider({ existingUrls, children }: { existingUrls: Record<string, string>; children: ReactNode }) {
  const [uploaded, setUploaded] = useState<Record<string, string>>({})
  const remember = useCallback((id: string, url: string) => setUploaded(current => ({ ...current, [id]: url })), [])
  const forget = useCallback((id: string) => setUploaded(current => {
    if (!(id in current)) return current
    const next = { ...current }
    delete next[id]
    return next
  }), [])
  const value = useMemo(() => ({ urls: { ...existingUrls, ...uploaded }, remember, forget }), [existingUrls, uploaded, remember, forget])
  return <MediaPreviewContext.Provider value={value}>{children}</MediaPreviewContext.Provider>
}
