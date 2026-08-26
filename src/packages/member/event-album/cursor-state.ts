export type AlbumPageCursor = string | null

export function albumPageCursor(value: string | null | undefined): AlbumPageCursor {
  return value || null
}

export function albumRequestCursor(reset: boolean, cursor: AlbumPageCursor) {
  return reset ? undefined : cursor || undefined
}
