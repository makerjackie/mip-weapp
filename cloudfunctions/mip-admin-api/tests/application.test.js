'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const { createAdminApplication } = require('../domain/application')
const { createTrustedPrincipalIssuer } = require('../lib/identity')
const { createServiceDouble } = require('./owner-modules-test-helper')
const { createAdminMediaProjection } = require('../lib/admin-media-projection')

const identityOptions = {
  allowedAppIds: new Set(['wx-trusted']),
  pepper: 'identity-pepper-with-at-least-thirty-two-characters',
}
const trustedContext = { APPID: 'wx-trusted', OPENID: 'openid-trusted' }

describe('admin application seam', () => {
  it('accepts only frozen principals issued by the configured authority', async () => {
    const issuer = createTrustedPrincipalIssuer(identityOptions)
    const otherIssuer = createTrustedPrincipalIssuer(identityOptions)
    const calls = []
    const application = createAdminApplication({
      assertPrincipal: issuer.assert,
      service: createServiceDouble({
        async getSession(principal, input) {
          calls.push({ principal, input })
          return { enabled: true }
        },
      }),
    })
    const principal = issuer.issue(trustedContext)

    assert.equal(Object.isFrozen(principal), true)
    assert.deepEqual(await application.execute(principal, 'mip.admin.session', { source: 'test' }), {
      enabled: true,
    })

    const rejected = [
      { appId: principal.appId, openId: principal.openId, identityKey: principal.identityKey },
      { ...principal },
      Object.freeze({ ...principal }),
      otherIssuer.issue(trustedContext),
    ]
    for (const forged of rejected) {
      await assert.rejects(
        () => application.execute(forged, 'mip.admin.session', {}),
        /AUTH_REQUIRED/,
      )
    }
    assert.equal(calls.length, 1)
  })

  it('keeps route control separate from a business input action', async () => {
    const issuer = createTrustedPrincipalIssuer(identityOptions)
    const principal = issuer.issue(trustedContext)
    let received
    const application = createAdminApplication({
      assertPrincipal: issuer.assert,
      service: createServiceDouble({
        async moderateOpportunityComment(actualPrincipal, input) {
          received = { principal: actualPrincipal, input }
          return { id: input.commentId, status: input.action }
        },
      }),
    })
    const input = {
      opportunityId: 'opportunity-a',
      commentId: 'comment-a',
      expectedVersion: 2,
      action: 'HIDE',
      reason: '内容不符合要求',
    }

    const result = await application.execute(
      principal,
      'mip.admin.opportunityComments.moderate',
      input,
    )

    assert.deepEqual(result, { id: 'comment-a', status: 'HIDE' })
    assert.equal(received.principal, principal)
    assert.equal(received.input, input)
  })

  it('keeps health on probe and rejects it or unknown actions before principal checks', async () => {
    let assertions = 0
    let probes = 0
    const application = createAdminApplication({
      assertPrincipal() {
        assertions += 1
        throw new Error('principal must not be checked')
      },
      service: createServiceDouble({
        async health() {
          probes += 1
          return { persistence: 'cloudbase-mysql' }
        },
      }),
    })

    await assert.rejects(
      () => application.execute({}, 'health', {}),
      error => error.code === 'NOT_FOUND',
    )
    await assert.rejects(
      () => application.execute({}, 'mip.admin.unknown', {}),
      error => error.code === 'NOT_FOUND',
    )
    assert.equal(assertions, 0)
    assert.deepEqual(await application.probe(), { persistence: 'cloudbase-mysql' })
    assert.equal(probes, 1)
  })

  it('signs only authorized private-draft previews and never client-controlled nested URLs', async () => {
    const issuer = createTrustedPrincipalIssuer(identityOptions)
    const principal = issuer.issue(trustedContext)
    const draftData = {
      title: '本人草稿', coverAssetId: 'arbitrary-asset', coverUrl: 'cloud://untrusted-cover',
      contentMedia: [{ assetId: 'another-asset', imageUrl: 'cloud://untrusted-content' }],
      nested: { url: 'cloud://untrusted-url', avatarUrl: 'cloud://untrusted-avatar', imagePreviewUrl: 'cloud://untrusted-preview' },
    }
    const original = JSON.stringify(draftData)
    let row = { draftId: '7', eventId: null, draftData, version: 1,
      mediaPreviews: [{ assetId: 'authorized-asset', imageUrl: 'cloud://authorized-media' }] }
    const signed = []
    const application = createAdminApplication({
      assertPrincipal: issuer.assert,
      service: createServiceDouble({ async getEventDraft() { return row } }),
      projectMedia: createAdminMediaProjection({ async getTempFileURL({ fileList }) {
        signed.push(...fileList)
        return { fileList: fileList.map(fileID => ({ fileID, tempFileURL: 'https://media.example/authorized' })) }
      } }),
    })
    const result = await application.execute(principal, 'mip.admin.events.drafts.get', { draftId: '7' })
    assert.deepEqual(signed, ['cloud://authorized-media'])
    assert.deepEqual(result.mediaPreviews, [{ assetId: 'authorized-asset', imageUrl: 'https://media.example/authorized' }])
    assert.deepEqual(result.draftData, draftData)
    assert.equal(JSON.stringify(draftData), original)
    row = { ...row, mediaPreviews: [] }
    signed.length = 0
    assert.deepEqual((await application.execute(principal, 'mip.admin.events.drafts.get', { draftId: '7' })).draftData, draftData)
    assert.deepEqual(signed, [])
    row = null
    assert.equal(await application.execute(principal, 'mip.admin.events.drafts.get', { draftId: '7' }), null)
    assert.deepEqual(signed, [])
  })
})
