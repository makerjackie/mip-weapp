import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AdminRequest } from './admin-read-contracts.ts'
import {
  buildVideoInput,
  loadVideos,
  videoEditorValues,
  videoFromDto,
} from './admin-video-management.ts'

const VIDEO_ID = '42'
const ASSET_ID = '20000000-0000-4000-8000-000000000002'

function requestWith(responses: Record<string, unknown>, calls: Array<{ action: string; input: unknown }>): AdminRequest {
  return async <T>(action: string, input = {}) => {
    calls.push({ action, input })
    return responses[action] as T
  }
}

const videoDto = {
  id: VIDEO_ID,
  videoId: VIDEO_ID,
  title: 'MIP 反人性早会第 328 场',
  coverAssetId: ASSET_ID,
  coverUrl: 'cloud://env.mip/cover.jpg',
  finderUserName: 'sphMIP2026',
  feedId: 'feed-token-1',
  status: 'PUBLISHED',
  version: 3,
  contentSafetyStatus: 'APPROVED',
  createdAt: '2030-03-01T00:00:00.000Z',
  updatedAt: '2030-03-01T00:00:00.000Z',
}

describe('admin video recap management', () => {
  it('loads recap videos with their channels destination instead of a jump url', async () => {
    const calls: Array<{ action: string; input: unknown }> = []
    const page = await loadVideos(requestWith({
      'mip.admin.videos.list': { items: [videoDto], nextCursor: null },
    }, calls), { videoId: VIDEO_ID })
    assert.deepEqual(calls, [{ action: 'mip.admin.videos.list', input: { videoId: VIDEO_ID, limit: 1 } }])
    assert.equal(page.items[0].finderUserName, 'sphMIP2026')
    assert.equal(page.items[0].feedId, 'feed-token-1')
    assert.equal('jumpUrl' in page.items[0], false)
    assert.equal('jumpUrl' in videoFromDto(videoDto), false)
  })

  it('round-trips the editor values and keeps a cleared feed id as a profile jump', () => {
    const values = videoEditorValues(videoFromDto(videoDto))
    assert.equal(values.finderUserName, 'sphMIP2026')
    assert.equal(values.feedId, 'feed-token-1')

    const built = buildVideoInput({ ...values, feedId: '' })
    assert.ok(built.ok)
    if (built.ok) {
      assert.equal(built.input.finderUserName, 'sphMIP2026')
      assert.equal('feedId' in built.input, false)
    }
  })

  it('rejects a non-sph finder id and a malformed feed id before calling the server', () => {
    const base = { title: 'MIP 反人性早会', coverAssetId: ASSET_ID, status: 'PUBLISHED', expectedVersion: 3, videoId: VIDEO_ID }
    assert.equal(buildVideoInput({ ...base, finderUserName: 'invalid-finder' }).ok, false)
    assert.equal(buildVideoInput({ ...base, finderUserName: '' }).ok, false)
    assert.equal(buildVideoInput({ ...base, finderUserName: 'sphMIP2026', feedId: 'bad feed id' }).ok, false)
    assert.equal(buildVideoInput({ ...base, finderUserName: 'sphMIP2026', feedId: 'feed-token-1' }).ok, true)
  })
})
