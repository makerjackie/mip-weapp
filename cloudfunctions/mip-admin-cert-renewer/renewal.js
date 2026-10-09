'use strict'

const { createHmac, timingSafeEqual, X509Certificate } = require('node:crypto')

const DAY = 86400000
const CHALLENGE_PREFIX = '/.well-known/pki-validation/'

function readConfig(env = process.env) {
  const config = {
    domain: env.MIP_ADMIN_CERT_DOMAIN,
    envId: env.MIP_ADMIN_CERT_ENV_ID,
    region: env.MIP_ADMIN_CERT_REGION,
    stateBucket: env.MIP_ADMIN_CERT_STATE_BUCKET,
    hostingBucket: env.MIP_ADMIN_CERT_HOSTING_BUCKET,
    secret: env.MIP_ADMIN_CERT_TRIGGER_SECRET,
    generation: env.MIP_ADMIN_CERT_GENERATION,
    staticPrefix: 'mip-admin-console',
    functionName: 'mip-admin-cert-renewer',
    triggerName: 'mip-admin-cert-daily',
    renewBeforeDays: 30,
  }
  if (!/^admin\.[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(config.domain || '')
    || !/^[a-z][a-z0-9-]{3,63}$/.test(config.envId || '')
    || !/^ap-[a-z]+$/.test(config.region || '')
    || !/^[a-z0-9-]{3,64}-\d{5,20}$/.test(config.stateBucket || '')
    || !/^[a-z0-9-]{3,64}-\d{5,20}$/.test(config.hostingBucket || '')
    || typeof config.secret !== 'string' || config.secret.length < 32
    || !/^[a-f0-9]{32}$/.test(config.generation || '')
    || config.stateBucket === config.hostingBucket) throw new Error('CERT_CONFIG_INVALID')
  return Object.freeze(config)
}

function signRequest(config, { mode = 'CHECK', timestamp = 0 } = {}) {
  const payload = { version: 1, domain: config.domain, envId: config.envId, generation: config.generation, mode, timestamp }
  return { ...payload, signature: createHmac('sha256', config.secret).update(JSON.stringify(payload)).digest('hex') }
}

function verifyRequest(event, config, now = Date.now()) {
  const timer = event.Type === 'Timer' && event.TriggerName === config.triggerName
  let request = event
  if (timer) {
    try { request = JSON.parse(event.Message) } catch { throw new Error('FORBIDDEN') }
  }
  if (!['CHECK', 'FORCE', 'CANARY'].includes(request?.mode)
    || request.version !== 1 || request.domain !== config.domain || request.envId !== config.envId
    || request.generation !== config.generation
    || (timer && request.mode !== 'CHECK' && request.mode !== 'CANARY')
    || (!timer && (!Number.isSafeInteger(request.timestamp) || Math.abs(now - request.timestamp) > 300000))) {
    throw new Error('FORBIDDEN')
  }
  const expected = signRequest(config, request).signature
  if (!/^[a-f0-9]{64}$/.test(request.signature || '')
    || !timingSafeEqual(Buffer.from(request.signature), Buffer.from(expected))) throw new Error('FORBIDDEN')
  return request.mode
}

function domainConfig(value, config) {
  const domains = value?.Domains
  if (!Array.isArray(domains)) throw new Error('DOMAIN_READBACK_INVALID')
  const matches = domains.filter(item => item.Domain === config.domain)
  if (matches.length !== 1) throw new Error('DOMAIN_READBACK_INVALID')
  const domain = matches[0]
  if (domain.IsDefault || domain.AccessType !== 'DIRECT' || domain.Protocol !== 'HTTP_TO_HTTPS'
    || !domain.Enable || domain.Status !== 'SUCCESS' || !domain.CertId || domain.Routes?.length !== 3) {
    throw new Error('DOMAIN_BOUNDARY_INVALID')
  }
  const routes = new Map(domain.Routes.map(route => [route.Path, route]))
  const root = routes.get('/')
  if (routes.size !== 3 || root?.UpstreamResourceType !== 'STATIC_STORE' || root?.UpstreamResourceName !== 'staticstore'
    || root?.PathRewrite?.StaticStorePrefix !== `/${config.staticPrefix}`
    || ['/api', '/assets'].some(path => routes.get(path)?.UpstreamResourceType !== 'SCF'
      || routes.get(path)?.UpstreamResourceName !== 'mip-admin-web-api' || !routes.get(path)?.EnablePathTransmission)
    || [...routes.values()].some(route => !route.Enable || !route.EnableSafeDomain || route.EnableAuth)) {
    throw new Error('DOMAIN_ROUTES_INVALID')
  }
  return domain
}

function replacementConfig(domain, certId) {
  return { Domain: domain.Domain, CertId: certId }
}

function unchangedDomain(before, after) {
  const copy = (value, root = true) => {
    if (Array.isArray(value)) return value.map(item => copy(item, false)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    if (!value || typeof value !== 'object') return value
    const result = {}
    for (const key of Object.keys(value).sort()) {
      if (key === 'UpdateTime' || (root && ['CertId', 'CertStatus', 'CertExpireTime', 'CertName'].includes(key))) continue
      result[key] = copy(value[key], false)
    }
    return result
  }
  return JSON.stringify(copy(before)) === JSON.stringify(copy(after))
}

function certificateInfo(value, config) {
  if (value.Domain !== config.domain) throw new Error('CERT_DOMAIN_INVALID')
  const expiresAt = Date.parse(`${String(value.CertEndTime).replace(' ', 'T')}+08:00`)
  if (Number(value.Status) === 1 && !Number.isFinite(expiresAt)) throw new Error('CERT_EXPIRY_INVALID')
  return { expiresAt, status: Number(value.Status) }
}

function fileChallenge(value, config) {
  if (value.VerifyType !== 'FILE') throw new Error('CERT_CHALLENGE_INVALID')
  const details = value.DvAuthDetail?.DvAuths?.length ? value.DvAuthDetail.DvAuths : [value.DvAuthDetail]
  if (details.length !== 1) throw new Error('CERT_CHALLENGE_INVALID')
  const detail = details[0]
  let path = detail?.DvAuthPath
  if (path === CHALLENGE_PREFIX || path === CHALLENGE_PREFIX.slice(0, -1)) {
    path = `${CHALLENGE_PREFIX}${detail.DvAuthKey}`
  }
  // Live SSL DTO uses DvAuthDomain for the registered base domain and Domain
  // for the full host. Older/top-level DTOs only expose DvAuthDomain.
  if ((detail?.Domain || detail?.DvAuthDomain) !== config.domain
    || !path?.startsWith(CHALLENGE_PREFIX)
    || !/^[A-Za-z0-9_-]+\.txt$/.test(path.slice(CHALLENGE_PREFIX.length))
    || typeof detail?.DvAuthValue !== 'string' || !detail.DvAuthValue || detail.DvAuthValue.length > 4096) {
    throw new Error('CERT_CHALLENGE_INVALID')
  }
  return { path, key: `${config.staticPrefix}${path}`, content: detail.DvAuthValue }
}

function publicCertificate(value, config, now = Date.now()) {
  if (typeof value.CertificatePublicKey !== 'string' || !value.CertificatePublicKey.includes('-----BEGIN CERTIFICATE-----')) throw new Error('SIGNED_CERT_INVALID')
  const cert = new X509Certificate(value.CertificatePublicKey)
  if (cert.checkHost(config.domain, { wildcards: false }) !== config.domain
    || cert.ca || cert.subjectAltName !== `DNS:${config.domain}`
    || Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now + 60 * DAY) throw new Error('SIGNED_CERT_INVALID')
  return { fingerprint256: cert.fingerprint256, validTo: cert.validTo }
}

async function renewCertificate({ config, cloud, store, readTls, readChallenge, now = Date.now(), mode = 'CHECK' }) {
  const getDomains = async () => cloud('tcb', 'DescribeHTTPServiceRoute', { EnvId: config.envId })
  const before = await getDomains()
  const domain = domainConfig(before, config)
  const current = certificateInfo(await cloud('ssl', 'DescribeCertificate', { CertificateId: domain.CertId }), config)
  if (current.status !== 1) throw new Error('CURRENT_CERT_NOT_SIGNED')
  const remainingDays = Math.ceil((current.expiresAt - now) / DAY)
  const state = await store.readState() || { version: 1, domain: config.domain }
  if (state.version !== 1 || state.domain !== config.domain) throw new Error('CERT_STATE_INVALID')
  if (mode === 'CANARY') {
    await store.verifyApplicationGuard()
    state.lastCanary = { generation: config.generation, checkedAt: new Date(now).toISOString(), guard: 'COS_CREATE_ONLY' }
    await store.writeState(state)
    return { status: 'CANARY_VERIFIED', remainingDays }
  }
  // An ambiguous application must be reconciled manually; never consume the
  // free certificate quota again after a timeout or lost application response.
  if (state.applying) throw new Error('CERT_APPLICATION_NEEDS_RECONCILIATION')
  if (state.pending && ![state.pending.oldCertId, state.pending.certId].includes(domain.CertId)) {
    throw new Error('CERT_BINDING_CHANGED_EXTERNALLY')
  }
  if (!state.pending && mode !== 'FORCE' && remainingDays > config.renewBeforeDays) {
    state.lastCheck = { checkedAt: new Date(now).toISOString(), remainingDays, status: 'NOT_DUE' }
    await store.writeState(state)
    return { status: 'NOT_DUE', remainingDays }
  }
  if (!state.pending) {
    state.applying = { oldCertId: domain.CertId, startedAt: new Date(now).toISOString() }
    // COS create-only is atomic across SCF instances. Keep the receipt forever;
    // an ambiguous result must never retry issuance for the same old certificate.
    await store.claimApplication(state.applying)
    await store.writeState(state)
    const issued = await cloud('ssl', 'ApplyCertificate', {
      DomainName: config.domain, DvAuthMethod: 'FILE', PackageType: '83', ProjectId: 0,
      Alias: `mip-admin-renewal-${config.domain}`,
      ...(remainingDays >= 0 && remainingDays <= 30 ? { OldCertificateId: domain.CertId } : {}),
    })
    if (!/^[A-Za-z0-9]{6,32}$/.test(issued.CertificateId || '')) throw new Error('CERT_APPLICATION_INVALID')
    state.pending = { certId: issued.CertificateId, oldCertId: domain.CertId, createdAt: new Date(now).toISOString() }
    delete state.applying
    await store.writeState(state)
  }
  const pending = await cloud('ssl', 'DescribeCertificate', { CertificateId: state.pending.certId })
  const info = certificateInfo(pending, config)
  if (info.status !== 1) {
    if (info.status !== 0) throw new Error('CERT_APPLICATION_FAILED')
    const challenge = fileChallenge(pending, config)
    await store.publishChallenge(challenge)
    if (await readChallenge(challenge.path) !== challenge.content) throw new Error('CERT_CHALLENGE_NOT_PUBLIC')
    await cloud('ssl', 'CheckCertificateDomainVerification', { CertificateId: state.pending.certId })
    state.lastCheck = { checkedAt: new Date(now).toISOString(), remainingDays, status: 'WAITING_FOR_CA' }
    await store.writeState(state)
    return { status: 'WAITING_FOR_CA', remainingDays }
  }
  if (info.expiresAt < current.expiresAt) throw new Error('CERT_REPLACEMENT_SHORTER')
  // DescribeCertificate omits PEM fields. Fetch details only for a signed
  // replacement; use the public leaf and never persist/log the private key.
  const signed = await cloud('ssl', 'DescribeCertificateDetail', { CertificateId: state.pending.certId })
  if (certificateInfo(signed, config).status !== 1) throw new Error('SIGNED_CERT_INVALID')
  const expected = publicCertificate(signed, config, now)
  if (domain.CertId !== state.pending.certId) {
    await cloud('tcb', 'ModifyHTTPServiceRoute', {
      EnvId: config.envId, Domain: replacementConfig(domain, state.pending.certId),
    })
  }
  const after = await getDomains()
  const readback = domainConfig(after, config)
  if (readback.CertId !== state.pending.certId || !unchangedDomain(domain, readback)) throw new Error('CERT_BINDING_READBACK_FAILED')
  const others = value => JSON.stringify(value.Domains.filter(item => item.Domain !== config.domain).sort((a, b) => a.Domain.localeCompare(b.Domain)))
  if (others(before) !== others(after)) throw new Error('OTHER_DOMAIN_CHANGED')
  const actual = await readTls()
  if (!actual.authorized || actual.fingerprint256 !== expected.fingerprint256) throw new Error('CERT_TLS_NOT_PROPAGATED')
  state.lastSuccess = { certificateId: state.pending.certId, verifiedAt: new Date(now).toISOString(), ...expected }
  delete state.pending
  state.lastCheck = { checkedAt: new Date(now).toISOString(), status: 'RENEWED' }
  await store.writeState(state)
  return { status: 'RENEWED', ...expected }
}

module.exports = { readConfig, signRequest, verifyRequest, domainConfig, replacementConfig, unchangedDomain, certificateInfo, fileChallenge, publicCertificate, renewCertificate }
