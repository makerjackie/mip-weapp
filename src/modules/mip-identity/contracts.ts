import type {
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
  'ENTER_APP',
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

export type ReturnNavigation = 'navigateBack' | 'redirectTo' | 'reLaunch' | 'switchTab'

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
  realName?: boolean
  gender?: boolean
  careerIdentity?: boolean
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
  influence?: boolean
  cardContacts?: {
    phone?: boolean
    wechat?: boolean
    email?: boolean
    address?: boolean
  }
}

export type ProfileGender = 'UNKNOWN' | 'MALE' | 'FEMALE'

export interface ProfilePrivateContact {
  phone?: string
  phoneMasked?: string
  phoneBound: boolean
  wechat?: string
  email?: string
  address?: string
}

export interface PublicProfileTag {
  label: string
}

export interface PublicMipProfile {
  profileRef: string
  isSelf: boolean
  nickname?: string
  realName?: string
  gender?: ProfileGender
  careerIdentityKey?: string
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
  realName: string
  gender: ProfileGender
  careerIdentityKey: string
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
  privateContact?: ProfilePrivateContact
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
  profileRef?: string
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
  realName?: string
  gender?: ProfileGender
  careerIdentityKey?: string
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

export interface ProfileCardUpdateInput {
  expectedVersion: number
  realName: string
  companies: ProfileOrganization[]
  organizations: ProfileOrganization[]
  wechat: string
  email: string
  address: string
  visibility: Partial<ProfileVisibility>
}

export interface ProfileTagOption {
  id: string
  kind: 'INDUSTRY' | 'ABILITY'
  parentId?: string
  key: string
  label: string
  selectable: boolean
  popular?: boolean
}

export interface ProfileCardCode {
  codeUrl: string
}

export interface ProfileCardSceneResolution {
  profileRef: string
}

export const MIP_IDENTITY_CONTRACT_VERSION = 1 as const

export interface MipIdentityActionInputMap {
  getAccessSnapshot: Record<string, never>
  acceptAgreements: AgreementAcceptanceInput
  bindWechatPhone: { code: string }
  closeAccount: AccountClosureInput
  getProfile: Record<string, never>
  getMyProfileCardCode: Record<string, never>
  getPublicProfile: { profileRef: string }
  resolveProfileCardScene: { scene: string }
  updateProfile: ProfileUpdateInput
  updateCard: ProfileCardUpdateInput
  listProfileTags: Record<string, never>
  listBranches: Record<string, never>
  setPrimaryBranch: SetPrimaryBranchInput
}

export interface MipIdentityActionResultMap {
  getAccessSnapshot: IdentityAccessSnapshot
  acceptAgreements: IdentityAccessSnapshot
  bindWechatPhone: IdentityAccessSnapshot
  closeAccount: AccountClosureResult
  getProfile: MipProfileSnapshot
  getMyProfileCardCode: ProfileCardCode
  getPublicProfile: PublicMipProfile
  resolveProfileCardScene: ProfileCardSceneResolution
  updateProfile: IdentityAccessSnapshot
  updateCard: IdentityAccessSnapshot
  listProfileTags: ProfileTagOption[]
  listBranches: CityBranchSummary[]
  setPrimaryBranch: BranchSelectionSnapshot
}

export type MipIdentityAction = keyof MipIdentityActionInputMap

export interface MipIdentityRequest<A extends MipIdentityAction = MipIdentityAction> {
  contractVersion: typeof MIP_IDENTITY_CONTRACT_VERSION
  action: A
  input: MipIdentityActionInputMap[A]
}

export interface MipIdentityGateway {
  getAccessSnapshot: () => Promise<IdentityAccessSnapshot>
  acceptAgreements: (input: AgreementAcceptanceInput) => Promise<IdentityAccessSnapshot>
  bindWechatPhone: (code: string) => Promise<IdentityAccessSnapshot>
  closeAccount: (input: AccountClosureInput) => Promise<AccountClosureResult>
  getProfile: () => Promise<MipProfileSnapshot>
  getMyProfileCardCode: () => Promise<ProfileCardCode>
  getPublicProfile: (profileRef: string) => Promise<PublicMipProfile>
  resolveProfileCardScene: (scene: string) => Promise<ProfileCardSceneResolution>
  updateProfile: (input: ProfileUpdateInput) => Promise<IdentityAccessSnapshot>
  updateCard: (input: ProfileCardUpdateInput) => Promise<IdentityAccessSnapshot>
  listProfileTags: () => Promise<ProfileTagOption[]>
  listBranches: () => Promise<CityBranchSummary[]>
  setPrimaryBranch: (input: SetPrimaryBranchInput) => Promise<BranchSelectionSnapshot>
}
