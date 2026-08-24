#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { assertRuntimePreflight } from './lib/runtime-preflight.mjs'

const root = path.resolve(import.meta.dirname, '..')
const runtimeContract = JSON.parse(fs.readFileSync(path.join(root, 'config', 'runtime-pages.json'), 'utf8'))
const result = await assertRuntimePreflight(root, {
  requiredRoutes: runtimeContract.routes.map(route => route.path),
})
console.log(JSON.stringify({ ok: true, ...result }, null, 2))
