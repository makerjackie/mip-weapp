import { createContext, useContext } from 'react'
export const MediaPreviewContext = createContext<{ urls: Record<string, string>; remember: (id: string, url: string) => void; forget: (id: string) => void }>({ urls: {}, remember: () => {}, forget: () => {} })
export const useMediaPreview = () => useContext(MediaPreviewContext)
