/**
 * Local art is only a visual fallback; award state and image URLs remain server facts.
 */
const BADGE_ART = {
  profile: '/assets/badges/profile-complete.png',
  collaboration: '/packages/member/assets/generated/badges/badge-collaboration.png',
  attendance: '/packages/member/assets/generated/badges/badge-attendance.png',
  growth: '/packages/member/assets/generated/badges/badge-growth.png',
  connectionBuilder: '/packages/member/assets/generated/badges/badge-connection-builder.png',
  creativeStrategist: '/packages/member/assets/generated/badges/badge-creative-strategist.png',
  deliveryLeader: '/packages/member/assets/generated/badges/badge-delivery-leader.png',
} as const

export function badgeArtFallback(key: string, name = '') {
  const normalized = `${key} ${name}`.toLowerCase()
  if (/profile[_ -]?complete|资料完善/u.test(normalized)) {
    return BADGE_ART.profile
  }
  if (/connection[_ -]?builder|builder|人脉/u.test(normalized)) {
    return BADGE_ART.connectionBuilder
  }
  if (/creative|strategist|策划|创意/u.test(normalized)) {
    return BADGE_ART.creativeStrategist
  }
  if (/delivery|leader|统筹|交付/u.test(normalized)) {
    return BADGE_ART.deliveryLeader
  }
  if (/event|attend|activity|活动|参与|签到/u.test(normalized)) {
    return BADGE_ART.attendance
  }
  if (/growth|level|experience|成长|等级|经验/u.test(normalized)) {
    return BADGE_ART.growth
  }
  return BADGE_ART.collaboration
}
