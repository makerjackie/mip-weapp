import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyCloudbaseManagementEnv,
  CLOUDBASE_LOCAL_CREDENTIAL_STATES,
  hasExplicitDeviceAuthApproval,
  inspectLocalCloudbaseCredential,
  loadCloudbaseManagementEnv,
  requireCloudbaseManagementEnv,
} from '../scripts/lib/cloudbase-local-auth.mjs'

function writeAuth(home: string, credential: Record<string, unknown>) {
  const authPath = path.join(home, '.config', '.cloudbase', 'auth.json')
  fs.mkdirSync(path.dirname(authPath), { recursive: true })
  fs.writeFileSync(authPath, `${JSON.stringify({ credential })}\n`)
}

describe('CloudBase local management env', () => {
  it('reports a missing local credential file', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'weapp-auth-missing-'))
    try {
      expect(inspectLocalCloudbaseCredential(home, 1_000)).toEqual({
        state: CLOUDBASE_LOCAL_CREDENTIAL_STATES.MISSING,
        present: false,
        hasRefreshToken: false,
        tmpExpiresAt: null,
        refreshExpiresAt: null,
      })
    }
    finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('distinguishes a live STS token from a still-open refresh window', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'weapp-auth-window-'))
    try {
      writeAuth(home, {
        tmpExpired: 2_000,
        expired: 10_000,
        refreshToken: 'refresh-token',
      })
      expect(inspectLocalCloudbaseCredential(home, 1_500).state).toBe(CLOUDBASE_LOCAL_CREDENTIAL_STATES.TMP_VALID)
      const openWindow = inspectLocalCloudbaseCredential(home, 3_000)
      expect(openWindow.state).toBe(CLOUDBASE_LOCAL_CREDENTIAL_STATES.REFRESH_WINDOW_OPEN)
      expect(openWindow.hasRefreshToken).toBe(true)
      expect(openWindow.tmpExpiresAt).toBe(new Date(2_000).toISOString())
      expect(openWindow.refreshExpiresAt).toBe(new Date(10_000).toISOString())
      expect(inspectLocalCloudbaseCredential(home, 11_000).state).toBe(CLOUDBASE_LOCAL_CREDENTIAL_STATES.EXPIRED)
    }
    finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })

  it('reads project-root .env.local and prefers process values', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'weapp-auth-env-'))
    try {
      fs.writeFileSync(path.join(project, '.env.local'), 'CLOUDBASE_API_KEY=from-file\nCLOUDBASE_ENV_ID=from-file-env\n')
      const fromFile = loadCloudbaseManagementEnv(project, {})
      expect(fromFile.hasApiKey).toBe(true)
      expect(fromFile.apiKey).toBe('from-file')
      const fromProcess = loadCloudbaseManagementEnv(project, {
        CLOUDBASE_API_KEY: 'from-process',
        CLOUDBASE_ENV_ID: 'from-process-env',
      } as NodeJS.ProcessEnv)
      expect(fromProcess.apiKey).toBe('from-process')
      const localOnly = loadCloudbaseManagementEnv(project, {
        CLOUDBASE_AUTH_MODE: 'local',
        CLOUDBASE_API_KEY: 'must-not-be-used',
      } as NodeJS.ProcessEnv)
      expect(localOnly).toMatchObject({ authMode: 'local', hasApiKey: false, apiKey: '' })
      const localTarget = {
        CLOUDBASE_AUTH_MODE: 'local',
        CLOUDBASE_API_KEY: 'must-be-removed',
      } as NodeJS.ProcessEnv
      applyCloudbaseManagementEnv(project, localTarget)
      expect(localTarget.CLOUDBASE_API_KEY).toBeUndefined()
      const target = {} as NodeJS.ProcessEnv
      applyCloudbaseManagementEnv(project, target)
      expect(target.CLOUDBASE_API_KEY).toBe('from-file')
      applyCloudbaseManagementEnv(project, target)
      expect(target.CLOUDBASE_API_KEY).toBe('from-file')
      const emptyProject = fs.mkdtempSync(path.join(os.tmpdir(), 'weapp-auth-empty-'))
      try {
        const empty = loadCloudbaseManagementEnv(emptyProject, {})
        expect(empty.hasApiKey).toBe(false)
        expect(empty.apiKey).toBe('')
      }
      finally {
        fs.rmSync(emptyProject, { recursive: true, force: true })
      }
    }
    finally {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it('requires an environment-level API Key and EnvID for normal commands', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'weapp-auth-required-'))
    try {
      expect(() => requireCloudbaseManagementEnv(project, {})).toThrow('CLOUDBASE_API_KEY is required')
      expect(() => requireCloudbaseManagementEnv(project, {
        CLOUDBASE_API_KEY: 'management-key',
      } as NodeJS.ProcessEnv)).toThrow('CLOUDBASE_ENV_ID is required')
      expect(requireCloudbaseManagementEnv(project, {
        CLOUDBASE_API_KEY: 'management-key',
        CLOUDBASE_ENV_ID: 'environment-id',
      } as NodeJS.ProcessEnv)).toMatchObject({
        hasApiKey: true,
        hasEnvId: true,
      })
    }
    finally {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it('requires the exact maintainer approval flag for device authorization', () => {
    expect(hasExplicitDeviceAuthApproval([])).toBe(false)
    expect(hasExplicitDeviceAuthApproval(['--allow-device-auth', 'extra'])).toBe(false)
    expect(hasExplicitDeviceAuthApproval(['--allow-device-auth'])).toBe(true)
    expect(hasExplicitDeviceAuthApproval(['--', '--allow-device-auth'])).toBe(true)
    expect(hasExplicitDeviceAuthApproval(['--', '--allow-device-auth', 'extra'])).toBe(false)
  })
})
