import { createContext, useContext } from 'react'
export const MediaPreviewContext = createContext<{ urls: Record<string, string>; remember: (id: string, url: string) => void }>({ urls: {}, remember: () => {} })
export const useMediaPreview = () => useContext(MediaPreviewContext)
