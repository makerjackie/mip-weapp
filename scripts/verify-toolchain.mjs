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
if (process.versions.node !== expectedNodeVersion) {
  throw new Error(`Node ${expectedNodeVersion} is required by .nvmrc; received ${process.version}`)
}

const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()
if (pnpmVersion !== expectedPnpmVersion) {
  throw new Error(`pnpm ${expectedPnpmVersion} is required by package.json; received ${pnpmVersion}`)
}

console.log(`Toolchain contract passed (Node ${process.versions.node}, pnpm ${pnpmVersion})`)
