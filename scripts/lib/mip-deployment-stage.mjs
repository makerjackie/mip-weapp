export const MIP_DEPLOYMENT_STAGES = Object.freeze([
  'development',
  'test',
  'staging',
  'production',
])

export function resolveMipDeploymentStage(value, argv = []) {
  const stage = String(value || '').trim().toLowerCase()
  if (!MIP_DEPLOYMENT_STAGES.includes(stage)) {
    throw new Error(
      `MIP_DEPLOYMENT_STAGE must be one of ${MIP_DEPLOYMENT_STAGES.join(', ')}`,
    )
  }
  if (stage === 'production' && !argv.includes('--confirm-production')) {
    throw new Error('Production MIP deployment requires --confirm-production')
  }
  return stage
}
