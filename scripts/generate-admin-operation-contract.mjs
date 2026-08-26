#!/usr/bin/env node

import process from 'node:process'
import {
  assertAdminOperationContractArtifact,
  writeAdminOperationContractArtifact,
} from './lib/admin-operation-contract.mjs'

const mode = process.argv[2]
if (process.argv.length !== 3 || !['--check', '--write'].includes(mode)) {
  throw new Error('Usage: node scripts/generate-admin-operation-contract.mjs --check|--write')
}

if (mode === '--write') {
  console.log(`Generated ${writeAdminOperationContractArtifact()}`)
}
else {
  assertAdminOperationContractArtifact()
  console.log('Admin operation contract artifact is current')
}
