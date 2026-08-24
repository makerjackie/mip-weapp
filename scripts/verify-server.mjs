#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { MIP_FUNCTION_SOURCES } from './lib/mip-function-names.mjs'
import { verifyNodeSources } from './lib/node-source-verifier.mjs'

const root = path.resolve(import.meta.dirname, '..')
const sourceRoots = [...new Set(Object.values(MIP_FUNCTION_SOURCES))]
  .map(source => path.join('cloudfunctions', source))
for (const relativePath of sourceRoots) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Missing direct MIP Cloud Function source: ${relativePath}`)
  }
}
const testRoots = sourceRoots
  .map(relativePath => path.join(relativePath, 'tests'))
  .filter(relativePath => fs.existsSync(path.join(root, relativePath)))

const result = verifyNodeSources({
  cwd: root,
  sourceRoots,
  testRoots,
})

console.log(`MIP server contract passed (${result.sourceCount} owned sources, ${result.testCount} tests)`)
