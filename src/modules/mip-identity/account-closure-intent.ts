export function createAccountClosureRequestTracker(
  createKey = () => `identity-close-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
) {
  let key = ''
  return {
    current() {
      key ||= createKey()
      return key
    },
    reset() {
      key = ''
    },
  }
}
