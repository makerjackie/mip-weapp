export function opportunityActionFailure(error: unknown, fallbackMessage: string) {
  return { message: error instanceof Error ? error.message : fallbackMessage }
}
