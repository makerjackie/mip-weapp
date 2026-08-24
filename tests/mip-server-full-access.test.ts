import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function agreementVersions(value: Array<{ key: string, version: string }>) {
  return value.map(({ key, version }) => ({ key, version }))
}

describe('server full access contract', () => {
  it('uses the identity domain current agreement defaults in commerce and admin', () => {
    const admin = require('../cloudfunctions/mip-admin-api/domain/full-access.js')
    const commerce = require('../cloudfunctions/mip-commerce-api/domain/full-access.js')
    const identity = require('../cloudfunctions/mip-identity-api/domain/service.js')

    expect(agreementVersions(commerce.defaultAgreements))
      .toEqual(agreementVersions(identity.defaultAgreements))
    expect(agreementVersions(admin.defaultAgreements))
      .toEqual(agreementVersions(identity.defaultAgreements))
  })

  it('deploys one optional current-agreement configuration to every full-access service', () => {
    const source = read('scripts/deploy-functions.mjs')
    expect(source).toContain('const agreementEnvironment = options.agreementsJson')
    expect(source).toMatch(/opportunities:\s*\{\s*\.\.\.agreementEnvironment/)
    expect(source.match(/\.\.\.agreementEnvironment/g)).toHaveLength(4)
    expect(source).toContain('if (parsed.length === 0)')
  })

  it('gates only new membership checkout after idempotent recovery and before plan use', () => {
    const source = read('cloudfunctions/mip-commerce-api/domain/repository.js')
    const createCheckout = source.slice(
      source.indexOf('async function createCheckout'),
      source.indexOf('async function getOrder'),
    )
    expect(createCheckout.indexOf('if (existing)')).toBeGreaterThan(0)
    expect(createCheckout.indexOf('assertFullAccessUser')).toBeGreaterThan(
      createCheckout.indexOf('if (existing)'),
    )
    expect(createCheckout.indexOf('assertFullAccessUser')).toBeLessThan(
      createCheckout.indexOf('FROM mip_membership_plans'),
    )
  })

  it('checks admin identity completion before role bindings', () => {
    const source = read('cloudfunctions/mip-admin-api/domain/service.js')
    const session = source.slice(
      source.indexOf('async function session'),
      source.indexOf('function audit'),
    )
    expect(session.indexOf('assertFullAccessUser')).toBeGreaterThan(0)
    expect(session.indexOf('assertFullAccessUser')).toBeLessThan(
      session.indexOf('listRoleBindings'),
    )
  })
})
