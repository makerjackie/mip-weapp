const EXPERIENCE_PER_STAR = 10
const MAXIMUM_STARS = 5

export function rewardExperienceStarIndexes(rewardExperience: number): number[] {
  const value = Number.isFinite(rewardExperience) ? Math.max(0, rewardExperience) : 0
  const count = Math.min(MAXIMUM_STARS, Math.ceil(value / EXPERIENCE_PER_STAR))
  return Array.from({ length: count }, (_, index) => index)
}
