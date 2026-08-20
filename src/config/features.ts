export const features = {
  membership: true,
  events: true,
  community: true,
  admin: true,
  followAndBlock: true,
  announcements: true,
  reports: true,
  subscriptions: true,
} as const

export type FeatureFlags = typeof features
