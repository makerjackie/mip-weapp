import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { loadRoleTemplates, roleTemplateFromDto } from './admin-role-templates.ts'

const require = createRequire(import.meta.url)
const { templateDto } = require('../../../cloudfunctions/mip-admin-api/domain/role-templates.js')

test('reads the serialized server template and capability catalog through the Web interface', async () => {
  const item = JSON.parse(JSON.stringify(templateDto({ role_id: 21, role_name: '活动编务', description: '内容维护',
    base_role_key: 'BRANCH_ADMIN', capabilities: '["events.read","events.write"]', status: 'ACTIVE', version: 4, binding_count: 3 })))
  const catalog = await loadRoleTemplates(async () => ({ items: [item], baseRoles: [{ key: 'BRANCH_ADMIN', allowedCapabilities: ['events.read', 'events.write'] }], bindingWritesEnabled: false }) as never)
  assert.deepEqual(catalog.items[0], { id: '21', name: '活动编务', description: '内容维护', baseRoleKey: 'BRANCH_ADMIN',
    capabilities: ['events.read', 'events.write'], status: 'ACTIVE', version: 4, bindingCount: 3 })
  assert.equal(catalog.bindingWritesEnabled, false)
  assert.throws(() => roleTemplateFromDto({ ...item, capabilities: null }), /字段不完整/)
})
