import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { MediaPreviewContext } from './media-preview-context'
export function MediaPreviewProvider({ existingUrls, children }: { existingUrls: Record<string, string>; children: ReactNode }) {
  const [uploaded, setUploaded] = useState<Record<string, string>>({})
  const remember = useCallback((id: string, url: string) => setUploaded(current => ({ ...current, [id]: url })), [])
  const value = useMemo(() => ({ urls: { ...existingUrls, ...uploaded }, remember }), [existingUrls, uploaded, remember])
  return <MediaPreviewContext.Provider value={value}>{children}</MediaPreviewContext.Provider>
}
