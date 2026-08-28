const publicEventTypeLabels: Record<string, string> = {
  community: '社区活动',
  mip_morning_meeting: 'MIP 早会',
}

const technicalKeyPattern = /^[a-z][a-z0-9]*(?:[_.:-][a-z0-9]+)+$/

/** Keep catalog keys out of user-facing event surfaces when legacy rows lack a label. */
export function publicEventTypeLabel(value: string, key = value) {
  const mapped = publicEventTypeLabels[key] || publicEventTypeLabels[value]
  if (mapped) {
    return mapped
  }
  const label = value.trim()
  return technicalKeyPattern.test(label) ? '活动' : label
}
