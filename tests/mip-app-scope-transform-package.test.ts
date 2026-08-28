import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPrivateExportDirectories,
  MIP_APP_SCOPE_EXPORT_FORMAT,
  sha256,
  sha256File,
  writePrivateFile,
  writePrivateJson,
} from '../scripts/lib/mip-app-scope-export.mjs'
import {
  decodeMipExportValue,
  encodeMipExportValue,
  loadMigrationEncryptionEnvironment,
  MIP_APP_SCOPE_TRANSFORM_FORMAT,
  transformMipAppScopeExportPackage,
  validateMipAppScopeExportPackage,
} from '../scripts/lib/mip-app-scope-transform-package.mjs'

const require = createRequire(import.meta.url)
const {
  protectContact,
  protectPhone,
  revealContact,
  revealPhone,
} = require('../cloudfunctions/mip-identity-api/lib/private-data.js')

const repoRoot = path.resolve(import.meta.dirname, '..')
const sourceAppId = 'wx1111111111111111'
const targetAppId = 'wx2222222222222222'
const sourceEnvironmentId = 'source-environment-fixture'
const targetEnvironmentId = 'target-environment-fixture'
const sourceEnvironmentFingerprint = sha256(sourceEnvironmentId).slice(0, 16)
const targetEnvironmentFingerprint = sha256(targetEnvironmentId).slice(0, 16)
const sourcePhoneEncryptionKey = 'source-phone-encryption-key-with-32-characters'
const targetPhoneEncryptionKey = 'target-phone-encryption-key-with-32-characters'
const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function fixtureRoot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-transform-package-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function exportFixture() {
  const base = fixtureRoot()
  const input = path.join(base, 'source-package')
  const output = path.join(base, 'target-package')
  createPrivateExportDirectories({ outputDirectory: input, repoRoot })

  const userId = 'fixture-user'
  const protectedPhone = protectPhone(
    { countryCode: '86', purePhoneNumber: '13800138000' },
    sourcePhoneEncryptionKey,
    { appId: sourceAppId, userId },
  )
  const protectedWechat = protectContact(
    'private-contact-value',
    sourcePhoneEncryptionKey,
    { appId: sourceAppId, userId },
  )
  const rows: Record<string, Record<string, unknown>[]> = {
    mip_schema_migrations: [{ version: '001' }],
    mip_users: [{ app_id: sourceAppId, id: userId, status: 'ACTIVE' }],
    mip_private_profiles: [{
      app_id: sourceAppId,
      user_id: userId,
      phone_hash: protectedPhone.phoneHash,
      phone_ciphertext: protectedPhone.phoneCiphertext,
      phone_verified_at: '2026-08-28T00:00:00.000Z',
      wechat_ciphertext: protectedWechat,
      email_ciphertext: null,
      address_ciphertext: null,
    }],
    mip_notification_grants: [{
      app_id: sourceAppId,
      id: 'notification-grant-fixture',
      private_payload: Buffer.from('must-not-survive'),
    }],
    mip_event_registrations: [{
      app_id: sourceAppId,
      id: 'registration-fixture',
      ticket_hash: 'temporary-ticket-value',
    }],
  }
  const primaryKeys: Record<string, string[]> = {
    mip_schema_migrations: ['version'],
    mip_users: ['id'],
    mip_private_profiles: ['app_id', 'user_id'],
    mip_notification_grants: ['id'],
    mip_event_registrations: ['id'],
  }
  const tableEntries = Object.entries(rows).map(([table, tableRows]) => {
    const relativeFile = `data/${table}.jsonl`
    const content = `${tableRows.map(row => JSON.stringify(encodeMipExportValue(row))).join('\n')}\n`
    const filePath = path.join(input, relativeFile)
    writePrivateFile(filePath, content)
    return {
      table,
      scope: table === 'mip_schema_migrations' ? 'migration-ledger' : 'source-app',
      relativeFile,
      primaryKey: primaryKeys[table],
      rowsBefore: tableRows.length,
      rowsExported: tableRows.length,
      rowsAfter: tableRows.length,
      rowCountStable: true,
      primaryKeyInventoryStable: true,
      primaryKeyInventorySha256: 'b'.repeat(64),
      bytes: fs.statSync(filePath).size,
      sha256: sha256File(filePath),
    }
  })

  writePrivateJson(path.join(input, 'schema', 'tables.json'), [])
  writePrivateJson(path.join(input, 'inventory', 'union-identities.json'), {
    format: 'mip-union-identity-inventory-v1',
    rows: [],
  })
  writePrivateJson(path.join(input, 'inventory', 'media.json'), {
    format: 'mip-media-inventory-v1',
    rows: [],
  })
  const payloadFiles = [
    'schema/tables.json',
    'inventory/union-identities.json',
    'inventory/media.json',
    ...tableEntries.map(table => table.relativeFile),
  ].sort()
  writePrivateFile(path.join(input, 'checksums.sha256'), `${payloadFiles.map((file) => {
    return `${sha256File(path.join(input, file))}  ${file}`
  }).join('\n')}\n`)
  writePrivateFile(path.join(input, 'README.txt'), 'private fixture\n')

  const manifest = {
    format: MIP_APP_SCOPE_EXPORT_FORMAT,
    sourceEnvironmentFingerprint,
    sourceAppScopeFingerprint: sha256(sourceAppId).slice(0, 16),
    consistency: 'row-count-verified',
    sourceWritesFrozen: true,
    primaryKeyInventoryVerified: true,
    migrationReadiness: 'export-verified',
    migrationLock: {
      version: 1,
      migrationCount: 56,
      latestVersion: '056',
      sha256: sha256File(path.join(repoRoot, 'database/mysql/mip/migrations.lock.json')),
    },
    tableCount: tableEntries.length,
    rowCount: tableEntries.reduce((total, table) => total + table.rowsExported, 0),
    binaryEncoding: { marker: '$binaryBase64', mysqlProjection: 'TO_BASE64' },
    schemaFiles: ['schema/tables.json'],
    tables: tableEntries,
    unionIdentityInventory: {
      relativeFile: 'inventory/union-identities.json',
      sha256: sha256File(path.join(input, 'inventory', 'union-identities.json')),
    },
    mediaInventory: {
      relativeFile: 'inventory/media.json',
      sha256: sha256File(path.join(input, 'inventory', 'media.json')),
    },
  }
  writePrivateJson(path.join(input, 'manifest.json'), manifest)
  return { base, input, manifest, output, userId }
}

function transformFixture(fixture: ReturnType<typeof exportFixture>, overrides = {}) {
  return transformMipAppScopeExportPackage({
    inputDirectory: fixture.input,
    outputDirectory: fixture.output,
    repoRoot,
    sourceAppId,
    targetAppId,
    sourcePhoneEncryptionKey,
    targetPhoneEncryptionKey,
    sourceEnvironmentFingerprint,
    targetEnvironmentFingerprint,
    ...overrides,
  })
}

function readJsonLines(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf8')
  return content ? content.trimEnd().split('\n').map(line => JSON.parse(line)) : []
}

describe('MIP app-scope transformed package', () => {
  it('verifies the source package, remaps rows, re-encrypts private data, and records exclusions', () => {
    const fixture = exportFixture()
    const result = transformFixture(fixture)

    expect(result).toMatchObject({
      tableCount: 5,
      rowCount: 4,
      excludedRowCount: 1,
    })
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture.output, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      format: MIP_APP_SCOPE_TRANSFORM_FORMAT,
      migrationReadiness: 'transformed-verified',
      excludedRowCount: 1,
      validation: {
        sourceManifest: 'verified',
        sourceChecksums: 'verified',
        sourceJsonLines: 'verified',
        targetAppScope: 'verified',
      },
    })
    expect(manifest.exclusions).toEqual([{
      table: 'mip_notification_grants',
      reason: 'SOURCE_APP_NOTIFICATION_GRANT',
      excludedRows: 1,
    }])
    expect(readJsonLines(path.join(fixture.output, 'data', 'mip_notification_grants.jsonl')))
      .toEqual([])
    expect(readJsonLines(path.join(fixture.output, 'data', 'mip_event_registrations.jsonl'))[0])
      .toMatchObject({ app_id: targetAppId, ticket_hash: null })

    const privateRows = readJsonLines(
      path.join(fixture.output, 'data', 'mip_private_profiles.jsonl'),
    )
    const privateProfile = decodeMipExportValue(privateRows[0]) as Record<string, unknown>
    expect(privateProfile.app_id).toBe(targetAppId)
    expect(revealPhone(
      privateProfile.phone_ciphertext,
      targetPhoneEncryptionKey,
      { appId: targetAppId, userId: fixture.userId },
    )).toBe('+86:13800138000')
    expect(revealContact(
      privateProfile.wechat_ciphertext,
      targetPhoneEncryptionKey,
      { appId: targetAppId, userId: fixture.userId },
    )).toBe('private-contact-value')
    expect(() => revealPhone(
      privateProfile.phone_ciphertext,
      sourcePhoneEncryptionKey,
      { appId: sourceAppId, userId: fixture.userId },
    )).toThrow()

    const outputData = fs.readdirSync(path.join(fixture.output, 'data'))
      .map(file => fs.readFileSync(path.join(fixture.output, 'data', file), 'utf8'))
      .join('')
    expect(outputData).not.toContain(sourceAppId)
    expect(outputData).not.toContain('must-not-survive')
    expect(fs.statSync(fixture.output).mode & 0o777).toBe(0o700)
    for (const file of fs.readdirSync(path.join(fixture.output, 'data'))) {
      expect(fs.statSync(path.join(fixture.output, 'data', file)).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects tampered checksums and does not create a partial target package', () => {
    const fixture = exportFixture()
    fs.appendFileSync(path.join(fixture.input, 'data', 'mip_users.jsonl'), '{}\n')

    expect(() => transformFixture(fixture)).toThrow('MIGRATION_CHECKSUM_MISMATCH')
    expect(fs.existsSync(fixture.output)).toBe(false)
  })

  it('strictly validates JSONL and canonical binary markers before transformation', () => {
    const fixture = exportFixture()
    const filePath = path.join(fixture.input, 'data', 'mip_users.jsonl')
    fs.writeFileSync(filePath, '{"app_id":"wx1111111111111111","blob":{"$binaryBase64":"%%%"}}\n')
    const manifestPath = path.join(fixture.input, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const table = manifest.tables.find((item: { table: string }) => item.table === 'mip_users')
    table.sha256 = sha256File(filePath)
    table.bytes = fs.statSync(filePath).size
    const checksumPath = path.join(fixture.input, 'checksums.sha256')
    const checksums = fs.readFileSync(checksumPath, 'utf8').replace(
      /^[a-f0-9]{64}\x20{2}data\/mip_users\.jsonl$/m,
      `${sha256File(filePath)}  data/mip_users.jsonl`,
    )
    fs.writeFileSync(checksumPath, checksums)
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    expect(() => validateMipAppScopeExportPackage({
      inputDirectory: fixture.input,
      repoRoot,
      sourceAppId,
      sourceEnvironmentFingerprint,
    })).toThrow('MIGRATION_BINARY_MARKER_INVALID')
  })

  it('fails closed on the wrong source encryption key without echoing private values', () => {
    const fixture = exportFixture()
    let message = ''
    try {
      transformFixture(fixture, {
        sourcePhoneEncryptionKey: 'wrong-source-encryption-key-with-32-characters',
      })
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe('MIGRATION_PHONE_DECRYPTION_FAILED')
    expect(message).not.toContain(sourceAppId)
    expect(message).not.toContain(fixture.userId)
    expect(message).not.toContain('private-contact-value')
    expect(fs.existsSync(fixture.output)).toBe(false)
  })

  it('loads only the migration identity context from separate environment files', () => {
    const base = fixtureRoot()
    const sourceEnv = path.join(base, 'source.env')
    fs.writeFileSync(sourceEnv, [
      `CLOUDBASE_ENV_ID=${sourceEnvironmentId}`,
      `MIP_PHONE_ENCRYPTION_KEY=${sourcePhoneEncryptionKey}`,
      'CLOUDBASE_API_KEY=must-not-be-returned',
      '',
    ].join('\n'), { mode: 0o600 })

    const loaded = loadMigrationEncryptionEnvironment(sourceEnv)
    expect(loaded).toMatchObject({
      environmentFingerprint: sourceEnvironmentFingerprint,
      phoneEncryptionKey: sourcePhoneEncryptionKey,
    })
    expect(loaded).not.toHaveProperty('CLOUDBASE_API_KEY')
    expect(JSON.stringify(loaded)).not.toContain('must-not-be-returned')
  })

  it('refuses a package or destination inside the repository', () => {
    const fixture = exportFixture()
    expect(() => transformFixture(fixture, {
      outputDirectory: path.join(repoRoot, '.tmp', 'migration-output'),
    })).toThrow('outside the repository')
  })
})
