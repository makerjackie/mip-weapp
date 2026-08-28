#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {
  assertMipMediaMigrationConfirmations,
  createMipCloudbaseStorageTransport,
  createPrivateMipMediaWorkDirectory,
  loadMipMediaMigrationEnvironment,
  readMipMediaCheckpoint,
  removeMipMediaWorkDirectory,
  validateCheckpointEnvelope,
  writeMipMediaCheckpoint,
} from './lib/mip-media-copy-cli.mjs'
import {
  applyMipMediaCopyResultToTransformedPackage,
  buildMipLongTermMediaCopyPlan,
  createMipMediaCopyCheckpoint,
  executeMipLongTermMediaCopy,
  loadVerifiedMipMediaExportPackage,
} from './lib/mip-media-copy.mjs'

const root = path.resolve(import.meta.dirname, '..')

try {
  const options = parseArguments(process.argv.slice(2))
  const source = loadMipMediaMigrationEnvironment(options.sourceEnvFile)
  const target = loadMipMediaMigrationEnvironment(options.targetEnvFile, 'staging')
  assertMipMediaMigrationConfirmations({
    source,
    target,
    confirmSourceEnvironment: options.confirmSourceEnv,
    confirmTargetEnvironment: options.confirmTargetEnv,
    confirmSourceAppId: options.confirmSourceAppId,
    confirmTargetAppId: options.confirmTargetAppId,
  })
  const sourcePackage = loadVerifiedMipMediaExportPackage({
    exportDirectory: options.sourcePackage,
    sourceAppId: source.appId,
    sourceEnvironmentId: source.environmentId,
  })
  const plan = buildMipLongTermMediaCopyPlan({
    sourcePackage,
    sourceAppId: source.appId,
    targetAppId: target.appId,
    sourceMediaScopeSecret: source.mediaScopeSecret,
    targetMediaScopeSecret: target.mediaScopeSecret,
    targetStage: target.stage,
  })
  const workDirectory = createPrivateMipMediaWorkDirectory(options.transformedPackage, root)
  const checkpointPath = path.join(workDirectory, 'checkpoint.json')
  const checkpoint = readMipMediaCheckpoint(checkpointPath)
  let completedUpdates = validateCheckpointEnvelope(checkpoint, plan)
  const transport = createMipCloudbaseStorageTransport({
    projectRoot: root,
    sourceEnvironment: source,
    targetEnvironment: target,
    workDirectory,
  })

  console.log(`[mip-media-copy] plan verified: ${plan.copiedCount} retained, ${plan.excludedCount} excluded`)
  const result = await executeMipLongTermMediaCopy({
    plan,
    transport,
    resumeUpdates: completedUpdates,
    onProgress(progress) {
      console.log(`[mip-media-copy] ${progress.phase.toLowerCase()} ${progress.completed}/${progress.total}`)
    },
    onCheckpoint(update) {
      completedUpdates = [...completedUpdates, update]
      writeMipMediaCheckpoint(
        checkpointPath,
        createMipMediaCopyCheckpoint({ plan, updates: completedUpdates }),
      )
    },
  })
  const packageUpdate = applyMipMediaCopyResultToTransformedPackage({
    packageDirectory: options.transformedPackage,
    sourceAppId: source.appId,
    targetAppId: target.appId,
    plan,
    result,
  })
  removeMipMediaWorkDirectory(workDirectory, options.transformedPackage)
  console.log(`[mip-media-copy] package updated: ${packageUpdate.copiedCount} copied, ${packageUpdate.excludedCount} excluded`)
  console.log('[mip-media-copy] source, upload, readback, package checksums verified')
}
catch (error) {
  const message = error instanceof Error ? error.message : 'MIP_MEDIA_COPY_FAILED'
  const safeMessage = /^MIP_MEDIA_COPY_[A-Z0-9_:.-]+$/.test(message)
    ? message
    : 'MIP_MEDIA_COPY_FAILED'
  console.error(`[mip-media-copy] failed: ${safeMessage}`)
  process.exitCode = 1
}

export function parseArguments(argv) {
  const definitions = new Map([
    ['--source-package=', 'sourcePackage'],
    ['--transformed-package=', 'transformedPackage'],
    ['--source-env-file=', 'sourceEnvFile'],
    ['--target-env-file=', 'targetEnvFile'],
    ['--confirm-source-env=', 'confirmSourceEnv'],
    ['--confirm-target-env=', 'confirmTargetEnv'],
    ['--confirm-source-app-id=', 'confirmSourceAppId'],
    ['--confirm-target-app-id=', 'confirmTargetAppId'],
  ])
  const values = {}
  for (const argument of argv) {
    const definition = [...definitions].find(([prefix]) => argument.startsWith(prefix))
    if (!definition) {
      throw new Error('MIP_MEDIA_COPY_ARGUMENT_INVALID')
    }
    const [prefix, key] = definition
    if (Object.hasOwn(values, key)) {
      throw new Error('MIP_MEDIA_COPY_ARGUMENT_INVALID')
    }
    const value = argument.slice(prefix.length)
    if (!value) {
      throw new Error('MIP_MEDIA_COPY_ARGUMENT_INVALID')
    }
    values[key] = value
  }
  if ([...definitions.values()].some(key => !Object.hasOwn(values, key))) {
    throw new Error('MIP_MEDIA_COPY_ARGUMENT_MISSING')
  }
  for (const key of ['sourcePackage', 'transformedPackage', 'sourceEnvFile', 'targetEnvFile']) {
    if (!fs.existsSync(path.resolve(values[key]))) {
      throw new Error('MIP_MEDIA_COPY_ARGUMENT_INVALID')
    }
  }
  return values
}
