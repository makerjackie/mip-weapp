import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

describe('admin domain bridge deployment contract', () => {
  it('initializes, injects, and verifies every isolated admin bridge secret', () => {
    const localSecrets = read('scripts/lib/mip-local-secrets.mjs')
    const deploy = read('scripts/deploy-functions.mjs')
    const verify = read('scripts/verify-cloud.mjs')
    const bridges = [
      ['TASKS', 'tasks'],
      ['BANNERS', 'banners'],
      ['GAME', 'game'],
      ['MEDIA', 'media'],
    ] as const

    for (const [prefix, role] of bridges) {
      expect(localSecrets).toContain(`MIP_${prefix}_ADMIN_HMAC_SECRET`)
      expect(deploy).toContain(`MIP_${prefix}_ADMIN_HMAC_SECRET`)
      expect(verify).toContain(`MIP_${prefix}_ADMIN_HMAC_SECRET`)
      expect(deploy).toContain(`options.functionNames.${role}`)
    }
    expect(deploy).toContain('MIP_BANNERS_FUNCTION_NAME')
    expect(deploy).toContain('MIP_GAME_FUNCTION_NAME')
    expect(deploy).toContain('MIP_MEDIA_FUNCTION_NAME')
    expect(verify).toContain('assertDomainAdminEnvironment(coreDetails)')
  })
})
