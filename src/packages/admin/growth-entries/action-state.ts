export function growthAdminActionFailure(error: unknown, fallbackMessage: string) {
  return { message: error instanceof Error ? error.message : fallbackMessage }
}
