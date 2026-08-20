'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { describe, it } = require('node:test')

const functionRoot = path.resolve(__dirname, '..')
const caseRoot = path.resolve(functionRoot, '../..')
const repositoryRoot = caseRoot
const vendorPath = path.join(functionRoot, 'lib/vendor/activity-domain/pure.cjs')
const sourcePath = path.join(repositoryRoot, 'src/shared/activity-domain/pure.cjs')
const adapterPath = path.join(functionRoot, 'lib/activity-domain-adapter.js')

describe('membership-api package isolation for activity-domain', () => {
  it('vendors pure.cjs byte-identical to weapp-core source', () => {
    assert.equal(fs.existsSync(vendorPath), true, 'vendor pure.cjs missing')
    assert.equal(fs.existsSync(sourcePath), true, 'activity-domain source missing')
    const vendor = fs.readFileSync(vendorPath)
    const source = fs.readFileSync(sourcePath)
    assert.equal(vendor.equals(source), true, 'vendor pure.cjs must match in-repo activity-domain source bytes')
  })

  it('media-cleanup.js is byte-identical across membership-api and membership-admin-api', () => {
    const apiPath = path.join(functionRoot, 'domain/media-cleanup.js')
    const adminPath = path.join(caseRoot, 'cloudfunctions/membership-admin-api/domain/media-cleanup.js')
    assert.equal(fs.existsSync(apiPath), true, 'membership-api media-cleanup.js missing')
    assert.equal(fs.existsSync(adminPath), true, 'membership-admin-api media-cleanup.js missing')
    const apiBytes = fs.readFileSync(apiPath)
    const adminBytes = fs.readFileSync(adminPath)
    assert.equal(
      apiBytes.equals(adminBytes),
      true,
      'media-cleanup.js must be byte-identical across api and admin-api packages',
    )
  })

  it('adapter requires only the package-local vendor path', () => {
    const adapter = fs.readFileSync(adapterPath, 'utf8')
    const requireCalls = adapter.match(/require\(([^)]+)\)/g) || []
    assert.equal(
      requireCalls.some(call => call.includes('./vendor/activity-domain/pure.cjs')),
      true,
    )
    for (const call of requireCalls) {
      assert.equal(call.includes('packages/weapp-core'), false)
      assert.equal(call.includes('@01mvp/weapp-core'), false)
      assert.equal(call.includes('path.join'), false)
      assert.equal(call.includes('../../../../../'), false)
    }
  })

  it('loads pure domain and workflows from package-local vendor', () => {
    const pure = require('../lib/vendor/activity-domain/pure.cjs')
    assert.equal(typeof pure.decideEnrollmentAttempt, 'function')
    assert.equal(typeof pure.decideIdempotency, 'function')
    assert.equal(typeof pure.buildStateChangeAudit, 'function')
    const workflows = require('../lib/workflows')
    assert.equal(typeof workflows.registerForEvent, 'function')
  })

  it('isolated package load smoke rejects monorepo resolution', async () => {
    const helperUrl = pathToFileURL(
      path.join(caseRoot, 'scripts/lib/membership-api-package.mjs'),
    ).href
    const { assertMembershipApiActivityDomainPackage } = await import(helperUrl)
    assert.doesNotThrow(() => {
      assertMembershipApiActivityDomainPackage({
        caseRoot,
        repositoryRoot,
      })
    })
  })
})
