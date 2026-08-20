#!/usr/bin/env node

import path from 'node:path'
import { assertMembershipApiActivityDomainPackage } from './lib/membership-api-package.mjs'
import { verifyNodeSources } from './lib/node-source-verifier.mjs'

const root = path.resolve(import.meta.dirname, '..')
const repositoryRoot = root

// Fail before unit tests if the deployable package still escapes this repository.
assertMembershipApiActivityDomainPackage({
  caseRoot: root,
  repositoryRoot,
})

const result = verifyNodeSources({
  cwd: root,
  sourceRoots: ['cloudfunctions'],
  testRoots: [
    'cloudfunctions/membership-api/tests',
    'cloudfunctions/membership-admin-api/tests',
    'cloudfunctions/membership-payment-ledger/tests',
    'cloudfunctions/membership-cloudpay/tests',
    'cloudfunctions/membership-cloudpay-callback/tests',
    'cloudfunctions/membership-notification-worker/tests',
  ],
})

console.log(`Membership server contract passed (${result.sourceCount} owned sources, ${result.testCount} tests)`)
