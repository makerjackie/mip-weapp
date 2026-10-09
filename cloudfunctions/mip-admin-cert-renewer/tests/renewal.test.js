'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { X509Certificate } = require('node:crypto')
const test = require('node:test')
const { readConfig, signRequest, verifyRequest, domainConfig, certificateInfo, fileChallenge, unchangedDomain, renewCertificate } = require('../renewal')
const { runtimeCredentials, createCloudApi } = require('../cloud-api')
const pem = fs.readFileSync(path.join(__dirname, 'public-certificate.crt'), 'utf8')
const certificate = new X509Certificate(pem)
const now = Date.parse(certificate.validFrom) + 86400000
const endTime = time => new Date(time + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
const config = readConfig({
  MIP_ADMIN_CERT_DOMAIN: 'admin.example.test', MIP_ADMIN_CERT_ENV_ID: 'cloud1-example', MIP_ADMIN_CERT_REGION: 'ap-shanghai',
  MIP_ADMIN_CERT_STATE_BUCKET: 'private-1234567890', MIP_ADMIN_CERT_HOSTING_BUCKET: 'static-1234567890',
  MIP_ADMIN_CERT_TRIGGER_SECRET: 'a'.repeat(64), MIP_ADMIN_CERT_GENERATION: 'b'.repeat(32),
})
function fixture({ due = true, signed = false, state = null, applyError = false, tlsValid = true } = {}) {
  let stored = state && structuredClone(state)
  const writes = [], calls = []
  const domain = {
    Domain: config.domain, IsDefault: false, AccessType: 'DIRECT', Protocol: 'HTTP_TO_HTTPS', Enable: true, Status: 'SUCCESS', CertId: 'oldCert01',
    Routes: ['/', '/api', '/assets'].map(Path => ({ Path, UpstreamResourceType: Path === '/' ? 'STATIC_STORE' : 'SCF',
      UpstreamResourceName: Path === '/' ? 'staticstore' : 'mip-admin-web-api', PathRewrite: Path === '/' ? { StaticStorePrefix: '/mip-admin-console' } : {},
      EnableSafeDomain: true, EnableAuth: false, EnablePathTransmission: Path !== '/', Enable: true })),
  }
  const pending = {
    Domain: config.domain, Status: signed ? 1 : 0, CertEndTime: signed ? endTime(Date.parse(certificate.validTo)) : null,
    CertificatePublicKey: signed ? pem : null, VerifyType: 'FILE',
    DvAuthDetail: { DvAuths: [{ Domain: config.domain, DvAuthDomain: 'example.test', DvAuthPath: '/.well-known/pki-validation/', DvAuthKey: 'fileauth.txt', DvAuthValue: 'public-ca-token' }] },
  }
  const cloud = async (service, action, params) => {
    calls.push({ service, action, params })
    if (action === 'DescribeHTTPServiceRoute') return structuredClone({ Domains: [domain, { Domain: 'existing.example.test', CertId: 'unrelated' }] })
    if (action === 'DescribeCertificate') {
      const { CertificatePublicKey, ...summary } = pending
      return params.CertificateId === 'oldCert01'
        ? { Domain: config.domain, Status: 1, CertEndTime: endTime(now + (due ? 20 : 80) * 86400000) } : summary
    }
    if (action === 'DescribeCertificateDetail') return pending
    if (action === 'ApplyCertificate') { if (applyError) throw new Error('CLOUD_API_TIMEOUT'); return { CertificateId: 'newCert01' } }
    if (action === 'CheckCertificateDomainVerification') return { Issued: false }
    if (action === 'ModifyHTTPServiceRoute') { assert.deepEqual(params.Domain, { Domain: config.domain, CertId: 'newCert01' }); domain.CertId = params.Domain.CertId; return {} }
    throw new Error('Unexpected action')
  }
  const claimed = new Set()
  const store = {
    verifyApplicationGuard: async () => {},
    claimApplication: async value => { if (claimed.has(value.oldCertId)) throw new Error('CERT_APPLICATION_NEEDS_RECONCILIATION'); claimed.add(value.oldCertId) },
    readState: async () => stored && structuredClone(stored),
    writeState: async value => { stored = structuredClone(value); writes.push(structuredClone(value)) },
    publishChallenge: async value => { assert.equal(value.key, 'mip-admin-console/.well-known/pki-validation/fileauth.txt') },
  }
  return { config, cloud, store, now, readChallenge: async () => 'public-ca-token', readTls: async () => ({ authorized: tlsValid, fingerprint256: certificate.fingerprint256 }), calls, writes, pending, domain, getState: () => stored }
}
test('manual and timer calls require scoped HMAC; tamper, stale and force timers fail', () => {
  assert.equal(verifyRequest(signRequest(config, { timestamp: now }), config, now), 'CHECK')
  const event = { Type: 'Timer', TriggerName: config.triggerName, Message: JSON.stringify(signRequest(config)) }
  assert.equal(verifyRequest(event, config, now), 'CHECK')
  for (const value of [{ ...signRequest(config, { timestamp: now }), domain: 'admin.other.test' }, signRequest(config, { timestamp: now - 300001 }),
    { ...event, Message: JSON.stringify(signRequest(config, { mode: 'FORCE' })) }, { ...event, TriggerName: 'another-trigger' }]) {
    assert.throws(() => verifyRequest(value, config, now), /FORBIDDEN/)
  }
})
test('live route DTO is checked; route and protocol changes are refused', () => {
  const f = fixture()
  assert.equal(domainConfig({ Domains: [f.domain] }, config).Domain, config.domain)
  f.domain.Routes[1].UpstreamResourceName = 'other-api'
  assert.throws(() => domainConfig({ Domains: [f.domain] }, config), /DOMAIN_ROUTES_INVALID/)
  f.domain.Protocol = 'HTTP'
  assert.throws(() => domainConfig({ Domains: [f.domain] }, config), /DOMAIN_BOUNDARY_INVALID/)
})
test('pending certificate accepts null expiry and nested FILE challenge; path traversal and other domains fail', () => {
  const f = fixture()
  assert.equal(certificateInfo(f.pending, config).status, 0)
  assert.equal(fileChallenge(f.pending, config).path, '/.well-known/pki-validation/fileauth.txt')
  for (const invalid of ['../../index.html', '../fileauth.txt', 'fileauth.txt?x']) {
    f.pending.DvAuthDetail.DvAuths[0].DvAuthKey = invalid
    assert.throws(() => fileChallenge(f.pending, config), /CERT_CHALLENGE_INVALID/)
  }
  f.pending.DvAuthDetail.DvAuths[0].DvAuthKey = 'fileauth.txt'
  f.pending.DvAuthDetail.DvAuths[0].Domain = 'admin.other.test'
  assert.throws(() => fileChallenge(f.pending, config), /CERT_CHALLENGE_INVALID/)
  assert.throws(() => certificateInfo({ Domain: 'admin.other.test', Status: 1 }, config), /CERT_DOMAIN_INVALID/)
})
test('not due and canary never issue or modify gateway', async () => {
  for (const mode of ['CHECK', 'CANARY']) {
    const f = fixture({ due: false })
    assert.equal((await renewCertificate({ ...f, mode })).status, mode === 'CHECK' ? 'NOT_DUE' : 'CANARY_VERIFIED')
    assert.equal(f.calls.length, 2)
    assert.equal(f.writes.length, 1)
  }
})
test('renewal starts within exactly thirty days, not a day early', async () => {
  const f = fixture()
  const cloud = async (service, action, params) => action === 'DescribeCertificate'
    ? { Domain: config.domain, Status: 1, CertEndTime: endTime(now + 30 * 86400000 + 1000) }
    : f.cloud(service, action, params)
  const result = await renewCertificate({ ...f, cloud })
  assert.equal(result.status, 'NOT_DUE')
  assert.equal(result.remainingDays, 31)
})
test('CA pending application is persisted and retried without duplicate issuance', async () => {
  const f = fixture()
  assert.equal((await renewCertificate(f)).status, 'WAITING_FOR_CA')
  assert.equal((await renewCertificate(f)).status, 'WAITING_FOR_CA')
  assert.equal(f.calls.filter(x => x.action === 'ApplyCertificate').length, 1)
  const applied = f.calls.find(x => x.action === 'ApplyCertificate').params
  assert.equal(applied.PackageType, '83'); assert.equal(applied.DvAuthMethod, 'FILE'); assert.equal(applied.OldCertificateId, 'oldCert01')
  assert.equal(f.calls.filter(x => x.action === 'ModifyHTTPServiceRoute').length, 0)
})
test('ambiguous application is held for reconciliation; no second application after restart', async () => {
  const f = fixture({ applyError: true })
  await assert.rejects(renewCertificate(f), /CLOUD_API_TIMEOUT/)
  await assert.rejects(renewCertificate(f), /NEEDS_RECONCILIATION/)
  assert.equal(f.calls.filter(x => x.action === 'ApplyCertificate').length, 1)
})
test('concurrent real applications for the same old certificate issue only once', async () => {
  const f = fixture()
  const results = await Promise.allSettled([renewCertificate(f), renewCertificate(f)])
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1)
  assert.equal(f.calls.filter(value => value.action === 'ApplyCertificate').length, 1)
  assert.match(results.find(value => value.status === 'rejected').reason.message, /RECONCILIATION/)
})
test('cancelled certificate and unpublished verification file never replace TLS', async () => {
  const f = fixture()
  f.pending.Status = 7
  await assert.rejects(renewCertificate(f), /CERT_APPLICATION_FAILED/)
  f.pending.Status = 0
  await assert.rejects(renewCertificate({ ...f, readChallenge: async () => '<html>SPA fallback</html>' }), /NOT_PUBLIC/)
  assert.equal(f.calls.filter(x => x.action === 'ModifyHTTPServiceRoute').length, 0)
})
test('signed certificate is deployed with exact delta; success requires actual TLS', async () => {
  const f = fixture({ signed: true, tlsValid: false })
  await assert.rejects(renewCertificate(f), /TLS_NOT_PROPAGATED/)
  assert.ok(f.getState().pending)
  const result = await renewCertificate({ ...f, readTls: async () => ({ authorized: true, fingerprint256: certificate.fingerprint256 }) })
  assert.equal(result.status, 'RENEWED')
  assert.equal(f.getState().pending, undefined)
  assert.equal(f.calls.filter(x => x.action === 'ModifyHTTPServiceRoute').length, 1)
  assert.ok(f.calls.some(x => x.action === 'DescribeCertificateDetail'))
})
test('signed summary without PEM requires certificate details and refuses a missing public leaf', async () => {
  const f = fixture({ signed: true })
  delete f.pending.CertificatePublicKey
  await assert.rejects(renewCertificate(f), /SIGNED_CERT_INVALID/)
  assert.ok(f.calls.some(x => x.action === 'DescribeCertificateDetail'))
  assert.equal(f.calls.filter(x => x.action === 'ModifyHTTPServiceRoute').length, 0)
})
test('domain semantic comparison allows timestamps/order but rejects routing/auth changes', () => {
  const f = fixture()
  const after = { ...structuredClone(f.domain), UpdateTime: 'later', CertId: 'newCert01' }
  after.Routes.reverse()
  assert.equal(unchangedDomain(f.domain, after), true)
  after.Routes[0].EnableAuth = true
  assert.equal(unchangedDomain(f.domain, after), false)
})
test('fresh invocation credentials win over stale environment; no long-lived keys or disallowed APIs', async () => {
  const fresh = { secretId: 'fresh', secretKey: 'key', token: 'session' }
  assert.deepEqual(runtimeCredentials({ credentials: fresh }, { TENCENTCLOUD_SECRETID: 'stale', TENCENTCLOUD_SECRETKEY: 'key', TENCENTCLOUD_SESSIONTOKEN: 'old' }), fresh)
  assert.throws(() => createCloudApi({ secretId: 'id', secretKey: 'key' }), /TEMPORARY/)
  const api = createCloudApi(fresh, 'ap-shanghai', () => { throw new Error('NETWORK_MUST_NOT_RUN') })
  await assert.rejects(api('ssl', 'DeleteCertificate', {}), /NOT_ALLOWED/)
  await assert.rejects(api('cam', 'CreateRole', {}), /NOT_ALLOWED/)
})
