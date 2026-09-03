#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const expectedNodeVersion = fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, '')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const expectedPnpmVersion = /^pnpm@(.+)$/.exec(packageJson.packageManager)?.[1]

if (!expectedPnpmVersion) {
  throw new Error('package.json packageManager must declare an exact pnpm version')
}
const enginesNode = packageJson.engines?.node ?? ''
const minNodeVersion = /^>=(\d+\.\d+\.\d+)/.exec(enginesNode)?.[1]
if (!minNodeVersion) {
  throw new Error('package.json engines.node must declare a minimum Node version (">=x.y.z")')
}
const nodeTuple = process.versions.node.split('.').map(Number)
const minTuple = minNodeVersion.split('.').map(Number)
for (let i = 0; i < 3; i += 1) {
  if ((nodeTuple[i] ?? 0) > (minTuple[i] ?? 0)) {
    break
  }
  if ((nodeTuple[i] ?? 0) < (minTuple[i] ?? 0)) {
    throw new Error(`Node >= ${minNodeVersion} is required by package.json engines; received ${process.version}`)
  }
}
if (process.versions.node !== expectedNodeVersion) {
  console.warn(
    `[WARN] .nvmrc pins Node ${expectedNodeVersion}; received ${process.version} — allowed by engines.node (${enginesNode})`,
  )
}

const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
if (pnpmVersion !== expectedPnpmVersion) {
  throw new Error(`pnpm ${expectedPnpmVersion} is required by package.json; received ${pnpmVersion}`)
}

console.log(`Toolchain contract passed (Node ${process.versions.node}, pnpm ${pnpmVersion})`)
