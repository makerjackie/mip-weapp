'use strict'

const crypto = require('node:crypto')

// Tencent Cloud API v3. Never log signing inputs, requests or raw responses.
// https://cloud.tencent.com/document/product/1278/46714
function createCloudApi(credentials, region, fetchImpl = fetch, services = {
  ssl: { version: '2019-12-05', actions: ['DescribeCertificate', 'DescribeCertificateDetail', 'ApplyCertificate', 'CheckCertificateDomainVerification'] },
  tcb: { version: '2018-06-08', actions: ['DescribeHTTPServiceRoute', 'ModifyHTTPServiceRoute'] },
}) {
  if (!credentials?.secretId || !credentials?.secretKey || !credentials?.token) {
    throw new Error('TEMPORARY_CREDENTIALS_REQUIRED')
  }
  return async (service, action, params) => {
    if (!services[service]?.actions.includes(action)) throw new Error('SERVICE_ACTION_NOT_ALLOWED')
    const host = `${service}.tencentcloudapi.com`
    const timestamp = Math.floor(Date.now() / 1000)
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
    const body = JSON.stringify(params)
    const hash = value => crypto.createHash('sha256').update(value).digest('hex')
    const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest()
    const scope = `${date}/${service}/tc3_request`
    const canonical = `POST\n/\n\ncontent-type:application/json\nhost:${host}\n\ncontent-type;host\n${hash(body)}`
    const signingKey = hmac(hmac(hmac(`TC3${credentials.secretKey}`, date), service), 'tc3_request')
    const signature = crypto.createHmac('sha256', signingKey)
      .update(`TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${hash(canonical)}`).digest('hex')
    const response = await fetchImpl(`https://${host}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body,
      headers: {
        'content-type': 'application/json', 'X-TC-Action': action,
        'X-TC-Version': services[service].version,
        'X-TC-Region': region, 'X-TC-Timestamp': String(timestamp),
        'X-TC-Token': credentials.token,
        Authorization: `TC3-HMAC-SHA256 Credential=${credentials.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`,
      },
    })
    const value = (await response.json())?.Response
    if (!response.ok || !value || value.Error) {
      const code = String(value?.Error?.Code || 'INVALID_RESPONSE').replace(/[^A-Za-z0-9_.]/g, '')
      throw new Error(`CLOUD_API_${service.toUpperCase()}_${code}`)
    }
    return value
  }
}

function runtimeCredentials(context = {}, env = process.env) {
  let injected = {}
  try { injected = JSON.parse(context.environment || context.environ || '{}') } catch {}
  for (const candidate of [context.credentials, context.Credentials, context.credential, context, injected, env]) {
    const secretId = candidate?.secretId || candidate?.SecretId || candidate?.TENCENTCLOUD_SECRETID
    const secretKey = candidate?.secretKey || candidate?.SecretKey || candidate?.TENCENTCLOUD_SECRETKEY
    const token = candidate?.token || candidate?.Token || candidate?.TENCENTCLOUD_SESSIONTOKEN
    if (secretId && secretKey && token) return { secretId, secretKey, token }
  }
  throw new Error('TEMPORARY_CREDENTIALS_REQUIRED')
}

module.exports = { createCloudApi, runtimeCredentials }
