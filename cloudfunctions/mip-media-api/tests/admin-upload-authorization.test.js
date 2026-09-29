'use strict'
const assert = require('node:assert/strict')
const { it } = require('node:test')
const { mediaUploadBindingAllows } = require('../lib/admin-upload-authorization')
const scopes = { PLATFORM: '00000000-0000-0000-0000-000000000000', BRANCH: 'branch-a', EVENT: 'event-a' }
const binding = (role_key, scope_type, extras = {}) => ({ role_key, scope_type, scope_id: scopes[scope_type], ...extras })
it('allows branch/event-owned unpublished images while keeping Banner/video/task capabilities at their system ceilings', () => {
  assert.equal(mediaUploadBindingAllows(binding('BRANCH_ADMIN', 'BRANCH'), 'events.write'), true)
  assert.equal(mediaUploadBindingAllows(binding('EVENT_OWNER', 'EVENT'), 'events.album.manage'), true)
  for (const capability of ['banners.manage', 'events.recaps.manage', 'tasks.manage']) assert.equal(mediaUploadBindingAllows(binding('BRANCH_ADMIN', 'BRANCH'), capability), false)
  assert.equal(mediaUploadBindingAllows(binding('EVENT_STAFF', 'EVENT'), 'events.write'), false)
  assert.equal(mediaUploadBindingAllows(binding('BRANCH_ADMIN', 'PLATFORM'), 'events.write'), false)
  assert.equal(mediaUploadBindingAllows(binding('UNKNOWN', 'PLATFORM'), 'events.write'), false)
})
it('does not combine different bindings or restore capability removed by policy/template', () => {
  const branch = binding('BRANCH_ADMIN', 'BRANCH', { policy_capabilities_json: '["users.read"]' })
  assert.equal(mediaUploadBindingAllows(branch, 'events.write'), false)
  assert.equal(mediaUploadBindingAllows(binding('PLATFORM_FINANCE', 'PLATFORM', { policy_capabilities_json: '["events.write"]' }), 'events.write'), false)
  const linked = binding('BRANCH_ADMIN', 'BRANCH', { role_template_id: 'template-a', template_base_role_key: 'BRANCH_ADMIN', template_status: 'ACTIVE', template_capabilities_json: '["events.write"]' })
  assert.equal(mediaUploadBindingAllows(linked, 'events.write'), true)
  assert.equal(mediaUploadBindingAllows({ ...linked, template_status: 'INACTIVE' }, 'events.write'), false)
  assert.equal(mediaUploadBindingAllows({ ...linked, template_capabilities_json: '{broken}' }, 'events.write'), false)
})
