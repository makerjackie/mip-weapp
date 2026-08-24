import {
  classifyCloudbaseAuthStatus,
  CLOUD_BASE_AUTH_STATES,
} from './cloudbase-auth-state.mjs'
import {
  callCloudbaseMcp,
  cloudbaseAuthStatus,
  restartCloudbaseMcp,
} from './cloudbase-mcp-runner.mjs'

export function loginWithCloudbaseManagementApiKey(
  projectRoot,
  management,
  runtime = {
    callCloudbaseMcp,
    cloudbaseAuthStatus,
    restartCloudbaseMcp,
  },
) {
  const login = () => runtime.callCloudbaseMcp(projectRoot, 'auth', {
    action: 'login_by_api_key',
    apiKey: management.apiKey,
    apiKeyEnvId: management.envId,
  }, 30000)

  try {
    login()
  }
  catch {
    runtime.restartCloudbaseMcp(projectRoot)
    login()
  }

  const status = runtime.cloudbaseAuthStatus(projectRoot)
  const classified = classifyCloudbaseAuthStatus(status)
  if (
    classified.authStatus !== CLOUD_BASE_AUTH_STATES.READY
    || classified.envStatus !== CLOUD_BASE_AUTH_STATES.READY
  ) {
    throw new Error(`management API Key login did not become READY (auth=${classified.authStatus}, env=${classified.envStatus})`)
  }
  return classified
}
