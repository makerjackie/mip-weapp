import { describe, expect, it } from 'vitest'
import { detectEmbeddedCredentials } from '../scripts/lib/security-patterns.mjs'

describe('embedded credential detection', () => {
  it('allows variable references, field names, paths and explicit placeholders', () => {
    for (const source of [
      'const appSecret = process.env.MIP_WECHAT_APP_SECRET',
      'access_token: token',
      'const privateKeyPath = "cert/merchant.pem"',
      'APP_SECRET="your_app_secret_here"',
      'API_V3_KEY=""',
      'APP_SECRET=\nANOTHER_ENV_VARIABLE=',
    ]) {
      expect(detectEmbeddedCredentials(source)).toEqual([])
    }
  })

  it('detects credential values without returning their contents', () => {
    const value = '0123456789abcdef'.repeat(2)
    for (const key of ['APP_SECRET', 'appsecret', 'API_V3_KEY', 'MIP_WECHAT_APP_SECRET', 'access_token']) {
      expect(detectEmbeddedCredentials(`${key}="${value}"`)).toEqual(['credential-literal'])
      expect(detectEmbeddedCredentials(`${key}=${value}`)).toEqual(['credential-literal'])
    }
    expect(detectEmbeddedCredentials(`-----BEGIN ${'RSA PRIVATE KEY'}-----`)).toEqual(['private-key-block'])
  })
})
