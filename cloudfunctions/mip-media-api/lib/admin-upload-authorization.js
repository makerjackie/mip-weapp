'use strict'
const roles = require('./admin-upload-role-catalog')
const { effectivePolicyCapabilities, templateAllowsBinding } = require('./role-template-policy')
const ZERO_SCOPE = '00000000-0000-0000-0000-000000000000'
function mediaUploadBindingAllows(row, capability) {
  const base = roles[row?.role_key]
  if (!base || !base.capabilities.includes(capability) || !base.scopes.includes(row.scope_type)
    || (row.scope_type === 'PLATFORM' ? row.scope_id !== ZERO_SCOPE : !row.scope_id || row.scope_id === ZERO_SCOPE)
    || !templateAllowsBinding(row)) return false
  const capabilities = effectivePolicyCapabilities(row)
  if (capabilities === null || capabilities === undefined) return true
  try {
    const values = typeof capabilities === 'string' ? JSON.parse(capabilities) : capabilities
    return Array.isArray(values) && new Set(values).size === values.length && values.every(value => typeof value === 'string') && values.includes(capability)
  } catch { return false }
}
module.exports = { mediaUploadBindingAllows }
