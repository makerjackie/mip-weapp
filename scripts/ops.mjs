#!/usr/bin/env node

// Target orchestration for the direction-B environment split (MIW-111).
// Selects an envs/<target> configuration directory and runs the full deployment
// chain with every confirmation flag assembled from that directory only:
//
//   node scripts/ops.mjs --target=test        # second schema + mip-t-* suite
//   node scripts/ops.mjs --target=production  # existing default suite
//
// Chain: migration dry-run → migration apply → project:init →
// cloud function deploy → runtime grants → cloud verification. Deploy precedes
// grants because a fresh target's runtime connection URI is provisioned (and
// persisted into the target's .env.secrets.local) by deploy-functions itself.
// Owner bootstrap and payment acceptance stay manual and are intentionally
// NOT part of this chain.
//
// This script performs no cloud calls of its own; it only refuses to start when
// the target directory is missing, incomplete, or internally inconsistent.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseEnv } from './lib/example-cloudbase.mjs'
import { runtimeUserForEnvironment } from './lib/mysql-privilege-assert.mjs'

const root = path.resolve(import.meta.dirname, '..')

const TARGETS = Object.freeze({
  test: { dir: 'envs/test', requiresSchema: true },
  production: { dir: 'envs/prod', requiresSchema: false },
})

const targetName = argumentValue('--target=')
if (!targetName || !TARGETS[targetName]) {
  throw new Error(`ops.mjs requires --target=${Object.keys(TARGETS).join('|')}`)
}
// An ambient MIP_ENV_DIR pointing at a DIFFERENT tracked target signals a
// confused shell (prod vars leaking into a test run and vice versa); stop.
// Values outside envs/ (sandboxes, CI scratch dirs) are overridden with a
// warning because the child environment is pinned from --target anyway.
const ambientEnvDir = String(process.env.MIP_ENV_DIR || '').trim()
if (ambientEnvDir) {
  const knownTargetDirs = new Set(Object.values(TARGETS).map(item => path.resolve(root, item.dir)))
  const ambientResolved = path.resolve(root, ambientEnvDir)
  if (knownTargetDirs.has(ambientResolved) && ambientResolved !== path.resolve(root, targetName === 'production' ? 'envs/prod' : 'envs/test')) {
    throw new Error('MIP_ENV_DIR in the environment disagrees with --target; run with a clean environment')
  }
  if (!knownTargetDirs.has(ambientResolved)) {
    console.warn(`[ops] overriding ambient MIP_ENV_DIR (${ambientEnvDir}) with the --target directory`)
  }
}

const target = TARGETS[targetName]
const envDir = path.join(root, target.dir)
if (!fs.existsSync(path.join(envDir, '.env.local'))) {
  throw new Error(`Target ${targetName} is not configured: copy ${target.dir}/env.example to ${target.dir}/.env.local and fill it in`)
}

const targetEnv = parseEnv(path.join(envDir, '.env.local'))
const envId = String(process.env.CLOUDBASE_ENV_ID || targetEnv.CLOUDBASE_ENV_ID || '').trim()
const schemaName = String(process.env.MIP_DB_SCHEMA || targetEnv.MIP_DB_SCHEMA || '').trim()
const deploymentStage = String(process.env.MIP_DEPLOYMENT_STAGE || targetEnv.MIP_DEPLOYMENT_STAGE || '').trim().toLowerCase()
const paymentMode = String(process.env.MIP_PAYMENT_MODE || targetEnv.MIP_PAYMENT_MODE || 'disabled').trim().toLowerCase()
const catalogStage = String(process.env.MIP_CATALOG_STAGE || targetEnv.MIP_CATALOG_STAGE || '').trim().toUpperCase()

if (!envId) {
  throw new Error(`Target ${targetName} has no CLOUDBASE_ENV_ID in ${target.dir}/.env.local`)
}
if (targetName === 'production' && schemaName) {
  throw new Error('Production target must use the instance-default schema; remove MIP_DB_SCHEMA from envs/prod/.env.local')
}
if (target.requiresSchema && !schemaName) {
  throw new Error('Test target requires MIP_DB_SCHEMA (the second logical database) in envs/test/.env.local')
}
if (targetName === 'production' && deploymentStage !== 'production') {
  throw new Error('Production target must set MIP_DEPLOYMENT_STAGE=production')
}
if (targetName === 'test' && deploymentStage === 'production') {
  throw new Error('Test target must not set MIP_DEPLOYMENT_STAGE=production')
}
// The runtime user is derived (envId, schema); confirmations echo the derived
// value only when the target did not pin MIP_DB_RUNTIME_USER explicitly.
const runtimeUserPin = String(process.env.MIP_DB_RUNTIME_USER || targetEnv.MIP_DB_RUNTIME_USER || '').trim()

const childEnv = {
  ...process.env,
  MIP_ENV_DIR: envDir,
  CLOUDBASE_ENV_ID: envId,
  ...(schemaName ? { MIP_DB_SCHEMA: schemaName } : {}),
  ...(runtimeUserPin ? { MIP_DB_RUNTIME_USER: runtimeUserPin } : {}),
  MIP_DEPLOYMENT_STAGE: deploymentStage,
  MIP_PAYMENT_MODE: paymentMode,
  MIP_CATALOG_STAGE: catalogStage,
}

const schemaFlags = schemaName ? [`--confirm-schema=${schemaName}`] : []
const steps = [
  {
    name: `migrations dry-run (${targetName})`,
    command: ['node', 'scripts/apply-mip-schema.mjs', '--dry-run', `--confirm-env=${envId}`, '--confirm-prefix=mip_', ...schemaFlags],
  },
  {
    name: `migrations apply (${targetName})`,
    command: ['node', 'scripts/apply-mip-schema.mjs', `--confirm-env=${envId}`, '--confirm-prefix=mip_', ...schemaFlags],
  },
  {
    name: `project init (${targetName})`,
    command: ['node', 'scripts/project-init.mjs'],
  },
  {
    name: `cloud deploy (${targetName})`,
    command: () => {
      const flags = [`--confirm-env=${envId}`, ...schemaFlags]
      const pin = runtimeUserPin || derivedRuntimeUserHint()
      if (pin) {
        flags.push(`--confirm-runtime-user=${pin}`)
      }
      if (targetName === 'production') {
        flags.push('--confirm-production')
      }
      if (paymentMode === 'live' || catalogStage === 'LIVE') {
        flags.push('--confirm-live')
      }
      return ['node', 'scripts/deploy-functions.mjs', ...flags]
    },
  },
  {
    name: `runtime grants (${targetName})`,
    command: () => {
      const flags = [`--confirm-env=${envId}`, ...schemaFlags]
      const pin = runtimeUserPin || derivedRuntimeUserHint()
      if (pin) {
        flags.push(`--confirm-runtime-user=${pin}`)
      }
      return ['node', 'scripts/converge-mip-runtime-grants.mjs', ...flags]
    },
  },
  {
    name: `cloud verify (${targetName})`,
    command: ['node', 'scripts/verify-cloud.mjs', `--confirm-env=${envId}`, ...schemaFlags],
  },
]

console.log(`[ops] target=${targetName} env-dir=${target.dir} stage=${deploymentStage} catalog=${catalogStage} payment=${paymentMode}${schemaName ? ` schema=${schemaName}` : ''}`)
for (const step of steps) {
  const command = typeof step.command === 'function' ? step.command() : step.command
  console.log(`\n[ops] ▶ ${step.name}: ${command.join(' ')}`)
  const result = spawnSync(command[0], command.slice(1), {
    cwd: root,
    env: childEnv,
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    throw new Error(`[ops] step failed (${result.status ?? 'signal'}): ${step.name}`)
  }
}
console.log(`\n[ops] target ${targetName} chain complete. Owner bootstrap and payment acceptance remain manual.`)

function argumentValue(prefix) {
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

// deploy-functions derives the expected account itself; grants convergence
// requires the explicit flag up front, so resolve the same (envId, schema)
// derivation locally instead of hand-copying values.
function derivedRuntimeUserHint() {
  return runtimeUserForEnvironment(envId, schemaName || undefined)
}
