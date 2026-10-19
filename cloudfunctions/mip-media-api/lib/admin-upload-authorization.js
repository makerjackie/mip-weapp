'use strict'
const roles = require('./admin-upload-role-catalog')
const { effectivePolicyCapabilities, templateAllowsBinding } = require('./role-template-policy')
const ZERO_SCOPE = '00000000-0000-0000-0000-000000000000'
// 读侧口径：具备任一 MEDIA 用途能力即可解析临时地址（与 mip-admin-api 的 MEDIA_ADMIN_PURPOSE_CAPABILITIES 值一致）。
const MEDIA_READ_CAPABILITIES = Object.freeze([
  'banners.manage',
  'events.write',
  'opportunities.moderate',
  'userContent.moderate',
  'tasks.manage',
  'badges.manage',
  'events.recaps.manage',
])
function mediaBindingAllows(row, capabilities) {
  const base = roles[row?.role_key]
  if (!base || !capabilities.some(capability => base.capabilities.includes(capability)) || !base.scopes.includes(row.scope_type)
    || (row.scope_type === 'PLATFORM' ? row.scope_id !== ZERO_SCOPE : !row.scope_id || row.scope_id === ZERO_SCOPE)
    || !templateAllowsBinding(row)) return false
  const values = effectivePolicyCapabilities(row)
  if (values === null || values === undefined) return true
  try {
    const parsed = typeof values === 'string' ? JSON.parse(values) : values
    return Array.isArray(parsed) && new Set(parsed).size === parsed.length && parsed.every(value => typeof value === 'string')
      && capabilities.some(capability => parsed.includes(capability))
  } catch { return false }
}
function mediaUploadBindingAllows(row, capability) {
  return mediaBindingAllows(row, [capability])
}
function mediaReadBindingAllows(row) {
  return mediaBindingAllows(row, MEDIA_READ_CAPABILITIES)
}
module.exports = { MEDIA_READ_CAPABILITIES, mediaReadBindingAllows, mediaUploadBindingAllows }
