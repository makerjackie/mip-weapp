import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MIP_TABLE_PREFIX = 'mip_'
export const MIP_MIGRATION_TRACKING_TABLE = 'mip_schema_migrations'
export const MIP_MIGRATION_STEP_TABLE = 'mip_schema_migration_steps'

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

export function splitMipSqlStatements(sql) {
  const statements = []
  let current = ''
  let quote = null
  let lineComment = false
  let blockComment = false

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      current += char
      if (char === '\n') {
        lineComment = false
      }
      continue
    }
    if (blockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += '/'
        index += 1
        blockComment = false
      }
      continue
    }
    if (!quote && char === '-' && next === '-') {
      current += '--'
      index += 1
      lineComment = true
      continue
    }
    if (!quote && char === '/' && next === '*') {
      current += '/*'
      index += 1
      blockComment = true
      continue
    }
    if (quote) {
      current += char
      if (char === '\\') {
        current += next || ''
        index += 1
      }
      else if (char === quote) {
        quote = null
      }
      continue
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char
      current += char
      continue
    }
    if (char === ';') {
      if (current.trim()) {
        statements.push(current.trim())
      }
      current = ''
      continue
    }
    current += char
  }

  if (current.trim()) {
    statements.push(current.trim())
  }
  return statements
}

function tableReferences(statement) {
  const references = []
  const source = statement
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
  const patterns = [
    /\bCREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi,
    /\bALTER\s+TABLE\s+`?(\w+)`?/gi,
    /^INSERT\s+INTO\s+`?(\w+)`?/gi,
    /^UPDATE\s+`?(\w+)`?/gi,
    /^DELETE\s+FROM\s+`?(\w+)`?/gi,
    /\bFROM\s+`?(\w+)`?/gi,
    /\bJOIN\s+`?(\w+)`?/gi,
    /\bREFERENCES\s+`?(\w+)`?/gi,
    /\bDROP\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+EXISTS\s+)?`?(\w+)`?/gi,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+`?\w+`?\s+ON\s+`?(\w+)`?/gi,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      references.push(match[1])
    }
  }
  return references
}

export function assertMipMigrationSql(sql, options = {}) {
  const rollback = options.rollback === true
  const statements = splitMipSqlStatements(sql)
  if (statements.length === 0) {
    throw new Error('MIP migration is empty')
  }

  for (const statement of statements) {
    if (/\b(?:CREATE|DROP)\s+DATABASE\b/i.test(statement)) {
      throw new Error('MIP migrations cannot create or drop databases')
    }
    if (!rollback && /\bDELETE\s+FROM\b/i.test(statement)) {
      throw new Error('Forward MIP migrations cannot delete rows')
    }
    if (!rollback && /\b(?:DROP\s+TABLE|TRUNCATE\s+TABLE|RENAME\s+TABLE)\b/i.test(statement)) {
      throw new Error('Forward MIP migrations cannot drop, truncate, or rename tables')
    }
    if (!rollback && /\bALTER\s+TABLE\b[\s\S]+\bDROP\s+COLUMN\b/i.test(statement)) {
      throw new Error('Forward MIP migrations cannot drop columns')
    }
    const references = tableReferences(statement)
    if (references.length === 0) {
      throw new Error(`MIP migration statement has no verifiable table target: ${statement.slice(0, 80)}`)
    }
    for (const table of references) {
      if (!table.startsWith(MIP_TABLE_PREFIX)) {
        throw new Error(`MIP migration references non-MIP table: ${table}`)
      }
    }
  }
  return statements
}

export function loadMipMigrationLock(repoRoot) {
  const migrationsRoot = path.join(repoRoot, 'database', 'mysql', 'mip')
  const lockPath = path.join(migrationsRoot, 'migrations.lock.json')
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  if (
    lock.version !== 1
    || lock.tablePrefix !== MIP_TABLE_PREFIX
    || lock.trackingTable !== MIP_MIGRATION_TRACKING_TABLE
    || !Array.isArray(lock.migrations)
    || lock.migrations.length === 0
  ) {
    throw new Error('MIP migration lock is invalid')
  }

  const seenVersions = new Set()
  const seenNames = new Set()
  const seenTables = new Set([MIP_MIGRATION_TRACKING_TABLE, MIP_MIGRATION_STEP_TABLE])
  const migrations = lock.migrations.map((migration) => {
    if (
      !/^[a-z][a-z0-9_]*$/.test(migration.name)
      || !/^\d{14}$/.test(migration.version)
      || seenNames.has(migration.name)
      || seenVersions.has(migration.version)
    ) {
      throw new Error('MIP migration identity is invalid or duplicated')
    }
    seenNames.add(migration.name)
    seenVersions.add(migration.version)

    const createsTables = migration.createsTables
    const altersTables = migration.altersTables || []
    if (!Array.isArray(createsTables)
      || !Array.isArray(altersTables)
      || createsTables.length + altersTables.length === 0) {
      throw new Error(`MIP migration must declare created or altered tables: ${migration.name}`)
    }
    for (const table of createsTables) {
      if (!/^mip_[a-z0-9_]+$/.test(table) || seenTables.has(table)) {
        throw new Error(`MIP migration table is invalid or duplicated: ${table}`)
      }
      seenTables.add(table)
    }
    for (const table of altersTables) {
      if (!/^mip_[a-z0-9_]+$/.test(table) || !seenTables.has(table)) {
        throw new Error(`MIP altered table is invalid or not yet declared: ${table}`)
      }
    }

    const files = [
      ['sql', 'sqlSha256', false],
      ['rollback', 'rollbackSha256', true],
    ]
    for (const [fileKey, hashKey, rollback] of files) {
      const relativePath = migration[fileKey]
      const absolutePath = path.resolve(repoRoot, relativePath)
      const allowedRoot = `${migrationsRoot}${path.sep}`
      if (!absolutePath.startsWith(allowedRoot) || sha256File(absolutePath) !== migration[hashKey]) {
        throw new Error(`MIP migration drift detected: ${relativePath}`)
      }
      assertMipMigrationSql(fs.readFileSync(absolutePath, 'utf8'), { rollback })
    }

    return {
      ...migration,
      altersTables,
      sqlPath: path.resolve(repoRoot, migration.sql),
      rollbackPath: path.resolve(repoRoot, migration.rollback),
    }
  })

  const sorted = [...migrations].sort((left, right) => left.version.localeCompare(right.version))
  if (sorted.some((migration, index) => migration !== migrations[index])) {
    throw new Error('MIP migrations must be ordered by version')
  }

  return {
    ...lock,
    migrations,
    requiredTables: [...seenTables],
  }
}
