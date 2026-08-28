/* eslint-disable ts/no-use-before-define */
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertMipMediaMigrationConfirmations,
  createMipCloudbaseStorageTransport,
  loadMipMediaMigrationEnvironment,
  validateCheckpointEnvelope,
} from '../scripts/lib/mip-media-copy-cli.mjs'

const sourceAppId = 'wx1111111111111111'
const targetAppId = 'wx2222222222222222'
const sourceEnvironmentId = 'source-private-environment'
const targetEnvironmentId = 'target-private-environment'
const directories: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('MIP media copy CLI boundaries', () => {
  it('loads private environment files and requires exact source and staging confirmations', () => {
    const root = privateDirectory()
    const sourcePath = writeEnvironment(root, 'source.env', {
      appId: sourceAppId,
      environmentId: sourceEnvironmentId,
      stage: 'development',
    })
    const targetPath = writeEnvironment(root, 'target.env', {
      appId: targetAppId,
      environmentId: targetEnvironmentId,
      stage: 'staging',
    })
    const source = loadMipMediaMigrationEnvironment(sourcePath)
    const target = loadMipMediaMigrationEnvironment(targetPath, 'staging')

    expect(() => assertMipMediaMigrationConfirmations({
      source,
      target,
      confirmSourceEnvironment: sourceEnvironmentId,
      confirmTargetEnvironment: targetEnvironmentId,
      confirmSourceAppId: sourceAppId,
      confirmTargetAppId: targetAppId,
    })).not.toThrow()
    expect(() => assertMipMediaMigrationConfirmations({
      source,
      target,
      confirmSourceEnvironment: sourceEnvironmentId,
      confirmTargetEnvironment: 'wrong-target',
      confirmSourceAppId: sourceAppId,
      confirmTargetAppId: targetAppId,
    })).toThrow('MIP_MEDIA_COPY_CONFIRMATION_INVALID')
  })

  it('switches environments before storage operations and uses private local files', async () => {
    const root = privateDirectory()
    const work = path.join(root, 'work')
    const content = Buffer.from('verified-private-object')
    const objectKey = 'mip/development/aaaaaaaaaaaaaaaaaaaaaaaa/avatars/bbbbbbbbbbbbbbbbbbbbbbbb/media.jpg'
    const targetKey = 'mip/staging/cccccccccccccccccccccccc/avatars/dddddddddddddddddddddddd/media.jpg'
    const source = environment(sourceAppId, sourceEnvironmentId, 'development')
    const target = environment(targetAppId, targetEnvironmentId, 'staging')
    const activations: string[] = []
    const runtime = {
      activate: vi.fn(async ({ environment: value }) => {
        activations.push(value.environmentFingerprint)
      }),
      manageStorage: vi.fn(async (input) => {
        if (input.action === 'download') {
          fs.writeFileSync(input.localPath, content, { mode: 0o600 })
          return { ok: true }
        }
        expect(fs.readFileSync(input.localPath)).toEqual(content)
        return { fileID: `cloud://target.private/${input.cloudPath}` }
      }),
      queryStorage: vi.fn(),
    }
    const transport = createMipCloudbaseStorageTransport({
      projectRoot: root,
      sourceEnvironment: source,
      targetEnvironment: target,
      workDirectory: work,
      runtime,
    })

    await expect(transport.downloadSource({
      cloudFileId: `cloud://source.private/${objectKey}`,
      objectKey,
    })).resolves.toEqual(content)
    await expect(transport.uploadTarget({ objectKey: targetKey, content })).resolves.toEqual({
      fileID: `cloud://target.private/${targetKey}`,
    })
    await expect(transport.downloadTarget({
      cloudFileId: `cloud://target.private/${targetKey}`,
    })).resolves.toEqual(content)
    expect(activations).toEqual([
      source.environmentFingerprint,
      target.environmentFingerprint,
    ])
    for (const file of allFiles(work)) {
      expect(fs.statSync(file).mode & 0o077).toBe(0)
    }
  })

  it('rejects checkpoint tampering before any environment is activated', () => {
    const plan = { planSha256: 'a'.repeat(64) }
    expect(() => validateCheckpointEnvelope({
      format: 'mip-long-term-media-copy-checkpoint-v1',
      planSha256: plan.planSha256,
      updates: [],
      completedCount: 0,
      recordsSha256: '0'.repeat(64),
    }, plan)).toThrow('MIP_MEDIA_COPY_CHECKPOINT_INVALID')
  })
})

function privateDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-media-copy-cli-test-'))
  fs.chmodSync(directory, 0o700)
  directories.push(directory)
  return directory
}

function writeEnvironment(directory: string, name: string, input: {
  appId: string
  environmentId: string
  stage: string
}) {
  const filePath = path.join(directory, name)
  fs.writeFileSync(filePath, [
    `MINI_PROGRAM_APP_ID=${input.appId}`,
    `CLOUDBASE_ENV_ID=${input.environmentId}`,
    'CLOUDBASE_API_KEY=private-management-api-key-value',
    'MIP_MEDIA_SCOPE_SECRET=private-media-scope-secret-value-more-than-thirty-two',
    `MIP_DEPLOYMENT_STAGE=${input.stage}`,
    '',
  ].join('\n'), { mode: 0o600 })
  return filePath
}

function environment(appId: string, environmentId: string, stage: string) {
  return {
    appId,
    environmentId,
    stage,
    apiKey: 'private-management-api-key-value',
    mediaScopeSecret: 'private-media-scope-secret-value-more-than-thirty-two',
    environmentFingerprint: createHash('sha256').update(environmentId).digest('hex').slice(0, 16),
  }
}

function allFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    return entry.isDirectory() ? allFiles(absolute) : [absolute]
  })
}
