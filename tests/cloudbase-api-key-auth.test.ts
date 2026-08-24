import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loginWithCloudbaseManagementApiKey } from '../scripts/lib/cloudbase-management-auth.mjs'
import { parseMcpOutput } from '../scripts/lib/cloudbase-mcp-runner.mjs'

const root = path.resolve(import.meta.dirname, '..')

describe('CloudBase API-key-only authentication', () => {
  it('rejects MCP error envelopes instead of accepting their payload', () => {
    expect(() => parseMcpOutput(JSON.stringify({
      isError: true,
      content: [{ type: 'text', text: '{"auth_status":"READY"}' }],
    }))).toThrow('MCP tool returned an error response')
  })

  it('validates the configured key before accepting READY', () => {
    const calls: string[] = []
    const result = loginWithCloudbaseManagementApiKey(root, {
      apiKey: 'management-key',
      envId: 'environment-id',
    }, {
      callCloudbaseMcp(_projectRoot, tool, args) {
        calls.push(`${tool}:${args.action}`)
      },
      cloudbaseAuthStatus() {
        calls.push('auth:status')
        return { authStatus: 'READY', envStatus: 'READY' }
      },
      restartCloudbaseMcp() {
        calls.push('daemon:restart')
      },
    })

    expect(result).toEqual({ authStatus: 'READY', envStatus: 'READY' })
    expect(calls).toEqual(['auth:login_by_api_key', 'auth:status'])
  })

  it('retries API Key login once after refreshing a stale daemon', () => {
    const calls: string[] = []
    let attempt = 0
    loginWithCloudbaseManagementApiKey(root, {
      apiKey: 'management-key',
      envId: 'environment-id',
    }, {
      callCloudbaseMcp() {
        calls.push('auth:login_by_api_key')
        attempt += 1
        if (attempt === 1) {
          throw new Error('stale daemon')
        }
      },
      cloudbaseAuthStatus() {
        calls.push('auth:status')
        return { authStatus: 'READY', envStatus: 'READY' }
      },
      restartCloudbaseMcp() {
        calls.push('daemon:restart')
      },
    })
    expect(calls).toEqual([
      'auth:login_by_api_key',
      'daemon:restart',
      'auth:login_by_api_key',
      'auth:status',
    ])
  })

  it('keeps device authorization out of normal commands', () => {
    const normalSources = [
      'scripts/cloudbase-auth.mjs',
      'scripts/cloudbase-status.mjs',
    ].map(file => fs.readFileSync(path.join(root, file), 'utf8'))
    const deviceSource = fs.readFileSync(path.join(root, 'scripts/cloudbase-device-auth.mjs'), 'utf8')
    const deviceAction = ['start', 'auth'].join('_')

    expect(normalSources.every(source => !source.includes(deviceAction))).toBe(true)
    expect(deviceSource).toContain(deviceAction)
    expect(deviceSource).toContain('exactly --allow-device-auth')
  })
})
