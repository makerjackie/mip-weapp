import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { assertBackupCompletedWithinMaxAge } from './mip-backup-policy.mjs'

export function validateBackupManifest({ manifestPath, envId, repoRoot, maxAgeHours }) {
  if (!manifestPath) {
    throw new Error('Database changes require --backup-manifest=<absolute manifest.json>')
  }
  const absoluteManifest = path.resolve(manifestPath)
  const relativeToRepo = path.relative(repoRoot, absoluteManifest)
  if (relativeToRepo === '' || (!relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo))) {
    throw new Error('Database backup manifest must be outside the repository')
  }
  if (path.basename(absoluteManifest) !== 'manifest.json') {
    throw new Error('Database backup confirmation must point to manifest.json')
  }

  const manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'))
  const expectedFingerprint = crypto.createHash('sha256').update(envId).digest('hex').slice(0, 16)
  if (
    manifest.format !== 'mip-cloudbase-mysql-logical-backup-v1'
    || manifest.environmentFingerprint !== expectedFingerprint
    || manifest.consistency !== 'row-count-verified'
    || manifest.transactionalSnapshot !== false
  ) {
    throw new Error('Database backup manifest is incompatible, unstable, or for another environment')
  }

  assertBackupCompletedWithinMaxAge({
    completedAt: manifest.completedAt,
    maxAgeHours,
  })
  if (!Array.isArray(manifest.tables) || manifest.tables.length !== manifest.tableCount) {
    throw new Error('Database backup table manifest is incomplete')
  }

  const backupDirectory = path.dirname(absoluteManifest)
  for (const table of manifest.tables) {
    const dataPath = path.resolve(backupDirectory, table.relativeFile)
    const relative = path.relative(backupDirectory, dataPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Database backup contains an unsafe data path')
    }
    const digest = crypto.createHash('sha256').update(fs.readFileSync(dataPath)).digest('hex')
    if (digest !== table.sha256 || table.rowsBefore !== table.rowsExported || table.rowsAfter !== table.rowsExported) {
      throw new Error(`Database backup validation failed for table: ${table.table}`)
    }
  }
  return manifest
}
