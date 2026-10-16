import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { AdminApiClient, AdminApiClientError } from '../services/admin-api.ts'

const originalFetch = globalThis.fetch
const assetId = '10000000-0000-4000-8000-000000000001'

afterEach(() => { globalThis.fetch = originalFetch })

function pngFile() {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  bytes.set([0, 0, 0, 96, 0, 0, 0, 64], 16)
  return {
    name: 'banner.png',
    size: bytes.byteLength,
    type: 'image/png',
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  }
}

describe('admin media API client', () => {
  it('uses only the dedicated same-origin endpoint and strict upload envelope', async () => {
    const captured: { url: string; init: RequestInit } = { url: '', init: {} }
    globalThis.fetch = async (input, init) => {
      captured.url = String(input)
      captured.init = init || {}
      return Response.json({
        ok: true,
        data: { assetId, imageUrl: 'cloud://env.mip/mip/live/app/banners/image.png' },
      })
    }

    const result = await new AdminApiClient('/api/admin').uploadImage(pngFile(), 'BANNER')

    // 未带显式 cloudFileId 的旧响应：cloud:// 形态的 imageUrl 兜底为稳定引用。
    assert.deepEqual(result, {
      assetId,
      imageUrl: 'cloud://env.mip/mip/live/app/banners/image.png',
      cloudFileId: 'cloud://env.mip/mip/live/app/banners/image.png',
    })
    assert.equal(captured.url, '/api/media/image')
    assert.equal(captured.init.method, 'POST')
    assert.equal(captured.init.credentials, 'same-origin')
    assert.deepEqual(JSON.parse(String(captured.init.body)), {
      action: 'mip.admin.media.uploadImage',
      input: {
        purpose: 'BANNER',
        imageBase64: Buffer.from(await pngFile().arrayBuffer()).toString('base64'),
      },
    })
    assert.doesNotMatch(JSON.stringify(captured), /secret|signature|principal/i)
  })

  it('maps an upstream error and rejects malformed success results', async () => {
    const client = new AdminApiClient('/api/admin')
    globalThis.fetch = async () => Response.json({
      ok: false,
      error: { code: 'FORBIDDEN', message: '当前用途无权限', retryable: false },
    }, { status: 403 })
    await assert.rejects(
      () => client.uploadImage(pngFile(), 'BANNER'),
      (error: unknown) => error instanceof AdminApiClientError
        && error.code === 'FORBIDDEN' && error.message === '当前用途无权限',
    )

    globalThis.fetch = async () => Response.json({ ok: true, data: { assetId: 'invalid' } })
    await assert.rejects(
      () => client.uploadImage(pngFile(), 'BANNER'),
      (error: unknown) => error instanceof AdminApiClientError && error.code === 'INVALID_RESPONSE',
    )
  })

  it('retries once on a transient media failure, then succeeds', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      if (calls === 1) {
        return Response.json(
          { ok: false, error: { code: 'SERVICE_UNAVAILABLE', message: '素材服务暂时不可用', retryable: true } },
          { status: 503 },
        )
      }
      return Response.json({ ok: true, data: { assetId, imageUrl: 'cloud://env.mip/mip/live/app/banners/image.png' } })
    }
    const result = await new AdminApiClient('/api/admin').uploadImage(pngFile(), 'BANNER')
    assert.equal(calls, 2)
    assert.equal(result.assetId, assetId)
  })

  it('does not retry a non-transient media failure', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return Response.json({ ok: false, error: { code: 'FORBIDDEN', message: '当前用途无权限', retryable: false } }, { status: 403 })
    }
    await assert.rejects(() => new AdminApiClient('/api/admin').uploadImage(pngFile(), 'BANNER'))
    assert.equal(calls, 1)
  })
})
