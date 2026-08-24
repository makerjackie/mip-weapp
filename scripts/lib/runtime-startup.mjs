import { RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR } from './runtime-preflight.mjs'

export function isRuntimeServicePortNotListeningError(error) {
  return error instanceof Error
    && error.message === RUNTIME_SERVICE_PORT_NOT_LISTENING_ERROR
}

export async function prepareRuntimeDevtools({ preflight, warmProject }) {
  try {
    return {
      preflight: await preflight(),
      projectPrewarmedBeforePreflight: false,
    }
  }
  catch (error) {
    if (!isRuntimeServicePortNotListeningError(error)) {
      throw error
    }
  }

  await warmProject()
  return {
    preflight: await preflight(),
    projectPrewarmedBeforePreflight: true,
  }
}
