import assert from 'node:assert/strict'
import { it } from 'node:test'
import { eventPrivateDrafts } from './event-private-drafts.ts'
import type { AdminRequestInput } from '../domain/contracts.ts'

it('uses the same request key for an ambiguous draft save, isolates records and preserves zero/media', async () => {
  const calls: AdminRequestInput[] = []
  let fail = true
  const drafts = eventPrivateDrafts(async <T>(action: string, input?: AdminRequestInput) => {
    if (action.endsWith('.get')) return { draftId: '17', eventId: 'event-b', draftData: {}, version: 1 } as T
    calls.push(input!)
    if (fail) { fail = false; throw new Error('Temporary failure') }
    return { draftId: '17', version: 1 } as T
  }, 'event-a')
  const values = { title: '部分填写', priceCents: 0, waitlistEnabled: false, contentMedia: [{ assetId: 'media', caption: '图注' }], _mediaUrls: { media: 'https://temp.example/image' } }
  await assert.rejects(drafts.save(values), /Temporary/)
  assert.equal((await drafts.save(values))._draftId, '17')
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey)
  assert.deepEqual(calls[1].draftData, { title: '部分填写', priceCents: 0, waitlistEnabled: false, contentMedia: [{ assetId: 'media', caption: '图注' }] })
  await drafts.save({ ...values, title: '改动后' })
  assert.notEqual(calls[1].idempotencyKey, calls[2].idempotencyKey)
  await assert.rejects(drafts.load('17'), /不属于当前活动/)
})

it('rehydrates saved asset previews from the read projection without persisting temporary URLs', async () => {
  let stored: Record<string, unknown> = {}
  const drafts = eventPrivateDrafts(async <T>(action: string, input?: AdminRequestInput) => {
    if (action.endsWith('.save')) {
      stored = structuredClone(input!.draftData as Record<string, unknown>)
      return { draftId: '8', version: 1 } as T
    }
    return { draftId: '8', eventId: null, draftData: stored, version: 1, mediaPreviews: [
      { assetId: 'cover', imageUrl: 'https://media.example/cover.png?sign=fresh' },
      { assetId: 'body', imageUrl: 'https://media.example/body.png?sign=fresh' },
      { assetId: 'unsafe', imageUrl: 'javascript:alert(1)' },
      { assetId: 'unresolved', imageUrl: 'cloud://still-unresolved' },
    ] } as T
  }, '')
  await drafts.save({ title: '重新打开', coverAssetId: 'cover', contentMedia: [{ assetId: 'body' }],
    _mediaUrls: { cover: 'blob:local-upload' } })
  const restored = await drafts.load('8')
  assert.deepEqual(restored?._mediaUrls, { cover: 'https://media.example/cover.png?sign=fresh', body: 'https://media.example/body.png?sign=fresh' })
  assert.equal(restored?.coverAssetId, 'cover')
  await drafts.save(restored!)
  assert.deepEqual(stored, { title: '重新打开', coverAssetId: 'cover', contentMedia: [{ assetId: 'body' }], eventId: '' })
  assert.doesNotMatch(JSON.stringify(stored), /https:|blob:|mediaPreviews|_mediaUrls/)
})
