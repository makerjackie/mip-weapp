import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

function digest(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function loadVerifiedMigrations(caseRoot) {
  const lockPath = path.join(caseRoot, 'database', 'mysql', 'migrations.lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  if (lock.version !== 1 || !Array.isArray(lock.migrations) || !lock.migrations.length) {
    throw new Error('MySQL migration lock is invalid')
  }
  return lock.migrations.map((migration) => {
    if (!/^[a-z][a-z0-9_]*$/.test(migration.name) || !/^\d{14}$/.test(migration.version)) {
      throw new Error('MySQL migration identity is invalid')
    }
    for (const [fileKey, hashKey] of [['sql', 'sqlSha256'], ['rollback', 'rollbackSha256']]) {
      const relativePath = migration[fileKey]
      const absolutePath = path.resolve(caseRoot, relativePath)
      const allowedRoot = `${path.join(caseRoot, 'database', 'mysql')}${path.sep}`
      if (!absolutePath.startsWith(allowedRoot) || digest(absolutePath) !== migration[hashKey]) {
        throw new Error(`MySQL migration drift detected: ${relativePath}`)
      }
    }
    return migration
  })
}
