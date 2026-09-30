/** Display labels come from the same server projection as the Excel export. */
export function feedbackFields(item: Record<string, unknown>) {
  const display = item.displayFields && typeof item.displayFields === 'object' && !Array.isArray(item.displayFields)
    ? item.displayFields as Record<string, unknown> : {}
  if (item.answers && typeof item.answers === 'object' && Object.keys(item.answers).length && !Object.keys(display).length) {
    throw new Error('反馈字段合同不完整，请刷新后重试')
  }
  const value = (key: string) => typeof display[key] === 'string' && display[key] ? display[key] : '—'
  return { wouldRecommend: value('wouldRecommend'), capabilityRoles: value('capabilityRoles'),
    resources: typeof item.body === 'string' && item.body ? item.body : '—',
    joinMipIntent: value('joinMipIntent'), discoverySource: value('discoverySource'), rosterConsent: value('rosterConsent') }
}
