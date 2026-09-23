'use strict'

const { createHash, createHmac } = require('node:crypto')
const sha256 = value => createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => createHmac('sha256', key).update(value).digest()

// Tencent Cloud SendSms 2021-01-11, TC3-HMAC-SHA256. Endpoint is fixed server-side.
function createTencentSmsProvider(env = process.env, options = {}) {
  const fields = ['MIP_SMS_SECRET_ID', 'MIP_SMS_SECRET_KEY', 'MIP_SMS_SDK_APP_ID', 'MIP_SMS_SIGN_NAME', 'MIP_SMS_TEMPLATE_ID']
  const configured = fields.every(key => typeof env[key] === 'string' && env[key].trim())
  const enabled = env.MIP_SMS_ENABLED === 'true' && configured
  const fetcher = options.fetch || globalThis.fetch
  return {
    available: enabled,
    async send(phone, code) {
      if (!enabled) throw new Error('SMS_DISABLED')
      if (!/^1\d{10}$/.test(phone) || !/^\d{6}$/.test(code)) throw new Error('VALIDATION_FAILED')
      const timestamp = Math.floor((options.now || Date.now)() / 1000)
      const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
      const body = JSON.stringify({
        PhoneNumberSet: [`+86${phone}`], SmsSdkAppId: env.MIP_SMS_SDK_APP_ID,
        SignName: env.MIP_SMS_SIGN_NAME, TemplateId: env.MIP_SMS_TEMPLATE_ID,
        TemplateParamSet: [code, '5'],
      })
      const host = 'sms.tencentcloudapi.com'
      const contentType = 'application/json; charset=utf-8'
      const headers = `content-type:${contentType}\nhost:${host}\n`
      const signedHeaders = 'content-type;host'
      const canonical = ['POST', '/', '', headers, signedHeaders, sha256(body)].join('\n')
      const scope = `${date}/sms/tc3_request`
      const stringToSign = ['TC3-HMAC-SHA256', timestamp, scope, sha256(canonical)].join('\n')
      const key = hmac(hmac(hmac(`TC3${env.MIP_SMS_SECRET_KEY}`, date), 'sms'), 'tc3_request')
      const signature = hmac(key, stringToSign).toString('hex')
      let response
      try {
        response = await fetcher(`https://${host}/`, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': contentType, Host: host,
            Authorization: `TC3-HMAC-SHA256 Credential=${env.MIP_SMS_SECRET_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
            'X-TC-Action': 'SendSms', 'X-TC-Version': '2021-01-11',
            'X-TC-Region': env.MIP_SMS_REGION || 'ap-guangzhou', 'X-TC-Timestamp': String(timestamp),
          },
          body,
        })
        if (!response.ok) throw new Error('SMS_SEND_FAILED')
        const payload = await response.json()
        const statuses = payload?.Response?.SendStatusSet
        if (!Array.isArray(statuses) || statuses.length !== 1 || statuses[0].Code !== 'Ok') {
          throw new Error('SMS_SEND_FAILED')
        }
      }
      catch { throw new Error('SMS_SEND_FAILED') }
      // Provider acceptance is not handset delivery. Never expose its raw response or number.
      return { accepted: true }
    },
  }
}

module.exports = { createTencentSmsProvider }
