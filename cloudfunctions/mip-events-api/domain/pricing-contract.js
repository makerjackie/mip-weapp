'use strict'

// Released clients reject unknown DTO keys. New pricing fields require explicit
// read-side negotiation; this flag never influences eligibility or order amounts.
function legacyEvent(value) {
  if (!value || typeof value !== 'object') return value
  const result = { ...value }
  delete result.memberFree
  delete result.registrationPriceCents
  return result
}

function projectEventPricing(action, data, version) {
  if (version === 1 || !data) return data
  if (action === 'mip.events.detail') return legacyEvent(data)
  if (action === 'mip.events.list') return { ...data, items: data.items.map(legacyEvent) }
  if (action === 'mip.events.mine') {
    return { ...data, items: data.items.map(item => ({ ...item, event: legacyEvent(item.event) })) }
  }
  return data
}

module.exports = { projectEventPricing }
