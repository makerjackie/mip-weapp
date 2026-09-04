import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadCaseEnv } from '../scripts/lib/example-cloudbase.mjs'
import {
  compactEnvDocuments,
  MIP_STABLE_SECRET_KEYS,
  writeEnvFileAtomic,
} from '../scripts/lib/mip-local-secrets.mjs'

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('local environment compaction', () => {
  it('moves stable and optional service secrets, keeps unknown and WeChat keys, and drops defaults', () => {
    const result = compactEnvDocuments([
      'MIP_WECHAT_APP_SECRET=wechat-secret',
      'MIP_WECHAT_CODE_UPLOAD_KEY_PATH=/private/key',
      'MIP_IDENTITY_PEPPER=stable-value',
      'MIP_PAYMENT_MODE=disabled',
      'MIP_CATALOG_STAGE=TEST',
      'MIP_DEPLOYMENT_STAGE=development',
      'MIP_UNION_ID_REBIND_ENABLED=false',
      'MIP_ADMIN_WEB_LOGIN_CONFIRM_URL=https://mipmini.01mvp.com/api/internal/auth/challenge/confirm',
      'CUSTOM_OVERRIDE=value',
      'UNKNOWN_EMPTY=',
      'OPENAI_API_KEY=openai-value',
    ].join('\n'))
    expect(result.secrets).toContain('MIP_IDENTITY_PEPPER=stable-value')
    expect(result.secrets).toContain('OPENAI_API_KEY=openai-value')
    expect(result.local).toContain('MIP_WECHAT_APP_SECRET=wechat-secret')
    expect(result.local).toContain('MIP_WECHAT_CODE_UPLOAD_KEY_PATH=/private/key')
    expect(result.local).toContain('CUSTOM_OVERRIDE=value')
    expect(result.local).toContain('MIP_PAYMENT_MODE=disabled')
    expect(result.local).toContain('MIP_CATALOG_STAGE=TEST')
    expect(result.local).toContain('MIP_DEPLOYMENT_STAGE=development')
    expect(result.local).not.toContain('MIP_UNION_ID_REBIND_ENABLED=false')
    expect(result.local).not.toContain('MIP_ADMIN_WEB_LOGIN_CONFIRM_URL=')
    expect(result.local).not.toContain('UNKNOWN_EMPTY=')
  })

  it('fails closed when local secret files disagree', () => {
    expect(() => compactEnvDocuments('MIP_IDENTITY_PEPPER=one', 'MIP_IDENTITY_PEPPER=two')).toThrow(/differs/)
  })

  it('loads secrets, local config, and process overrides without exposing values in conflict errors', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-env-'))
    temporaryRoots.push(root)
    fs.writeFileSync(path.join(root, '.env.secrets.local'), 'MIP_IDENTITY_PEPPER=secret-one\n')
    fs.writeFileSync(path.join(root, '.env.local'), 'CLOUDBASE_ENV_ID=env-one\n')
    expect(loadCaseEnv(root).MIP_IDENTITY_PEPPER).toBe('secret-one')
    expect(loadCaseEnv(root).CLOUDBASE_ENV_ID).toBe('env-one')
    const prior = process.env.CLOUDBASE_ENV_ID
    process.env.CLOUDBASE_ENV_ID = 'env-process'
    try {
      expect(loadCaseEnv(root).CLOUDBASE_ENV_ID).toBe('env-process')
    }
    finally {
      if (prior === undefined) {
        delete process.env.CLOUDBASE_ENV_ID
      }
      else {
        process.env.CLOUDBASE_ENV_ID = prior
      }
    }
    fs.writeFileSync(path.join(root, '.env.local'), 'MIP_IDENTITY_PEPPER=secret-two\n')
    expect(() => loadCaseEnv(root)).toThrow('MIP_IDENTITY_PEPPER differs between .env.secrets.local and .env.local')
  })

  it('writes local environment files atomically with owner-only permissions', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-env-mode-'))
    temporaryRoots.push(root)
    const target = path.join(root, '.env.local')
    writeEnvFileAtomic(target, 'KEY=value\n')
    expect(fs.statSync(target).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(target, 'utf8')).toBe('KEY=value\n')
  })

  it('keeps the full stable key contract out of the committed example', () => {
    const repositoryRoot = path.resolve(import.meta.dirname, '..')
    const example = fs.readFileSync(path.join(repositoryRoot, '.env.example'), 'utf8')
    for (const key of MIP_STABLE_SECRET_KEYS) {
      expect(example).not.toContain(`${key}=`)
    }
    expect(example).toContain('MIP_WECHAT_APP_SECRET=')
    expect(example).toContain('MIP_WECHAT_CODE_UPLOAD_KEY_PATH=')

    const init = fs.readFileSync(path.join(repositoryRoot, 'scripts/init-mip-secrets.mjs'), 'utf8')
    const deploy = fs.readFileSync(path.join(repositoryRoot, 'scripts/deploy-functions.mjs'), 'utf8')
    const projectInit = fs.readFileSync(path.join(repositoryRoot, 'scripts/project-init.mjs'), 'utf8')
    expect(init).toContain('path.join(root, \'.env.secrets.local\')')
    expect(deploy).toContain('path.join(root, \'.env.secrets.local\')')
    expect(projectInit).toContain('compactEnvDocuments(serializeEnv(nextEnv, envTemplate), secretsSource)')
  })
})
