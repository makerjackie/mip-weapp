import type { AdminMessageTemplate, AdminMessageTemplateDraft } from '../src/modules/mip-admin/message-templates'
import type { AdminTransport } from '../src/modules/mip-admin/transport'
import type { MipAdminGateway } from '../src/modules/mip-admin/types'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { RUNTIME_TABLE_PRIVILEGES } from '../scripts/lib/mysql-privilege-assert.mjs'
import { createMipAdminModule } from '../src/modules/mip-admin/client'
import { createMipAdminGateway } from '../src/modules/mip-admin/cloudbase-gateway'
import { readActions } from '../src/modules/mip-admin/cloudbase-transport'
import {
  parseMessageTemplate,
  parseMessageTemplatePage,
} from '../src/modules/mip-admin/message-templates'
import { MipAdminError } from '../src/modules/mip-admin/types'

vi.mock('../src/modules/platform/cloudbase', () => ({
  requireCloudClient: vi.fn(),
}))

vi.mock('../src/config/runtime', () => ({
  runtimeConfig: { cloudbase: { adminFunctionName: 'mip-admin-api' } },
}))

const template: AdminMessageTemplate = {
  id: '20000000-0000-4000-8000-000000000002',
  scopeType: 'PLATFORM',
  branchId: null,
  branchName: '',
  status: 'DRAFT',
  currentRevisionNumber: 2,
  name: '活动提醒',
  title: '活动即将开始',
  body: '请在活动页查看最新安排。',
  contentSafetyStatus: 'PASSED',
  revisionCreatedAt: '2030-08-24T08:00:00.000Z',
  version: 4,
  createdAt: '2030-08-20T08:00:00.000Z',
  updatedAt: '2030-08-24T08:00:00.000Z',
}

const draft: AdminMessageTemplateDraft = {
  templateId: template.id,
  expectedVersion: 4,
  scopeType: 'PLATFORM',
  branchId: null,
  name: '活动提醒',
  title: '活动安排已更新',
  body: '请在活动页查看最新安排。',
}

describe('MIP message template contract', () => {
  it('strictly parses public current-revision DTOs without internal user ids', () => {
    expect(parseMessageTemplate(template)).toEqual(template)
    expect(parseMessageTemplatePage({ items: [template], nextCursor: null }).items).toEqual([template])
    expect(() => parseMessageTemplate({ ...template, createdByUserId: 'private-user' })).toThrow()
    expect(() => parseMessageTemplate({
      ...template,
      scopeType: 'BRANCH',
      branchId: null,
    })).toThrow()
    expect(() => parseMessageTemplate({ ...template, currentRevisionNumber: 0 })).toThrow()
    expect(() => parseMessageTemplate({ ...template, scopeType: ['PLATFORM'] })).toThrow()
    expect(() => parseMessageTemplate({ ...template, status: ['DRAFT'] })).toThrow()
    expect(() => parseMessageTemplate({ ...template, contentSafetyStatus: ['PASSED'] })).toThrow()
  })

  it('uses the neutral v1 request envelope and direct business input for every template action', async () => {
    const requests: Array<Record<string, unknown>> = []
    const transport: AdminTransport = {
      async request(request) {
        requests.push(structuredClone(request) as unknown as Record<string, unknown>)
        if (request.action === 'mip.admin.messageTemplates.list') {
          return { items: [template], nextCursor: null } as never
        }
        return {
          ...template,
          status: request.action.endsWith('.activate')
            ? 'ACTIVE'
            : request.action.endsWith('.archive') ? 'ARCHIVED' : 'DRAFT',
          version: request.action.endsWith('.get') ? 4 : 5,
        } as never
      },
    }
    const gateway = createMipAdminGateway(transport)

    await gateway.listMessageTemplates({ status: 'DRAFT', query: '活动', limit: 25 })
    await gateway.getMessageTemplate(template.id)
    await gateway.saveMessageTemplate(draft)
    await gateway.activateMessageTemplate(template.id, 4)
    await gateway.archiveMessageTemplate(template.id, 4)

    expect(requests.map(request => request.action)).toEqual([
      'mip.admin.messageTemplates.list',
      'mip.admin.messageTemplates.get',
      'mip.admin.messageTemplates.save',
      'mip.admin.messageTemplates.activate',
      'mip.admin.messageTemplates.archive',
    ])
    for (const request of requests) {
      expect(Object.keys(request).sort()).toEqual(['action', 'contractVersion', 'input'])
      expect(request.contractVersion).toBe(1)
      expect(request.input).toEqual(expect.any(Object))
    }
    expect(requests[2]?.input).toEqual(draft)
    expect(requests[3]?.input).toEqual({ templateId: template.id, expectedVersion: 4 })
    expect(requests[3]).not.toHaveProperty('expectedVersion')
  })

  it('retries only template reads and keeps all template mutations single-shot', () => {
    expect(readActions.has('mip.admin.messageTemplates.list')).toBe(true)
    expect(readActions.has('mip.admin.messageTemplates.get')).toBe(true)
    expect(readActions.has('mip.admin.messageTemplates.save')).toBe(false)
    expect(readActions.has('mip.admin.messageTemplates.activate')).toBe(false)
    expect(readActions.has('mip.admin.messageTemplates.archive')).toBe(false)
  })

  it('caches template reads, invalidates only after successful mutations, and preserves original errors', async () => {
    const forbidden = new MipAdminError('FORBIDDEN', '当前账号不能归档消息模板')
    const spies = {
      listMessageTemplates: vi.fn<MipAdminGateway['listMessageTemplates']>(async () => ({
        items: [template],
        nextCursor: null,
      })),
      getMessageTemplate: vi.fn<MipAdminGateway['getMessageTemplate']>(async () => template),
      saveMessageTemplate: vi.fn<MipAdminGateway['saveMessageTemplate']>(async () => ({
        ...template,
        currentRevisionNumber: 3,
        version: 5,
      })),
      activateMessageTemplate: vi.fn<MipAdminGateway['activateMessageTemplate']>(async () => ({
        ...template,
        status: 'ACTIVE',
        version: 5,
      })),
      archiveMessageTemplate: vi.fn<MipAdminGateway['archiveMessageTemplate']>(async () => {
        throw forbidden
      }),
    }
    const module = createMipAdminModule(spies as unknown as MipAdminGateway)

    await module.messaging.listTemplates({ status: 'DRAFT' })
    await module.listMessageTemplates({ status: 'DRAFT' })
    await module.messaging.getTemplate(template.id)
    await module.getMessageTemplate(template.id)
    expect(spies.listMessageTemplates).toHaveBeenCalledTimes(1)
    expect(spies.getMessageTemplate).toHaveBeenCalledTimes(1)

    await module.messaging.saveTemplate(draft)
    expect(spies.saveMessageTemplate.mock.calls[0]?.[0]).toBe(draft)
    await module.messaging.listTemplates({ status: 'DRAFT' })
    await module.messaging.getTemplate(template.id)
    expect(spies.listMessageTemplates).toHaveBeenCalledTimes(2)
    expect(spies.getMessageTemplate).toHaveBeenCalledTimes(2)

    await expect(module.messaging.archiveTemplate(template.id, 5)).rejects.toBe(forbidden)
    await module.messaging.listTemplates({ status: 'DRAFT' })
    await module.messaging.getTemplate(template.id)
    expect(spies.listMessageTemplates).toHaveBeenCalledTimes(2)
    expect(spies.getMessageTemplate).toHaveBeenCalledTimes(2)
  })

  it('locks append-only migration, rollback guard, and least-privilege runtime grants', () => {
    const migration = readFileSync('database/mysql/mip/039_message_templates.sql', 'utf8')
    const rollback = readFileSync('database/mysql/mip/rollback/039_message_templates.sql', 'utf8')
    const lock = JSON.parse(readFileSync('database/mysql/mip/migrations.lock.json', 'utf8')) as {
      migrations: Array<Record<string, unknown>>
    }
    const entry = lock.migrations.find(item => item.name === 'mip_message_templates')

    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_message_templates')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS mip_message_template_revisions')
    expect(migration).toContain('PRIMARY KEY (app_id, template_id, revision_number)')
    expect(migration).not.toMatch(/ALTER\s+TABLE\s+mip_message_campaigns/i)
    expect(rollback).toContain('mip_message_templates_rollback_guard')
    expect(entry).toMatchObject({
      version: '20260824390000',
      createsTables: ['mip_message_templates', 'mip_message_template_revisions'],
      altersTables: [],
    })
    expect(entry?.sqlSha256).toBe(createHash('sha256').update(migration).digest('hex'))
    expect(entry?.rollbackSha256).toBe(createHash('sha256').update(rollback).digest('hex'))
    expect(RUNTIME_TABLE_PRIVILEGES.mip_message_templates).toEqual(['SELECT', 'INSERT', 'UPDATE'])
    expect(RUNTIME_TABLE_PRIVILEGES.mip_message_template_revisions).toEqual(['SELECT', 'INSERT'])
  })
})
