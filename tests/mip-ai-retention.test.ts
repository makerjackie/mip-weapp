import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('MIP AI audio retention boundary', () => {
  it('leases private audio metadata before deleting the storage object', () => {
    const repository = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-ai-api/domain/repository.js'),
      'utf8',
    )
    const service = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-ai-api/domain/service.js'),
      'utf8',
    )

    expect(repository).toContain('async function leaseAudioCleanup')
    expect(repository).toContain('asset.status = \'PENDING\'')
    expect(repository).toContain('FOR UPDATE SKIP LOCKED')
    expect(repository).toContain('status = \'PENDING\'')
    expect(repository).toContain('status = \'DELETED\'')
    expect(service.indexOf('leaseAudioCleanup')).toBeLessThan(service.indexOf('audioStore?.remove'))
    expect(service).toContain('userId: caller.userId')
  })

  it('binds the storage object to both the AppID and the owner scope', () => {
    const source = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-ai-api/lib/audio-store.js'),
      'utf8',
    )

    expect(source).toContain('const userScope = scope(input.storageKey, \'user\', input.userId)')
    expect(source).toContain(['/ai/$', '{userScope}/'].join(''))
    expect(source).toContain('assertAppScopedAudioFile')
    expect(source).toContain('cloudObjectKey(fileId) !== objectKey')
  })

  it('fences private draft mutations against concurrent account closure', () => {
    const repository = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-ai-api/domain/repository.js'),
      'utf8',
    )

    expect(repository).toContain('async function requireActiveUser')
    expect(repository).toMatch(/SELECT id, status FROM mip_users[\s\S]*FOR UPDATE/)
    for (const operation of [
      'createTextDraft',
      'createVoiceDraft',
      'createVoiceDraftFromUpload',
      'updateDraft',
      'deleteDraft',
    ]) {
      const body = repository.slice(
        repository.indexOf(`async function ${operation}`),
        repository.indexOf('\n  async function ', repository.indexOf(`async function ${operation}`) + 1),
      )
      expect(body).toContain('await requireActiveUser(tx, appId, userId)')
    }
  })

  it('provides an app-scoped manual maintenance path without a timer', () => {
    const auth = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-ai-api/lib/internal-auth.js'),
      'utf8',
    )
    const repository = fs.readFileSync(
      path.join(root, 'cloudfunctions/mip-ai-api/domain/repository.js'),
      'utf8',
    )
    const script = fs.readFileSync(path.join(root, 'scripts/run-ai-cleanup.mjs'), 'utf8')
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

    expect(auth).toContain('timingSafeEqual')
    expect(auth).toContain('key !== \'signature\'')
    expect(auth).toContain('stableJson(unsignedBody(event))')
    expect(auth).toContain('options.allowedAppIds.has(appId)')
    expect(auth).toContain('5 * 60 * 1000')
    expect(repository).toContain('async function expireDraftsForApp')
    expect(repository).toContain('async function leaseAppAudioCleanup')
    expect(repository).toContain('lease_updated_at: leasedAt')
    expect(script).toContain('--confirm-env=')
    expect(script).toContain('--confirm-ai=')
    expect(script).toContain('MIP_AI_HMAC_SECRET')
    expect(script).not.toContain('userId:')
    expect(script).not.toContain('fileId:')
    expect(packageJson.scripts['ai:cleanup']).toBe('node scripts/run-ai-cleanup.mjs')
    expect(packageJson.scripts).not.toHaveProperty('ai:cleanup:timer')
  })
})
