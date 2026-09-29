// Keep an already enabled binding gate across ordinary code deployments.
// New environments stay closed until compatible consumers have been verified.
export function roleTemplateBindingFlag({ configured, existing } = {}) {
  const value = typeof configured === 'string' && !configured.trim()
    ? existing ?? 'false'
    : configured ?? existing ?? 'false'
  if (typeof value !== 'string' || !['true', 'false'].includes(value.trim())) {
    throw new Error('MIP_ADMIN_ROLE_TEMPLATES_ENABLED must be true or false')
  }
  return value.trim()
}
