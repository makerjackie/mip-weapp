#!/usr/bin/env node

import path from 'node:path'
import process from 'node:process'
import {
  loadMigrationEncryptionEnvironment,
  transformMipAppScopeExportPackage,
} from './lib/mip-app-scope-transform-package.mjs'

const root = path.resolve(import.meta.dirname, '..')

try {
  const options = parseArguments(process.argv.slice(2))
  const sourceEnvironment = loadMigrationEncryptionEnvironment(options.sourceEnvFile)
  const targetEnvironment = loadMigrationEncryptionEnvironment(options.targetEnvFile)
  if (sourceEnvironment.realPath === targetEnvironment.realPath) {
    throw new Error('MIGRATION_ENV_FILES_MUST_DIFFER')
  }
  const result = transformMipAppScopeExportPackage({
    inputDirectory: options.input,
    outputDirectory: options.output,
    repoRoot: root,
    sourceAppId: options.sourceAppId,
    targetAppId: options.targetAppId,
    sourcePhoneEncryptionKey: sourceEnvironment.phoneEncryptionKey,
    targetPhoneEncryptionKey: targetEnvironment.phoneEncryptionKey,
    sourceEnvironmentFingerprint: sourceEnvironment.environmentFingerprint,
    targetEnvironmentFingerprint: targetEnvironment.environmentFingerprint,
  })
  console.log(`[mip-app-transform] verified and transformed ${result.tableCount} tables`)
  console.log(`[mip-app-transform] retained ${result.rowCount} rows; excluded ${result.excludedRowCount} rows`)
  console.log('[mip-app-transform] private output package is ready')
}
catch (error) {
  const message = error instanceof Error ? error.message : 'MIGRATION_TRANSFORM_FAILED'
  const safeMessage = /^[A-Z0-9_:.-]+$/.test(message)
    ? message
    : 'MIGRATION_TRANSFORM_FAILED'
  console.error(`[mip-app-transform] failed: ${safeMessage}`)
  process.exitCode = 1
}

export function parseArguments(argv) {
  const definitions = new Map([
    ['--input=', 'input'],
    ['--output=', 'output'],
    ['--source-app-id=', 'sourceAppId'],
    ['--target-app-id=', 'targetAppId'],
    ['--source-env-file=', 'sourceEnvFile'],
    ['--target-env-file=', 'targetEnvFile'],
  ])
  const values = {}
  const provided = new Set()
  for (const argument of argv) {
    const definition = [...definitions].find(([prefix]) => argument.startsWith(prefix))
    if (!definition) {
      throw new Error('MIGRATION_ARGUMENT_INVALID')
    }
    const [prefix, key] = definition
    const value = argument.slice(prefix.length)
    if (!value || provided.has(key)) {
      throw new Error('MIGRATION_ARGUMENT_INVALID')
    }
    provided.add(key)
    values[key] = value
  }
  if (provided.size !== definitions.size) {
    throw new Error('MIGRATION_ARGUMENT_MISSING')
  }
  return values
}
