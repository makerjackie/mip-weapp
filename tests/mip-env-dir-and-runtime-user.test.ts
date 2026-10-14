import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  loadCaseEnv,
  mysqlDbInstanceArg,
  parseEnv,
  resolveEnvDir,
} from '../scripts/lib/example-cloudbase.mjs'
import { runtimeUserForEnvironment } from '../scripts/lib/mysql-privilege-assert.mjs'

const keptEnvDir = process.env.MIP_ENV_DIR
const tempRoots: string[] = []

function makeTempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mip-env-dir-'))
  tempRoots.push(dir)
  return dir
}

afterAll(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  if (keptEnvDir === undefined) {
    delete process.env.MIP_ENV_DIR
  }
  else {
    process.env.MIP_ENV_DIR = keptEnvDir
  }
})

describe('MIP_ENV_DIR target configuration loading', () => {
  it('falls back to the repo root when MIP_ENV_DIR is unset', () => {
    delete process.env.MIP_ENV_DIR
    const root = makeTempRoot()
    fs.writeFileSync(path.join(root, '.env.local'), 'CLOUDBASE_ENV_ID=base-env\n')
    expect(resolveEnvDir(root)).toBe(root)
    expect(loadCaseEnv(root).CLOUDBASE_ENV_ID).toBe('base-env')
  })

  it('loads both env files from the MIP_ENV_DIR target', () => {
    const root = makeTempRoot()
    const target = path.join(root, 'envs', 'test')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(root, '.env.local'), 'CLOUDBASE_ENV_ID=root-env\nMIP_ENV_DIR=envs/test\n')
    fs.writeFileSync(path.join(target, '.env.local'), 'CLOUDBASE_ENV_ID=target-env\n')
    fs.writeFileSync(path.join(target, '.env.secrets.local'), 'MIP_SEED_SECRET=seed-value\n')
    try {
      const env = loadCaseEnv(root)
      expect(env.CLOUDBASE_ENV_ID).toBe('target-env')
      expect(env.MIP_SEED_SECRET).toBe('seed-value')
      expect(resolveEnvDir(root)).toBe(target)
    }
    finally {
      fs.rmSync(path.join(root, '.env.local'))
    }
  })

  it('prefers process env MIP_ENV_DIR over the root .env.local value', () => {
    const root = makeTempRoot()
    const chosen = path.join(root, 'envs', 'chosen')
    const ignored = path.join(root, 'envs', 'ignored')
    for (const dir of [chosen, ignored]) {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '.env.local'), `CLOUDBASE_ENV_ID=${path.basename(dir)}\n`)
    }
    fs.writeFileSync(path.join(root, '.env.local'), 'MIP_ENV_DIR=envs/ignored\n')
    process.env.MIP_ENV_DIR = 'envs/chosen'
    try {
      expect(loadCaseEnv(root).CLOUDBASE_ENV_ID).toBe('chosen')
    }
    finally {
      if (keptEnvDir === undefined) {
        delete process.env.MIP_ENV_DIR
      }
      else {
        process.env.MIP_ENV_DIR = keptEnvDir
      }
      fs.rmSync(path.join(root, '.env.local'))
    }
  })

  it('rejects an MIP_ENV_DIR target without .env.local', () => {
    const root = makeTempRoot()
    process.env.MIP_ENV_DIR = 'envs/missing'
    try {
      expect(() => loadCaseEnv(root)).toThrow(/MIP_ENV_DIR target has no \.env\.local/)
    }
    finally {
      if (keptEnvDir === undefined) {
        delete process.env.MIP_ENV_DIR
      }
      else {
        process.env.MIP_ENV_DIR = keptEnvDir
      }
    }
  })

  it('still rejects conflicting values across the two env files inside the target', () => {
    const root = makeTempRoot()
    const target = path.join(root, 'envs', 'conflict')
    fs.mkdirSync(target, { recursive: true })
    fs.writeFileSync(path.join(target, '.env.local'), 'MIP_DB_SCHEMA=one\n')
    fs.writeFileSync(path.join(target, '.env.secrets.local'), 'MIP_DB_SCHEMA=two\n')
    process.env.MIP_ENV_DIR = target
    try {
      expect(() => loadCaseEnv(root)).toThrow(/differs between \.env\.secrets\.local and \.env\.local/)
    }
    finally {
      if (keptEnvDir === undefined) {
        delete process.env.MIP_ENV_DIR
      }
      else {
        process.env.MIP_ENV_DIR = keptEnvDir
      }
    }
  })
})

describe('mysqlDbInstanceArg', () => {
  it('omits the argument for the instance default schema', () => {
    expect(mysqlDbInstanceArg('')).toEqual({})
    expect(mysqlDbInstanceArg(undefined)).toEqual({})
  })

  it('routes statements to an explicit schema and rejects unsafe names', () => {
    expect(mysqlDbInstanceArg('mip_test')).toEqual({ dbInstance: { schema: 'mip_test' } })
    expect(() => mysqlDbInstanceArg('mip-test; DROP TABLE x')).toThrow(/plain identifier/)
  })
})

describe('runtimeUserForEnvironment schema salting', () => {
  const envId = 'env-identifier-1'

  it('keeps the historical envId-only fingerprint for the default schema', () => {
    const legacy = `mip_${createHash('sha256').update(envId).digest('hex').slice(0, 12)}`
    expect(runtimeUserForEnvironment(envId)).toBe(legacy)
    expect(runtimeUserForEnvironment(envId, '')).toBe(legacy)
    expect(runtimeUserForEnvironment(envId, undefined)).toBe(legacy)
  })

  it('derives a distinct account per non-default schema on the same environment', () => {
    const bySchema = new Set(['mip_test', 'mip_prod_copy'].map(schema => runtimeUserForEnvironment(envId, schema)))
    expect(bySchema.size).toBe(2)
    expect(bySchema.has(runtimeUserForEnvironment(envId))).toBe(false)
    for (const user of bySchema) {
      expect(user).toMatch(/^mip_[a-f0-9]{12}$/)
    }
    expect(runtimeUserForEnvironment(envId, 'mip_test')).toBe(runtimeUserForEnvironment(envId, 'mip_test'))
  })

  it('rejects malformed environment or schema identifiers', () => {
    expect(() => runtimeUserForEnvironment('bad env')).toThrow()
    expect(() => runtimeUserForEnvironment(envId, 'bad schema')).toThrow()
  })
})

describe('parseEnv smoke', () => {
  it('parses simple assignments and ignores comments', () => {
    const root = makeTempRoot()
    const file = path.join(root, '.env.local')
    fs.writeFileSync(file, '# comment\nKEY=value\nQUOTED="quoted value"\n')
    const parsed = parseEnv(file)
    expect(parsed.KEY).toBe('value')
    expect(parsed.QUOTED).toBe('quoted value')
    expect(parsed.COMMENT).toBeUndefined()
  })
})
