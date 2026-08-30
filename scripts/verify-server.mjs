#!/usr/bin/env node

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { MIP_FUNCTION_SOURCES } from './lib/mip-function-names.mjs'
import { verifyNodeSources } from './lib/node-source-verifier.mjs'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const providerSources = [
  'mip-ai-avatar-provider',
  'mip-ai-draft-provider',
]
const sourceRoots = [...new Set(Object.values(MIP_FUNCTION_SOURCES))]
  .map(source => path.join('cloudfunctions', source))
const providerRoots = providerSources.map(source => path.join('cloudfunctions', source))
const declaredDependencyVersions = new Map()

function installedPackageVersion(name) {
  let current = path.dirname(require.resolve(name, { paths: [root] }))
  while (current !== path.dirname(current)) {
    const packagePath = path.join(current, 'package.json')
    if (fs.existsSync(packagePath)) {
      const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
      if (manifest.name === name && typeof manifest.version === 'string') {
        return manifest.version
      }
    }
    current = path.dirname(current)
  }
  throw new Error(`Unable to resolve installed package manifest for ${name}`)
}

for (const relativePath of [...sourceRoots, ...providerRoots]) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    throw new Error(`Missing direct MIP Cloud Function source: ${relativePath}`)
  }
  const manifestPath = path.join(root, relativePath, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  for (const [name, version] of Object.entries(manifest.dependencies || {})) {
    if (!/^\d+\.\d+\.\d+(?:-[\da-z.-]+)?$/i.test(String(version))) {
      throw new Error(`${relativePath}/package.json must pin ${name} to an exact version; received ${version}`)
    }
    const declaredVersion = declaredDependencyVersions.get(name)
    if (declaredVersion && declaredVersion !== version) {
      throw new Error(`Cloud Functions must agree on ${name}; received ${declaredVersion} and ${version}`)
    }
    declaredDependencyVersions.set(name, version)
  }
  const mysqlAdapterPath = path.join(root, relativePath, 'lib', 'mysql.js')
  if (fs.existsSync(mysqlAdapterPath)) {
    const mysqlAdapter = fs.readFileSync(mysqlAdapterPath, 'utf8')
    if (!mysqlAdapter.includes('queueLimit: 16') || !mysqlAdapter.includes('connectTimeout: 8000')) {
      throw new Error(`${relativePath}/lib/mysql.js must bound connection setup and the pool wait queue`)
    }
  }
}
for (const [name, expectedVersion] of declaredDependencyVersions) {
  const installedVersion = installedPackageVersion(name)
  if (installedVersion !== expectedVersion) {
    throw new Error(`Server tests must resolve ${name}@${expectedVersion}; received ${installedVersion}`)
  }
}
const results = [...sourceRoots, ...providerRoots].map(relativePath => verifyNodeSources({
  cwd: root,
  sourceRoots: [relativePath],
  testRoots: [path.join(relativePath, 'tests')],
}))
const sourceCount = results.reduce((sum, result) => sum + result.sourceCount, 0)
const testCount = results.reduce((sum, result) => sum + result.testCount, 0)

console.log(`MIP server contract passed (${sourceCount} owned sources, ${testCount} test files)`)
