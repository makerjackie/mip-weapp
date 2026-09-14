import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  albumPageCursor,
  albumRequestCursor,
} from '../src/packages/member/event-album/cursor-state'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('DevTools Page state warning regressions', () => {
  it('keeps album cursors serializable in Page data and optional only at the gateway edge', () => {
    expect(albumPageCursor(undefined)).toBeNull()
    expect(albumPageCursor(null)).toBeNull()
    expect(albumPageCursor('cursor-next')).toBe('cursor-next')
    expect(albumRequestCursor(true, 'cursor-old')).toBeUndefined()
    expect(albumRequestCursor(false, null)).toBeUndefined()
    expect(albumRequestCursor(false, 'cursor-next')).toBe('cursor-next')

    const source = read('src/packages/member/event-album/index.ts')
    const dataBlock = source.slice(source.indexOf('  data: {'), source.indexOf('\n  },', source.indexOf('  data: {')))
    const cursorAssignments = [...source.matchAll(/\bcursor:\s*([^,\n}]+)/g)].map(match => match[1])
    expect(dataBlock).toContain('cursor: null as AlbumPageCursor')
    expect(dataBlock).not.toContain('undefined')
    expect(cursorAssignments).toEqual([
      'null as AlbumPageCursor',
      'albumPageCursor(publicPage.nextCursor)',
    ])
    expect(source).toContain('albumRequestCursor(reset, this.data.cursor)')
  })
})
