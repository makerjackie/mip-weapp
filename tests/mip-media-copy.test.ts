/* eslint-disable ts/no-use-before-define */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyMipMediaCopyResultToTransformedPackage,
  buildMipLongTermMediaCopyPlan,
  createMipMediaCopyCheckpoint,
  executeMipLongTermMediaCopy,
  loadVerifiedMipMediaExportPackage,
  mediaObjectScope,
  MIP_MEDIA_COPY_PLAN_FORMAT,
  MIP_MEDIA_COPY_RESULT_FORMAT,
} from '../scripts/lib/mip-media-copy.mjs'

const sourceAppId = 'wx1111111111111111'
const targetAppId = 'wx2222222222222222'
const sourceEnvironmentId = 'source-environment-fixture'
const sourceSecret = 'source-media-scope-secret-value-1234567890'
const targetSecret = 'target-media-scope-secret-value-1234567890'
const sourceAuthority = 'source-env.private-bucket'
const targetAuthority = 'target-env.private-bucket'
const userId = '10000000-0000-4000-8000-000000000001'
const avatarId = '20000000-0000-4000-8000-000000000001'
const digitalAvatarId = '20000000-0000-4000-8000-000000000002'
const aiAudioId = '20000000-0000-4000-8000-000000000003'
const checkinId = '20000000-0000-4000-8000-000000000004'
const pendingId = '20000000-0000-4000-8000-000000000005'
const exportId = '20000000-0000-4000-8000-000000000006'
const temporaryDirectories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('MIP long-term media copy foundation', () => {
  it('loads only a checksum-bound media table and inventory from a private export package', () => {
    const content = Buffer.from('verified-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])

    const sourcePackage = loadVerifiedMipMediaExportPackage({
      exportDirectory: fixture.directory,
      sourceAppId,
      sourceEnvironmentId,
    })

    expect(sourcePackage.rows).toHaveLength(1)
    expect(sourcePackage.inventory).toMatchObject({
      sourceTable: 'mip_media_assets',
      objectCount: 1,
      readyObjectCount: 1,
      contentBytes: content.length,
    })
    expect(Object.isFrozen(sourcePackage)).toBe(true)
    expect(Object.isFrozen(sourcePackage.rows)).toBe(true)
  })

  it('rejects package tampering and never accepts an arbitrary media array as source truth', () => {
    const secretMarker = `${sourceAppId}-${avatarId}-${sourceSecret}`
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content: Buffer.from('avatar') }),
    ])
    const inventoryPath = path.join(fixture.directory, 'inventory', 'media.json')
    const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))
    inventory.rows[0].contentBytes += 1
    writePrivate(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)

    let message = ''
    try {
      loadVerifiedMipMediaExportPackage({
        exportDirectory: fixture.directory,
        sourceAppId,
        sourceEnvironmentId,
      })
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/^MIP_MEDIA_COPY_/)
    expect(message).not.toContain(secretMarker)
    expect(message).not.toContain(sourceAppId)
    expect(message).not.toContain(avatarId)
    expect(message).not.toContain(sourceSecret)

    expect(() => buildMipLongTermMediaCopyPlan({
      sourcePackage: { rows: fixture.rows },
      sourceAppId,
      targetAppId,
      sourceMediaScopeSecret: sourceSecret,
      targetMediaScopeSecret: targetSecret,
      targetStage: 'staging',
    })).toThrow('MIP_MEDIA_COPY_EXPORT_NOT_VERIFIED')
  })

  it('plans target keys with the production media scope algorithm and excludes ephemeral objects', () => {
    const rows = [
      longTermRow({ id: avatarId, purpose: 'AVATAR', content: Buffer.from('avatar') }),
      longTermRow({
        id: digitalAvatarId,
        purpose: 'DIGITAL_AVATAR',
        content: Buffer.from('digital-avatar'),
        contentType: 'image/png',
      }),
      ephemeralAudioRow(Buffer.from('ephemeral-audio')),
      temporaryCheckinRow(Buffer.from('temporary-code')),
      temporaryExportRow(Buffer.from('temporary-export')),
      longTermRow({
        id: pendingId,
        purpose: 'EVENT_COVER',
        content: Buffer.from('pending-cover'),
        status: 'PENDING',
      }),
    ]
    const fixture = writeExportPackage(rows)
    const sourcePackage = loadVerifiedMipMediaExportPackage({
      exportDirectory: fixture.directory,
      sourceAppId,
      sourceEnvironmentId,
    })

    const plan = buildMipLongTermMediaCopyPlan({
      sourcePackage,
      sourceAppId,
      targetAppId,
      sourceMediaScopeSecret: sourceSecret,
      targetMediaScopeSecret: targetSecret,
      targetStage: 'staging',
    })

    const targetAppScope = mediaObjectScope(targetSecret, targetAppId)
    const targetUserScope = mediaObjectScope(targetSecret, `${targetAppId}\0${userId}`)
    expect(plan).toMatchObject({
      format: MIP_MEDIA_COPY_PLAN_FORMAT,
      copiedCount: 2,
      excludedCount: 4,
    })
    expect(plan.copied.map(item => item.targetObjectKey)).toEqual([
      `mip/staging/${targetAppScope}/avatars/${targetUserScope}/${avatarId}.jpg`,
      `mip/staging/${targetAppScope}/digital-avatars/${targetUserScope}/${digitalAvatarId}.png`,
    ])
    expect(plan.excluded.map(item => item.reason).sort()).toEqual([
      'EPHEMERAL_AI_AUDIO',
      'NOT_READY',
      'TEMPORARY_OR_REISSUABLE_OBJECT',
      'TEMPORARY_OR_REISSUABLE_OBJECT',
    ])
    expect(plan.planSha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('validates source scope before planning and does not echo identifiers or secrets', () => {
    const row = longTermRow({
      id: avatarId,
      purpose: 'AVATAR',
      content: Buffer.from('avatar'),
    })
    row.object_key = row.object_key.replace(
      mediaObjectScope(sourceSecret, sourceAppId),
      'f'.repeat(24),
    )
    row.cloud_file_id = `cloud://${sourceAuthority}/${row.object_key}`
    const fixture = writeExportPackage([row])
    const sourcePackage = loadVerifiedMipMediaExportPackage({
      exportDirectory: fixture.directory,
      sourceAppId,
      sourceEnvironmentId,
    })

    let message = ''
    try {
      buildMipLongTermMediaCopyPlan({
        sourcePackage,
        sourceAppId,
        targetAppId,
        sourceMediaScopeSecret: sourceSecret,
        targetMediaScopeSecret: targetSecret,
        targetStage: 'staging',
      })
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe('MIP_MEDIA_COPY_SOURCE_SCOPE_INVALID')
    expect(message).not.toContain(sourceAppId)
    expect(message).not.toContain(avatarId)
    expect(message).not.toContain(sourceSecret)
  })

  it('normalizes the known legacy task-template event-cover directory', () => {
    const row = longTermRow({
      id: avatarId,
      purpose: 'EVENT_COVER',
      content: Buffer.from('legacy-task-template'),
    })
    row.purpose = 'TASK_TEMPLATE'
    const fixture = writeExportPackage([row])
    const plan = copyPlan(fixture.directory)
    const targetAppScope = mediaObjectScope(targetSecret, targetAppId)
    const targetUserScope = mediaObjectScope(targetSecret, `${targetAppId}\0${userId}`)

    expect(plan.copied).toHaveLength(1)
    expect(plan.copied[0].targetObjectKey).toBe(
      `mip/staging/${targetAppScope}/task-templates/${targetUserScope}/${avatarId}.jpg`,
    )
  })

  it('verifies source and uploaded bytes plus SHA-256 before emitting database updates', async () => {
    const content = Buffer.from('copied-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])
    const plan = copyPlan(fixture.directory)
    const progress: Array<Record<string, unknown>> = []
    const transport = {
      downloadSource: vi.fn(async () => Buffer.from(content)),
      uploadTarget: vi.fn(async ({ objectKey, content: uploaded }: {
        objectKey: string
        content: Buffer
      }) => {
        expect(uploaded).toEqual(content)
        return { fileID: `cloud://${targetAuthority}/${objectKey}` }
      }),
      downloadTarget: vi.fn(async () => ({ fileContent: Buffer.from(content) })),
    }

    const result = await executeMipLongTermMediaCopy({
      plan,
      transport,
      onProgress(value) {
        progress.push(value)
      },
    })

    const targetObjectKey = plan.copied[0].targetObjectKey
    expect(result).toMatchObject({
      format: MIP_MEDIA_COPY_RESULT_FORMAT,
      copiedCount: 1,
      updates: [{
        mediaId: avatarId,
        objectKey: targetObjectKey,
        cloudFileId: `cloud://${targetAuthority}/${targetObjectKey}`,
      }],
      byMediaId: {
        [avatarId]: {
          object_key: targetObjectKey,
          cloud_file_id: `cloud://${targetAuthority}/${targetObjectKey}`,
        },
      },
    })
    expect(result.recordsSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(transport.downloadSource).toHaveBeenCalledOnce()
    expect(transport.uploadTarget).toHaveBeenCalledOnce()
    expect(transport.downloadTarget).toHaveBeenCalledOnce()
    expect(progress).toEqual([
      { phase: 'STARTED', completed: 0, total: 1 },
      { phase: 'COPIED', completed: 1, total: 1 },
      { phase: 'COMPLETE', completed: 1, total: 1 },
    ])
    expect(JSON.stringify(progress)).not.toContain(avatarId)
    expect(JSON.stringify(progress)).not.toContain(sourceAppId)
    expect(JSON.stringify(progress)).not.toContain(targetAppId)
    expect(JSON.stringify(progress)).not.toContain(sourceSecret)
    expect(JSON.stringify(progress)).not.toContain(targetSecret)
  })

  it('revalidates checkpointed target objects and resumes without source download or upload', async () => {
    const content = Buffer.from('resumable-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])
    const plan = copyPlan(fixture.directory)
    const update = {
      mediaId: avatarId,
      objectKey: plan.copied[0].targetObjectKey,
      cloudFileId: `cloud://${targetAuthority}/${plan.copied[0].targetObjectKey}`,
    }
    const checkpoint = createMipMediaCopyCheckpoint({ plan, updates: [update] })
    const progress: Array<Record<string, unknown>> = []
    const downloadSource = vi.fn()
    const uploadTarget = vi.fn()

    const result = await executeMipLongTermMediaCopy({
      plan,
      resumeUpdates: checkpoint.updates,
      transport: {
        downloadSource,
        uploadTarget,
        downloadTarget: vi.fn(async () => content),
      },
      onProgress(value) {
        progress.push(value)
      },
    })

    expect(result.updates).toEqual([update])
    expect(downloadSource).not.toHaveBeenCalled()
    expect(uploadTarget).not.toHaveBeenCalled()
    expect(progress).toEqual([
      { phase: 'STARTED', completed: 0, total: 1 },
      { phase: 'RESUMED', completed: 1, total: 1 },
      { phase: 'COMPLETE', completed: 1, total: 1 },
    ])
  })

  it('updates only copied media references and binds the transformed package checksums', async () => {
    const content = Buffer.from('package-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])
    const plan = copyPlan(fixture.directory)
    const result = await executeMipLongTermMediaCopy({
      plan,
      transport: {
        downloadSource: async () => content,
        uploadTarget: async ({ objectKey }: { objectKey: string }) => (
          `cloud://${targetAuthority}/${objectKey}`
        ),
        downloadTarget: async () => content,
      },
    })
    const transformed = writeTransformedPackage(fixture.rows)

    const summary = applyMipMediaCopyResultToTransformedPackage({
      packageDirectory: transformed,
      sourceAppId,
      targetAppId,
      plan,
      result,
    })

    const rows = fs.readFileSync(path.join(transformed, 'data', 'mip_media_assets.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    const manifest = JSON.parse(fs.readFileSync(path.join(transformed, 'manifest.json'), 'utf8'))
    const checksums = fs.readFileSync(path.join(transformed, 'checksums.sha256'), 'utf8')
    expect(summary).toEqual({ copiedCount: 1, excludedCount: 0, contentBytes: content.length })
    expect(rows[0]).toMatchObject({
      app_id: targetAppId,
      object_key: plan.copied[0].targetObjectKey,
      cloud_file_id: result.updates[0].cloudFileId,
    })
    expect(manifest.mediaCopy).toMatchObject({
      targetStage: 'staging',
      copiedCount: 1,
      validation: 'source-upload-readback-verified',
    })
    expect(checksums).toContain(manifest.tables[0].sha256)
  })

  it('stops before upload when downloaded bytes do not match the export inventory', async () => {
    const content = Buffer.from('expected-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])
    const plan = copyPlan(fixture.directory)
    const uploadTarget = vi.fn()

    await expect(executeMipLongTermMediaCopy({
      plan,
      transport: {
        downloadSource: async () => Buffer.alloc(content.length, 0x78),
        uploadTarget,
        downloadTarget: vi.fn(),
      },
    })).rejects.toThrow('MIP_MEDIA_COPY_SOURCE_CONTENT_MISMATCH')
    expect(uploadTarget).not.toHaveBeenCalled()
  })

  it('rejects an upload reference or target re-download that does not match the planned object', async () => {
    const content = Buffer.from('expected-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])
    const plan = copyPlan(fixture.directory)

    await expect(executeMipLongTermMediaCopy({
      plan,
      transport: {
        downloadSource: async () => content,
        uploadTarget: async () => `cloud://${targetAuthority}/mip/staging/wrong/object.jpg`,
        downloadTarget: vi.fn(),
      },
    })).rejects.toThrow('MIP_MEDIA_COPY_TARGET_REFERENCE_INVALID')

    await expect(executeMipLongTermMediaCopy({
      plan,
      transport: {
        downloadSource: async () => content,
        uploadTarget: async ({ objectKey }: { objectKey: string }) => (
          `cloud://${targetAuthority}/${objectKey}`
        ),
        downloadTarget: async () => Buffer.alloc(content.length, 0x78),
      },
    })).rejects.toThrow('MIP_MEDIA_COPY_TARGET_CONTENT_MISMATCH')
  })

  it('masks transport errors instead of forwarding object references or secrets', async () => {
    const content = Buffer.from('expected-avatar-content')
    const fixture = writeExportPackage([
      longTermRow({ id: avatarId, purpose: 'AVATAR', content }),
    ])
    const plan = copyPlan(fixture.directory)
    const privateDetail = `${sourceAppId}:${avatarId}:${sourceSecret}`

    let message = ''
    try {
      await executeMipLongTermMediaCopy({
        plan,
        transport: {
          downloadSource: async () => {
            throw new Error(privateDetail)
          },
          uploadTarget: vi.fn(),
          downloadTarget: vi.fn(),
        },
      })
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe('MIP_MEDIA_COPY_SOURCE_DOWNLOAD_FAILED')
    expect(message).not.toContain(sourceAppId)
    expect(message).not.toContain(avatarId)
    expect(message).not.toContain(sourceSecret)
  })
})

function copyPlan(exportDirectory: string) {
  return buildMipLongTermMediaCopyPlan({
    sourcePackage: loadVerifiedMipMediaExportPackage({
      exportDirectory,
      sourceAppId,
      sourceEnvironmentId,
    }),
    sourceAppId,
    targetAppId,
    sourceMediaScopeSecret: sourceSecret,
    targetMediaScopeSecret: targetSecret,
    targetStage: 'staging',
  })
}

function longTermRow({
  id,
  purpose,
  content,
  contentType = 'image/jpeg',
  status = 'READY',
}: {
  id: string
  purpose: string
  content: Buffer
  contentType?: string
  status?: string
}) {
  const extension = contentType === 'image/png' ? 'png' : 'jpg'
  const directories: Record<string, string> = {
    AVATAR: 'avatars',
    DIGITAL_AVATAR: 'digital-avatars',
    EVENT_COVER: 'event-covers',
  }
  const appScope = mediaObjectScope(sourceSecret, sourceAppId)
  const userScope = mediaObjectScope(sourceSecret, `${sourceAppId}\0${userId}`)
  const objectKey = `mip/development/${appScope}/${directories[purpose]}/${userScope}/${id}.${extension}`
  return mediaRow({ id, purpose, content, contentType, status, objectKey, ownerUserId: userId })
}

function ephemeralAudioRow(content: Buffer) {
  const appScope = mediaObjectScope(sourceSecret, sourceAppId)
  const userScope = mediaObjectScope(sourceSecret, `${sourceAppId}\0${userId}`)
  const objectKey = `mip/development/${appScope}/ai-audio/${userScope}/draft/${aiAudioId}.mp3`
  return mediaRow({
    id: aiAudioId,
    purpose: 'AI_AUDIO',
    content,
    contentType: 'audio/mpeg',
    objectKey,
    ownerUserId: userId,
  })
}

function temporaryCheckinRow(content: Buffer) {
  const appScope = mediaObjectScope(sourceSecret, sourceAppId)
  const eventId = '30000000-0000-4000-8000-000000000001'
  const objectKey = `mip/development/${appScope}/checkin-posters/${eventId}/${checkinId}.png`
  return mediaRow({
    id: checkinId,
    purpose: 'CHECKIN_POSTER',
    content,
    contentType: 'image/png',
    objectKey,
    ownerUserId: userId,
  })
}

function temporaryExportRow(content: Buffer) {
  const appScope = mediaObjectScope(sourceSecret, sourceAppId)
  const objectKey = `mip/development/${appScope}/exports/private/${exportId}.xlsx`
  return mediaRow({
    id: exportId,
    purpose: 'ADMIN_EXPORT',
    content,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    objectKey,
    ownerUserId: userId,
  })
}

function mediaRow({
  id,
  purpose,
  content,
  contentType,
  objectKey,
  ownerUserId,
  status = 'READY',
}: {
  id: string
  purpose: string
  content: Buffer
  contentType: string
  objectKey: string
  ownerUserId: string | null
  status?: string
}) {
  return {
    id,
    app_id: sourceAppId,
    owner_user_id: ownerUserId,
    purpose,
    object_key: objectKey,
    cloud_file_id: `cloud://${sourceAuthority}/${objectKey}`,
    content_sha256: sha256(content),
    content_type: contentType,
    content_bytes: content.length,
    width_px: contentType.startsWith('image/') ? 128 : null,
    height_px: contentType.startsWith('image/') ? 128 : null,
    status,
  }
}

function writeExportPackage(rows: Array<Record<string, unknown>>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-media-copy-test-'))
  temporaryDirectories.push(directory)
  const dataDirectory = path.join(directory, 'data')
  const inventoryDirectory = path.join(directory, 'inventory')
  fs.mkdirSync(dataDirectory, { mode: 0o700 })
  fs.mkdirSync(inventoryDirectory, { mode: 0o700 })

  const dataPath = path.join(dataDirectory, 'mip_media_assets.jsonl')
  const dataContent = rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
  writePrivate(dataPath, dataContent)
  const inventoryRows = rows.map(row => ({
    id: row.id,
    ownerUserId: row.owner_user_id,
    purpose: row.purpose,
    objectKey: row.object_key,
    cloudFileId: row.cloud_file_id,
    contentSha256: row.content_sha256,
    contentType: row.content_type,
    contentBytes: row.content_bytes,
    status: row.status,
  })).sort((left, right) => (
    String(left.objectKey).localeCompare(String(right.objectKey))
    || String(left.id).localeCompare(String(right.id))
  ))
  const inventory = {
    format: 'mip-media-inventory-v1',
    sourceTable: 'mip_media_assets',
    rows: inventoryRows,
    objectCount: inventoryRows.length,
    readyObjectCount: inventoryRows.filter(row => row.status === 'READY').length,
    contentBytes: inventoryRows.reduce((total, row) => total + Number(row.contentBytes), 0),
    recordsSha256: sha256(
      inventoryRows.map(row => JSON.stringify(row)).join('\n') + (inventoryRows.length ? '\n' : ''),
    ),
  }
  const inventoryPath = path.join(inventoryDirectory, 'media.json')
  writePrivate(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`)

  const manifest = {
    format: 'mip-app-scope-export-v1',
    sourceEnvironmentFingerprint: sha256(sourceEnvironmentId).slice(0, 16),
    sourceAppScopeFingerprint: sha256(sourceAppId).slice(0, 16),
    consistency: 'row-count-verified',
    sourceWritesFrozen: true,
    primaryKeyInventoryVerified: true,
    migrationReadiness: 'export-verified',
    tables: [{
      table: 'mip_media_assets',
      scope: 'source-app',
      relativeFile: 'data/mip_media_assets.jsonl',
      rowsExported: rows.length,
      rowCountStable: true,
      primaryKeyInventoryStable: true,
      sha256: sha256(fs.readFileSync(dataPath)),
    }],
    mediaInventory: {
      relativeFile: 'inventory/media.json',
      sha256: sha256(fs.readFileSync(inventoryPath)),
      objectCount: inventory.objectCount,
      readyObjectCount: inventory.readyObjectCount,
      contentBytes: inventory.contentBytes,
    },
  }
  const checksumContent = [dataPath, inventoryPath].map(filePath => (
    `${sha256(fs.readFileSync(filePath))}  ${path.relative(directory, filePath).split(path.sep).join('/')}`
  )).join('\n')
  writePrivate(path.join(directory, 'checksums.sha256'), `${checksumContent}\n`)
  writePrivate(path.join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writePrivate(path.join(directory, 'README.txt'), 'private test fixture\n')
  return { directory, rows }
}

function writeTransformedPackage(sourceRows: Array<Record<string, unknown>>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-media-transformed-test-'))
  temporaryDirectories.push(directory)
  fs.mkdirSync(path.join(directory, 'data'), { mode: 0o700 })
  const dataPath = path.join(directory, 'data', 'mip_media_assets.jsonl')
  const rows = sourceRows.map(row => ({ ...row, app_id: targetAppId }))
  writePrivate(dataPath, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  const digest = sha256(fs.readFileSync(dataPath))
  writePrivate(path.join(directory, 'checksums.sha256'), `${digest}  data/mip_media_assets.jsonl\n`)
  writePrivate(path.join(directory, 'manifest.json'), `${JSON.stringify({
    format: 'mip-app-scope-transform-v1',
    migrationReadiness: 'transformed-verified',
    sourceAppScopeFingerprint: sha256(sourceAppId).slice(0, 16),
    targetAppScopeFingerprint: sha256(targetAppId).slice(0, 16),
    tables: [{
      table: 'mip_media_assets',
      relativeFile: 'data/mip_media_assets.jsonl',
      rowsExported: rows.length,
      bytes: fs.statSync(dataPath).size,
      sha256: digest,
    }],
  }, null, 2)}\n`)
  return directory
}

function writePrivate(filePath: string, content: string) {
  fs.writeFileSync(filePath, content, { mode: 0o600 })
  fs.chmodSync(filePath, 0o600)
}

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}
