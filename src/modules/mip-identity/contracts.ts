import type {
  AdminRoleKey,
  BranchId,
  CallerCapabilities,
  CityBranchSummary,
  EntitlementProjection,
  UserId,
  UserKind,
} from '../mip'
import type { AiDraftSourceConfirmation } from '../mip-ai/types'
import type {
  BranchSelectionSnapshot,
  SetPrimaryBranchInput,
} from '../mip-branches/contracts'

export const protectedActionKeys = [
  'REGISTER_EVENT',
  'PURCHASE_MEMBERSHIP',
  'PUBLISH_OPPORTUNITY',
  'INTERACT',
  'VIEW_RESTRICTED_PROFILE',
  'ENTER_ADMIN',
  'EDIT_PROFILE',
] as const

export type ProtectedActionKey = (typeof protectedActionKeys)[number]
export type AccessRequirement = 'AUTHENTICATED' | 'AGREEMENTS' | 'PHONE' | 'PROFILE'
export type AccessBlockCode
  = | 'AUTH_REQUIRED'
    | 'AGREEMENT_REQUIRED'
    | 'PHONE_REQUIRED'
    | 'PROFILE_REQUIRED'
    | 'FORBIDDEN'

export type ReturnNavigation = 'navigateBack' | 'redirectTo' | 'switchTab'

export interface AccessReturnContext {
  navigation: ReturnNavigation
  route?: string
  query?: Record<string, string>
}

export interface ProtectedActionIntent {
  action: ProtectedActionKey
  source: AccessReturnContext
  requirements?: AccessRequirement[]
  requiredCapability?: string
}

export interface AgreementRequirement {
  key: string
  label: string
  version: string
  documentPath: string
  accepted: boolean
}

export interface ProfileOrganization {
  name: string
  role?: string
}

export interface ProfileVisibility {
  nickname?: boolean
  avatar?: boolean
  identityStatus?: boolean
  headline: boolean
  introduction: boolean
  companies: boolean
  organizations: boolean
  industry?: boolean
  abilities?: boolean
  primaryBranch?: boolean
}

export interface PublicProfileTag {
  label: string
}

export interface PublicMipProfile {
  profileRef: string
  isSelf: boolean
  nickname?: string
  avatarUrl?: string
  userKind?: UserKind
  identityStatus?: string
  headline?: string
  introduction?: string
  companies?: ProfileOrganization[]
  organizations?: ProfileOrganization[]
  primaryIndustry?: PublicProfileTag
  abilities?: PublicProfileTag[]
  primaryBranch?: { name: string, cityName: string }
}

export type ProfileMissingField = 'NICKNAME' | 'PRIMARY_BRANCH'

export interface MipProfileSnapshot {
  exists: boolean
  version: number
  nickname: string
  avatarBound: boolean
  avatarAssetId?: string
  avatarUrl?: string
  identityStatus: string
  headline: string
  introduction: string
  companies: ProfileOrganization[]
  organizations: ProfileOrganization[]
  visibility: ProfileVisibility
  primaryIndustryTagId?: string
  abilityTagIds: string[]
  complete: boolean
  missingFields: ProfileMissingField[]
}

export interface MembershipAccessProjection {
  kind: UserKind
  source: 'ENTITLEMENT' | 'NONE' | 'UNAVAILABLE'
  entitlement?: EntitlementProjection
}

export interface IdentityAccessSnapshot {
  authenticated: boolean
  userId?: UserId
  userVersion: number
  userStatus?: 'ACTIVE' | 'BLOCKED' | 'CLOSED'
  phoneBound: boolean
  agreements: AgreementRequirement[]
  profile: MipProfileSnapshot
  primaryBranchId?: BranchId
  membership: MembershipAccessProjection
  grants: CallerCapabilities[]
}

export interface AccessDecision {
  ready: boolean
  block?: AccessBlockCode
  nextRequirement?: AccessRequirement
}

export interface AccessSession {
  token: string
  intent: ProtectedActionIntent
  snapshot: IdentityAccessSnapshot
  decision: AccessDecision
}

export interface PendingAccessResume {
  action: ProtectedActionKey
  source: AccessReturnContext
}

export interface AgreementAcceptanceInput {
  agreements: Array<{ key: string, version: string }>
}

export const accountClosureConfirmationPhrase = '确认注销账号'

export interface AccountClosureInput {
  confirmationPhrase: typeof accountClosureConfirmationPhrase
  expectedVersion: number
  idempotencyKey: string
}

export interface AccountClosureResult {
  status: 'CLOSED'
  version: number
  closedAt: string
  idempotent: boolean
}

export interface ProfileUpdateInput {
  expectedVersion: number
  avatarAssetId?: string
  expectedUserVersion?: number
  primaryBranchId?: BranchId
  nickname: string
  identityStatus: string
  headline: string
  introduction: string
  companies: ProfileOrganization[]
  organizations: ProfileOrganization[]
  visibility: ProfileVisibility
  primaryIndustryTagId?: string
  abilityTagIds: string[]
  aiConfirmation?: AiDraftSourceConfirmation
}

export interface ProfileTagOption {
  id: string
  kind: 'INDUSTRY' | 'ABILITY'
  parentId?: string
  key: string
  label: string
  selectable: boolean
}

export interface MipIdentityGateway {
  getAccessSnapshot: () => Promise<IdentityAccessSnapshot>
  acceptAgreements: (input: AgreementAcceptanceInput) => Promise<IdentityAccessSnapshot>
  bindWechatPhone: (code: string) => Promise<IdentityAccessSnapshot>
  closeAccount: (input: AccountClosureInput) => Promise<AccountClosureResult>
  getProfile: () => Promise<MipProfileSnapshot>
  getPublicProfile: (profileRef: string) => Promise<PublicMipProfile>
  updateProfile: (input: ProfileUpdateInput) => Promise<IdentityAccessSnapshot>
  listProfileTags: () => Promise<ProfileTagOption[]>
  listBranches: () => Promise<CityBranchSummary[]>
  setPrimaryBranch: (input: SetPrimaryBranchInput) => Promise<BranchSelectionSnapshot>
}

export interface AdminGrantInput {
  scopeType: 'PLATFORM' | 'BRANCH' | 'EVENT'
  scopeId: string
  roles: AdminRoleKey[]
}
