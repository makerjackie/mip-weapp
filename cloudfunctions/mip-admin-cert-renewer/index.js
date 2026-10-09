'use strict'

const tls = require('node:tls')
const { createCloudApi, runtimeCredentials } = require('./cloud-api')
const { readConfig, verifyRequest, renewCertificate } = require('./renewal')

exports.main = async (event = {}, context = {}) => {
  const config = readConfig()
  const mode = verifyRequest(event, config)
  const credentials = runtimeCredentials(context)
  const COS = require('cos-nodejs-sdk-v5')
  const cos = new COS({ SecretId: credentials.secretId, SecretKey: credentials.secretKey, SecurityToken: credentials.token, Timeout: 20000 })
  const request = (action, params) => new Promise((resolve, reject) => cos[action](params, (error, data) => error ? reject(new Error(`COS_${error.code || error.statusCode || 'FAILED'}`)) : resolve(data)))
  const stateKey = `mip/operations/admin-cert-renewal/${config.domain}/state.json`
  const stateTarget = { Bucket: config.stateBucket, Region: config.region, Key: stateKey }
  const claim = async (name, value) => {
    const versioning = await request('getBucketVersioning', { Bucket: config.stateBucket, Region: config.region })
    if (versioning.VersioningConfiguration?.Status === 'Enabled') throw new Error('CERT_STATE_VERSIONING_ENABLED')
    await request('putObject', { ...stateTarget, Key: `mip/operations/admin-cert-renewal/${config.domain}/applications/${name}.json`,
      Body: JSON.stringify(value), ContentType: 'application/json', Headers: { 'x-cos-forbid-overwrite': 'true' } })
  }
  const store = {
    async claimApplication(value) {
      if (!/^[A-Za-z0-9]{6,32}$/.test(value.oldCertId)) throw new Error('CERT_APPLICATION_INVALID')
      try { await claim(value.oldCertId, value) }
      catch (error) { if (error.message === 'COS_FileAlreadyExists') throw new Error('CERT_APPLICATION_NEEDS_RECONCILIATION'); throw error }
    },
    async verifyApplicationGuard() {
      const name = `probe-${config.generation}`
      try { await claim(name, { generation: config.generation }) }
      catch (error) { if (error.message !== 'COS_FileAlreadyExists') throw error }
      try { await claim(name, { generation: config.generation }); throw new Error('CERT_APPLICATION_GUARD_INVALID') }
      catch (error) { if (error.message !== 'COS_FileAlreadyExists') throw error }
    },
    async readState() {
      try { return JSON.parse(String((await request('getObject', stateTarget)).Body)) }
      catch (error) { if (error.message === 'COS_NoSuchKey' || error.message === 'COS_404') return null; throw error }
    },
    async writeState(value) {
      await request('putObject', { ...stateTarget, Body: JSON.stringify(value), ContentType: 'application/json', CacheControl: 'no-store' })
    },
    async publishChallenge(value) {
      await request('putObject', { Bucket: config.hostingBucket, Region: config.region, Key: value.key, Body: value.content, ContentType: 'text/plain', CacheControl: 'no-store' })
    },
  }
  try {
    const data = await renewCertificate({
      config, mode, cloud: createCloudApi(credentials, config.region), store,
      readChallenge: async path => {
        const response = await fetch(`https://${config.domain}${path}`, { redirect: 'error', signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('CHALLENGE_HTTP_FAILED')
        return response.text()
      },
      readTls: () => new Promise((resolve, reject) => {
        const socket = tls.connect({ host: config.domain, servername: config.domain, port: 443, rejectUnauthorized: true }, () => {
          resolve({ authorized: socket.authorized, fingerprint256: socket.getPeerCertificate().fingerprint256 })
          socket.end()
        })
        socket.setTimeout(15000, () => socket.destroy(new Error('TLS_TIMEOUT')))
        socket.once('error', reject)
      }),
    })
    console.log(JSON.stringify({ service: config.functionName, ...data }))
    return { ok: true, data }
  }
  catch (error) {
    const code = /^[A-Za-z0-9_.]{1,100}$/.test(error.message) ? error.message : 'CERT_RENEWAL_FAILED'
    console.warn(JSON.stringify({ service: config.functionName, status: 'FAILED', code }))
    throw new Error(code)
  }
}
