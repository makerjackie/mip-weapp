import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function source(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

describe('MIP digital avatar', () => {
  it('uses the current owned READY profile avatar and persists only server-verified output', () => {
    const repository = source('cloudfunctions/mip-ai-api/domain/repository.js')
    const service = source('cloudfunctions/mip-ai-api/domain/service.js')

    expect(repository).toMatch(/FROM mip_profiles profile[\s\S]*profile\.avatar_asset_id = \?[\s\S]*asset\.owner_user_id = \?[\s\S]*asset\.purpose = 'AVATAR'[\s\S]*asset\.status = 'READY'/)
    expect(repository).toMatch(/purpose = 'DIGITAL_AVATAR' AND status = 'PENDING'/)
    expect(repository).toMatch(/SET owner_user_id = \?, status = 'READY'/)
    expect(repository).toContain('provider_job_key_hash = ?')
    expect(service.indexOf('createAvatarGeneration')).toBeLessThan(service.indexOf('provider.generateDigitalAvatar'))
    expect(service.indexOf('avatarStore.store')).toBeLessThan(service.indexOf('completeAvatarGeneration'))
  })

  it('has stable styles, strict provider output, and no fake local success path', () => {
    const types = source('src/modules/mip-ai/types.ts')
    const provider = source('cloudfunctions/mip-ai-api/lib/provider.js')
    const page = source('src/packages/member/mip-avatar/index.ts')
    const app = JSON.parse(source('src/app.json'))
    const memberPackage = app.subPackages.find((item: { root: string }) => item.root === 'packages/member')

    expect(types).toMatch(/key: 'PROFESSIONAL'/)
    expect(types).toMatch(/key: 'ILLUSTRATED'/)
    expect(types).toMatch(/key: 'MONOCHROME'/)
    expect(provider).toMatch(/return call\('generateDigitalAvatar'/)
    expect(provider).toMatch(/\['contentType', 'imageBase64', 'providerJobKey'\]/)
    expect(provider).not.toContain('outputUrl: value.outputUrl')
    expect(page).toContain('mipIdentityModule.loadSnapshot()')
    expect(page).toContain('snapshot.profile.avatarAssetId')
    expect(page).toContain('mipAiModule.generateDigitalAvatar')
    expect(page).toMatch(/selectStyle[\s\S]*setData\([\s\S]*void this\.generate\(\)/)
    expect(page).not.toContain('canvas')
    expect(memberPackage.pages).toContain('mip-avatar/index')
  })

  it('declares image safety and deploys the isolated avatar provider configuration', () => {
    const config = JSON.parse(source('cloudfunctions/mip-ai-api/config.json'))
    const deployment = source('scripts/deploy-functions.mjs')
    const environment = source('.env.example')

    expect(config.permissions.openapi).toContain('security.imgSecCheck')
    expect(deployment).toContain('MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME')
    expect(deployment).toContain('ai: [\'security.imgSecCheck\']')
    expect(environment).toContain('MIP_AI_AVATAR_PROVIDER_FUNCTION_NAME=')
  })

  it('adds an append-only generation table without exposing the internal user id in client DTOs', () => {
    const migration = source('database/mysql/mip/030_digital_avatar_generations.sql')
    const rollback = source('database/mysql/mip/rollback/030_digital_avatar_generations.sql')
    const types = source('src/modules/mip-ai/types.ts')
    const repository = source('cloudfunctions/mip-ai-api/domain/repository.js')

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_digital_avatar_generations')
    expect(migration).toContain('source_avatar_asset_id')
    expect(migration).toContain('UNIQUE KEY mip_digital_avatar_generations_request_uk (app_id, user_id, request_id)')
    expect(migration).toContain('output_asset_id')
    expect(migration).not.toMatch(/^\s*(?:DELETE|TRUNCATE)\b/m)
    expect(rollback).toBe('DROP TABLE IF EXISTS mip_digital_avatar_generations;\n')
    expect(types.slice(types.indexOf('export interface DigitalAvatarGeneration'), types.indexOf('export interface DigitalAvatarGenerationIntent'))).not.toContain('userId')
    expect(repository.slice(repository.indexOf('function avatarGenerationDto'), repository.indexOf('function parseObject'))).not.toContain('userId')
  })

  it('reuses one request identity across an uncertain client retry', () => {
    const page = source('src/packages/member/mip-avatar/index.ts')
    const validation = source('cloudfunctions/mip-ai-api/domain/validation.js')
    const repository = source('cloudfunctions/mip-ai-api/domain/repository.js')

    expect(page).toContain('generationRequestId: requestId')
    expect(page).toMatch(/\['SERVICE_UNAVAILABLE', 'DIGITAL_AVATAR_GENERATION_IN_PROGRESS'\]/)
    expect(validation).toContain('event.requestId.trim()')
    expect(validation).toContain('{8,128}')
    expect(repository).toContain('request_id = ? FOR UPDATE')
    expect(repository).toContain('replayed: true')
  })
})
