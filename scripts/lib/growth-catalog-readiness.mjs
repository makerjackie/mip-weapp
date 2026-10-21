export function assertGrowthCatalogReadiness(response) {
  function find(value) {
    if (!value || typeof value !== 'object') {
      return null
    }
    if ('activeLevelCount' in value && 'minimumExperience' in value) {
      return value
    }
    for (const child of Object.values(value)) {
      const row = find(child)
      if (row) {
        return row
      }
    }
    return null
  }
  const row = find(response)
  const count = Number(row?.activeLevelCount)
  if (response?.success === false || !row || !Number.isSafeInteger(count) || count < 1
    || row.minimumExperience === null || Number(row.minimumExperience) !== 0) {
    throw new Error('GROWTH_LEVEL_BASE_REQUIRED: configure an ACTIVE growth level starting at zero experience')
  }
  return { activeLevelCount: count, minimumExperience: 0 }
}
