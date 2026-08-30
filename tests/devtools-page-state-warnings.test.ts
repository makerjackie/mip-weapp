import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearPolicyCapabilitySelection,
  hasSelectedPolicyCapability,
  replacePolicyCapabilitySelection,
  selectedPolicyCapabilities,
  togglePolicyCapabilitySelection,
} from '../src/packages/admin/roles/private-policy-selection'
import {
  albumPageCursor,
  albumRequestCursor,
} from '../src/packages/member/event-album/cursor-state'

const root = path.resolve(import.meta.dirname, '..')
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

describe('DevTools Page state warning regressions', () => {
  it('keeps mutable role policy selections outside enumerable Page fields', () => {
    const owner = {}
    const otherOwner = {}
    replacePolicyCapabilitySelection(owner, ['users.read', 'events.read'])

    expect(hasSelectedPolicyCapability(owner, 'users.read')).toBe(true)
    expect(hasSelectedPolicyCapability(otherOwner, 'users.read')).toBe(false)
    togglePolicyCapabilitySelection(owner, 'users.read')
    togglePolicyCapabilitySelection(owner, 'orders.read')
    expect(selectedPolicyCapabilities(owner, ['users.read', 'events.read', 'orders.read']))
      .toEqual(['events.read', 'orders.read'])

    clearPolicyCapabilitySelection(owner)
    expect(selectedPolicyCapabilities(owner, ['events.read', 'orders.read'])).toEqual([])

    const source = read('src/packages/admin/roles/index.ts')
    const freeFields = source.slice(source.indexOf('  actorRoles:'), source.indexOf('\n\n  onShow()'))
    expect(freeFields).not.toContain('pendingPolicyCapabilities')
    expect(freeFields).not.toContain('new Set')
    expect(source).not.toContain('this.pendingPolicyCapabilities')
  })

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
