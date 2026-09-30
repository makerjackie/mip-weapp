'use strict'

// Generated into each deployment package. This is the only authored policy source.
function capabilityArray(raw) {
  let value = raw
  if (typeof raw === 'string' || Buffer.isBuffer(raw)) {
    try { value = JSON.parse(String(raw)) } catch { return null }
  }
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string') || new Set(value).size !== value.length) return null
  return value
}
function templateAllowsBinding(row) {
  if (row.role_template_id === null || row.role_template_id === undefined) return true
  return row.role_key !== 'PLATFORM_OWNER' && row.template_status === 'ACTIVE'
    && row.template_base_role_key === row.role_key && capabilityArray(row.template_capabilities_json) !== null
}
function effectivePolicyCapabilities(row) {
  const policy = Object.hasOwn(row, 'policy_capabilities_json') ? row.policy_capabilities_json
    : row.policy_mode === 'CUSTOM' ? row.capabilities_json : null
  if (row.role_template_id === null || row.role_template_id === undefined) return policy
  if (!templateAllowsBinding(row)) return []
  const template = capabilityArray(row.template_capabilities_json)
  if (policy === null || policy === undefined) return template
  const configured = capabilityArray(policy)
  return configured ? template.filter(capability => configured.includes(capability)) : []
}
module.exports = { capabilityArray, effectivePolicyCapabilities, templateAllowsBinding }
