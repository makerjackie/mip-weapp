#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { resolveProjectAutomatorPort } from 'weapp-ide-cli'
import { isLocalPortListening } from './lib/devtools-automator-session.mjs'
import {
  resolveLocalDevtoolsHostRoot,
  selectRuntimeDevtoolsRoot,
  syncLocalDevtoolsHost,
} from './lib/devtools-host.mjs'
import { installMiniprogramAutomatorCompatibility } from './lib/miniprogram-automator-compat.mjs'
import { getProject } from './lib/project.mjs'

const example = getProject()
const args = process.argv.slice(2)
const mapOnly = args.includes('--map-only') || args.includes('--offline-only')
const skipBuild = args.includes('--skip-build')
const hostRoot = resolveLocalDevtoolsHostRoot(example.root)
let devtoolsRoot = hostRoot

if (!mapOnly) {
  if (!skipBuild) {
    const build = spawnSync('pnpm', ['build'], {
      cwd: example.root,
      stdio: 'inherit',
      env: { ...process.env, WEAPP_VITE_MCP: '0' },
    })
    if (build.error) {
      throw build.error
    }
    if (build.status !== 0) {
      process.exit(build.status ?? 1)
    }
    process.argv.push('--skip-build')
  }
  devtoolsRoot = selectRuntimeDevtoolsRoot({
    sourceRoot: example.root,
    hostRoot,
    openedSourceAutomatorAvailable: await isLocalPortListening(
      resolveProjectAutomatorPort(example.root),
    ),
  })
  if (devtoolsRoot !== example.root) {
    syncLocalDevtoolsHost({ sourceRoot: example.root, hostRoot })
  }
}

process.env.MINIPROGRAM_SOURCE_ROOT = example.root
process.env.MINIPROGRAM_PROJECT_ROOT = example.root
process.env.MINIPROGRAM_DEVTOOLS_PROJECT_ROOT = devtoolsRoot
process.env.MINIPROGRAM_SESSION_ID = 'mip-weapp-runtime'
installMiniprogramAutomatorCompatibility()
const caseVerifier = path.join(example.root, 'scripts', 'verify-runtime.mjs')
const verifier = await import(pathToFileURL(caseVerifier).href)
if (typeof verifier.main === 'function') {
  await verifier.main(process.argv.slice(2))
}
