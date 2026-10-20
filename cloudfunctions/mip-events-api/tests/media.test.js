'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { eventMediaUrls } = require('../domain/media')

const publicFile = 'cloud://env.bucket/mip/production/app/event-covers/public.png'
const privateFile = 'cloud://env.bucket/mip/production/app/task-attachments/private.png'

describe('event media read boundary', () => {
  it('signs only files verified against event references, retaining app and caller scoping', async () => {
    const db = { async query(sql, params) {
      assert.match(sql, /asset\.app_id = \?/)
      assert.match(sql, /event\.published_at IS NOT NULL/)
      assert.match(sql, /owned_order\.user_id = \?/)
      assert.match(sql, /media\.status = 'ACTIVE'/)
      assert.match(sql, /video\.status = 'PUBLISHED'/)
      assert.deepEqual(params, ['app-a', publicFile, privateFile, 'user-a'])
      return [{ cloud_file_id: publicFile }]
    } }
    const cloud = { async getTempFileURL(input) {
      assert.deepEqual(input.fileList, [{ fileID: publicFile, maxAge: 600 }])
      return { fileList: [
        { fileID: publicFile, tempFileURL: 'https://cdn.example/public.png?sign=short', status: 0 },
        { fileID: privateFile, tempFileURL: 'https://cdn.example/private.png?sign=must-not-leak', status: 0 },
      ] }
    } }
    assert.deepEqual(await eventMediaUrls(db, cloud, {
      appId: 'app-a', userId: 'user-a', fileIds: [publicFile, privateFile, publicFile],
    }), { urls: { [publicFile]: 'https://cdn.example/public.png?sign=short' } })
  })

  it('does not ask storage to sign unreferenced or cross-app assets, including anonymous callers', async () => {
    let signed = false
    const result = await eventMediaUrls({ async query(_sql, params) {
      assert.deepEqual(params, ['app-a', privateFile, null])
      return []
    } }, { async getTempFileURL() { signed = true } }, { appId: 'app-a', fileIds: [privateFile] })
    assert.deepEqual(result, { urls: {} })
    assert.equal(signed, false)
  })

  it('rejects arbitrary URLs and oversized batches before any query', async () => {
    for (const fileIds of [[], ['https://other.example/file'], Array(31).fill(publicFile), ['cloud://bad\nfile']]) {
      await assert.rejects(eventMediaUrls({}, {}, { appId: 'app-a', fileIds }), { code: 'VALIDATION_FAILED' })
    }
  })
})
