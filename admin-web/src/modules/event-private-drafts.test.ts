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
  const values = { title: '部分填写', priceCents: 0, albumEnabled: false, contentMedia: [{ assetId: 'media', caption: '图注' }], _mediaUrls: { media: 'https://temp.example/image' } }
  await assert.rejects(drafts.save(values), /Temporary/)
  assert.equal((await drafts.save(values))._draftId, '17')
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey)
  assert.deepEqual(calls[1].draftData, { title: '部分填写', priceCents: 0, albumEnabled: false, contentMedia: [{ assetId: 'media', caption: '图注' }] })
  await drafts.save({ ...values, title: '改动后' })
  assert.notEqual(calls[1].idempotencyKey, calls[2].idempotencyKey)
  await assert.rejects(drafts.load('17'), /不属于当前活动/)
})
