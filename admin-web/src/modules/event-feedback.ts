/** Display labels come from the same server projection as the Excel export. */
function displayMap(item: Record<string, unknown>) {
  return item.displayFields && typeof item.displayFields === 'object' && !Array.isArray(item.displayFields)
    ? item.displayFields as Record<string, unknown> : {}
}

/** True when a non-empty answers payload actually carries the server display projection. */
export function feedbackDisplayComplete(item: Record<string, unknown>) {
  const display = displayMap(item)
  return !(item.answers && typeof item.answers === 'object' && Object.keys(item.answers).length && !Object.keys(display).length)
}

export function feedbackFields(item: Record<string, unknown>) {
  const display = displayMap(item)
  const value = (key: string) => typeof display[key] === 'string' && display[key] ? display[key] : '—'
  return { wouldRecommend: value('wouldRecommend'), capabilityRoles: value('capabilityRoles'),
    resources: typeof item.body === 'string' && item.body ? item.body : '—',
    joinMipIntent: value('joinMipIntent'), discoverySource: value('discoverySource'), rosterConsent: value('rosterConsent') }
}
