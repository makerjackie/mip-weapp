import { describe, expect, it } from 'vitest'
import {
  MIP_STABLE_SECRET_KEYS,
  resolveMipStableSecrets,
  secretInventory,
  updateEnvDocument,
} from '../scripts/lib/mip-local-secrets.mjs'

const secret = (character: string) => character.repeat(48)

describe('MIP stable local secrets', () => {
  it('prefers matching local values, recovers deployed values, and generates missing values', () => {
    const localEnv = { MIP_IDENTITY_PEPPER: secret('l') }
    const deployedEnvironments = [{
      MIP_IDENTITY_PEPPER: secret('l'),
      MIP_UNION_IDENTITY_PEPPER: secret('u'),
    }]
    const result = resolveMipStableSecrets({
      localEnv,
      deployedEnvironments,
      generate: key => secret(key.at(-1)?.toLowerCase() || 'g'),
    })

    expect(result.values.MIP_IDENTITY_PEPPER).toBe(secret('l'))
    expect(result.values.MIP_UNION_IDENTITY_PEPPER).toBe(secret('u'))
    expect(result.sources.MIP_IDENTITY_PEPPER).toBe('local')
    expect(result.sources.MIP_UNION_IDENTITY_PEPPER).toBe('deployed')
    expect(Object.keys(result.values)).toEqual(MIP_STABLE_SECRET_KEYS)
  })

  it('fails closed on deployed disagreement, local drift, and weak values', () => {
    expect(() => resolveMipStableSecrets({
      deployedEnvironments: [
        { MIP_IDENTITY_PEPPER: secret('a') },
        { MIP_IDENTITY_PEPPER: secret('b') },
      ],
      generate: () => secret('g'),
    })).toThrow(/disagree/)
    expect(() => resolveMipStableSecrets({
      localEnv: { MIP_IDENTITY_PEPPER: secret('a') },
      deployedEnvironments: [{ MIP_IDENTITY_PEPPER: secret('b') }],
      generate: () => secret('g'),
    })).toThrow(/differs/)
    expect(() => resolveMipStableSecrets({ generate: () => 'short' })).toThrow(/at least 32/)
  })

  it('updates existing keys once, appends missing keys, and keeps values out of inventory', () => {
    const values = Object.fromEntries(MIP_STABLE_SECRET_KEYS.map(key => [key, secret('z')]))
    const document = updateEnvDocument('MINI_PROGRAM_NAME=MIP\nMIP_IDENTITY_PEPPER=old-value\n', values)
    expect(document).toContain(`MIP_IDENTITY_PEPPER=${secret('z')}`)
    expect(document.match(/MIP_IDENTITY_PEPPER=/g)).toHaveLength(1)
    expect(document).toContain(`MIP_AI_STORAGE_KEY=${secret('z')}`)

    const inventory = secretInventory(values, Object.fromEntries(MIP_STABLE_SECRET_KEYS.map(key => [key, 'generated'])))
    expect(inventory.MIP_IDENTITY_PEPPER.fingerprint).toHaveLength(16)
    expect(JSON.stringify(inventory)).not.toContain(secret('z'))
  })

  it('rejects duplicate managed entries instead of silently choosing one', () => {
    expect(() => updateEnvDocument(
      'MIP_IDENTITY_PEPPER=one\nMIP_IDENTITY_PEPPER=two\n',
      { MIP_IDENTITY_PEPPER: secret('x') },
    )).toThrow(/Duplicate/)
  })
})
