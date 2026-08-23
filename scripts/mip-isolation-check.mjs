#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { loadMipMigrationLock, MIP_TABLE_PREFIX } from './lib/mip-migrations.mjs'

const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(read('package.json'))
const lock = loadMipMigrationLock(root)

assert(
  packageJson.scripts['database:setup'] === 'node scripts/apply-mip-schema.mjs',
  'database:setup must use the isolated MIP migration runner',
)
assert(fs.existsSync(path.join(root, 'CONTEXT.md')), 'MIP domain CONTEXT.md is missing')
assert(fs.existsSync(path.join(root, 'docs/mip/REQUIREMENTS.md')), 'MIP requirement baseline is missing')
assert(fs.existsSync(path.join(root, 'src/assets/brand/mip-logo-yellow.png')), 'MIP primary logo is missing')

for (const table of lock.requiredTables) {
  assert(table.startsWith(MIP_TABLE_PREFIX), `MIP migration lock contains unsafe table: ${table}`)
}

const activePaths = [
  'src/modules/mip',
  'src/config/mip-catalogs.ts',
  'database/mysql/mip',
  'scripts/apply-mip-schema.mjs',
  'scripts/lib/mip-migrations.mjs',
  ...listMipCloudFunctionDirectories(),
]
const forbiddenTables = /\b(?:member|dating|sewing)_\w+\b/i
for (const relativePath of activePaths) {
  for (const file of walk(relativePath)) {
    if (!/\.(?:js|mjs|ts|sql|json)$/.test(file)) {
      continue
    }
    const source = read(file)
    const match = source.match(forbiddenTables)
    assert(!match, `Active MIP code references a shared legacy table: ${file} (${match?.[0]})`)
  }
}

console.log('MIP isolation check passed')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(relativePath) {
  const absolutePath = path.join(root, relativePath)
  if (!fs.existsSync(absolutePath)) {
    return []
  }
  const stat = fs.statSync(absolutePath)
  if (stat.isFile()) {
    return [relativePath]
  }
  return fs.readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function listMipCloudFunctionDirectories() {
  const cloudRoot = path.join(root, 'cloudfunctions')
  if (!fs.existsSync(cloudRoot)) {
    return []
  }
  return fs.readdirSync(cloudRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('mip-'))
    .map(entry => path.join('cloudfunctions', entry.name))
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
