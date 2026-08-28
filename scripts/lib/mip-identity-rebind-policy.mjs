const PHONE_REBIND_STAGES = new Set(['test', 'staging'])

export function resolvePhoneMigrationRebindEnabled(value, deploymentStage) {
  const enabled = String(value || '').trim().toLowerCase() === 'true'
  if (enabled && !PHONE_REBIND_STAGES.has(deploymentStage)) {
    throw new Error('MIP_PHONE_MIGRATION_REBIND_ENABLED is restricted to test or staging')
  }
  return enabled
}
