#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { getProject, readJson } from './lib/project.mjs'

const example = getProject()
const outputDir = path.join(example.root, 'dist')
const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), `mip-weapp-build-stage-`))
const stagingProjectConfigPath = path.join(stagingDir, 'project.config.json')
const projectConfig = readJson(path.join(example.root, 'project.config.json'))
const absoluteStagingDir = `${stagingDir.replaceAll(path.sep, '/')}/`

fs.writeFileSync(stagingProjectConfigPath, `${JSON.stringify({
  ...projectConfig,
  miniprogramRoot: absoluteStagingDir,
  srcMiniprogramRoot: absoluteStagingDir,
}, null, 2)}\n`)

function synchronizeDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true })
  const sourceEntries = new Set(fs.readdirSync(source))
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (source === stagingDir && entry.name === 'app.json') {
      continue
    }
    const sourcePath = path.join(source, entry.name)
    const destinationPath = path.join(destination, entry.name)
    if (entry.isDirectory()) {
      synchronizeDirectory(sourcePath, destinationPath)
    }
    else {
      fs.copyFileSync(sourcePath, destinationPath)
    }
  }
  for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
    if (!sourceEntries.has(entry.name)) {
      fs.rmSync(path.join(destination, entry.name), { force: true, recursive: entry.isDirectory() })
    }
  }
}

const result = spawnSync('pnpm', [
  'exec',
  'wv',
  'build',
  '--project-config',
  path.relative(example.root, stagingProjectConfigPath),
], {
  cwd: example.root,
  stdio: 'inherit',
  env: { ...process.env, WEAPP_VITE_MCP: '0' },
})

if (result.error) {
  fs.rmSync(stagingDir, { force: true, recursive: true })
  throw result.error
}
if (result.status !== 0) {
  fs.rmSync(stagingDir, { force: true, recursive: true })
  process.exit(result.status ?? 1)
}

fs.rmSync(stagingProjectConfigPath, { force: true })
const stagedNpm = path.join(stagingDir, 'miniprogram_npm')
const currentNpm = path.join(outputDir, 'miniprogram_npm')
if (!fs.existsSync(stagedNpm) && fs.existsSync(currentNpm)) {
  fs.cpSync(currentNpm, stagedNpm, { recursive: true })
}
fs.mkdirSync(outputDir, { recursive: true })
synchronizeDirectory(stagingDir, outputDir)
fs.copyFileSync(path.join(stagingDir, 'app.json'), path.join(outputDir, 'app.json'))
fs.rmSync(stagingDir, { force: true, recursive: true })
