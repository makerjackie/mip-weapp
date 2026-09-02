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

  it('creates AI draft request slots per page lifecycle instead of in the Page definition', () => {
    const source = read('src/packages/member/mip-ai/index.ts')
    const pageFields = source.slice(
      source.indexOf('  voiceRecorder:'),
      source.indexOf('\n\n  onLoad()'),
    )
    const onLoad = source.slice(
      source.indexOf('  onLoad()'),
      source.indexOf('\n\n  onUnload()'),
    )

    expect(pageFields).toContain('textDraftRequest: null as AiDraftRequestSlot | null')
    expect(pageFields).toContain('voiceDraftRequest: null as AiDraftRequestSlot | null')
    expect(pageFields).not.toContain('createAiDraftRequestSlot(')
    expect(onLoad).toContain('this.textDraftRequest = createAiDraftRequestSlot(\'ai-draft-text\')')
    expect(onLoad).toContain('this.voiceDraftRequest = createAiDraftRequestSlot(\'ai-draft-upload\')')

    expect(source).toContain('const requestSlot = this.getTextDraftRequest()')
    expect(source).toContain('const unchangedSubmission = requestSlot.matches(requestId)')
    expect(source).toContain('requestSlot.matches(requestId) && !shouldRetainAiDraftRequest(error)')
    expect(source).toContain('const requestSlot = this.getVoiceDraftRequest()')
    expect(source).toContain('requestSlot.rotate()')
  })
})
