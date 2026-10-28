'use strict'

// Older released clients reject unknown keys; negotiation affects display only.
function projectEventTags(action, data, version) {
  if (version === 1 || !data) return data
  const legacy = value => {
    if (!value || typeof value !== 'object') return value
    const { tagStyles: _styles, ...result } = value
    return result
  }
  if (action === 'mip.events.detail') return legacy(data)
  if (action === 'mip.events.list') return { ...data, items: data.items.map(legacy) }
  if (action === 'mip.events.mine') return { ...data, items: data.items.map(item => ({ ...item, event: legacy(item.event) })) }
  return data
}
module.exports = { projectEventTags }
