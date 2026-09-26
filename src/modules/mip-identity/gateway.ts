import type { CityBranchSummary } from '../mip'
import type { BranchSelectionSnapshot, SetPrimaryBranchInput } from '../mip-branches/contracts'
import type {
  AccountClosureInput,
  AccountClosureResult,
  AgreementAcceptanceInput,
  BindSmsPhoneInput,
  IdentityAccessSnapshot,
  MembershipAgreement,
  MipIdentityAction,
  MipIdentityActionInputMap,
  MipIdentityGateway,
  MipIdentityRequest,
  MipProfileSnapshot,
  PhoneSmsRequestResult,
  ProfileCardSettings,
  ProfileCardUpdateInput,
  ProfileOrganization,
  ProfileTagOption,
  ProfileUpdateInput,
  PublicMipProfile,
} from './contracts'
import { MIP_IDENTITY_CONTRACT_VERSION } from './contracts'

interface FunctionEnvelope {
  ok: boolean
  data?: unknown
  error?: { code?: string, message?: string, retryable?: boolean }
}

export interface MipIdentityTransport {
  invoke: <A extends MipIdentityAction>(request: MipIdentityRequest<A>) => Promise<unknown>
}

export class MipIdentityGatewayError extends Error {
  readonly code: string
  readonly retryable: boolean

  constructor(
    code: string,
    message: string,
    retryable = false,
  ) {
    super(message)
    this.name = 'MipIdentityGatewayError'
    this.code = code
    this.retryable = retryable
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrap(value: unknown): unknown {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效响应')
  }
  const envelope = value as unknown as FunctionEnvelope
  if (!envelope.ok) {
    throw new MipIdentityGatewayError(
      envelope.error?.code || 'SERVICE_UNAVAILABLE',
      envelope.error?.message || '身份服务暂时不可用',
      Boolean(envelope.error?.retryable),
    )
  }
  return envelope.data
}

function profile(value: unknown): MipProfileSnapshot {
  if (!isRecord(value)
    || typeof value.exists !== 'boolean'
    || !Number.isInteger(value.version)
    || typeof value.nickname !== 'string'
    || typeof value.complete !== 'boolean'
    || !Array.isArray(value.missingFields)) {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效资料')
  }
  return value as unknown as MipProfileSnapshot
}

function snapshot(value: unknown): IdentityAccessSnapshot {
  if (!isRecord(value)
    || typeof value.authenticated !== 'boolean'
    || !Number.isInteger(value.userVersion)
    || typeof value.phoneBound !== 'boolean'
    || !Array.isArray(value.agreements)
    || !Array.isArray(value.grants)
    || !isRecord(value.membership)
    || !['PLAYER', 'GUEST'].includes(String(value.membership.kind))) {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效访问状态')
  }
  if (value.profileRef !== undefined
    && (typeof value.profileRef !== 'string' || !/^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/.test(value.profileRef))) {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效公开档案引用')
  }
  return { ...value, profile: profile(value.profile) } as unknown as IdentityAccessSnapshot
}

function optionalText(value: unknown) {
  return typeof value === 'string' && value ? value : undefined
}

function publicOrganizations(value: unknown): ProfileOrganization[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== 'string' || !item.name) {
      return []
    }
    return [{ name: item.name, ...(optionalText(item.role) ? { role: optionalText(item.role) } : {}) }]
  })
}

function publicTags(value: unknown): Array<{ label: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.flatMap(item => isRecord(item) && typeof item.label === 'string' && item.label
    ? [{ label: item.label }]
    : [])
}

function publicProfile(value: unknown): PublicMipProfile {
  if (!isRecord(value)
    || typeof value.profileRef !== 'string'
    || !value.profileRef.startsWith('p1.')
    || typeof value.isSelf !== 'boolean') {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效公开档案')
  }
  const primaryBranch = isRecord(value.primaryBranch)
    && typeof value.primaryBranch.name === 'string'
    && typeof value.primaryBranch.cityName === 'string'
    ? { name: value.primaryBranch.name, cityName: value.primaryBranch.cityName }
    : undefined
  const primaryIndustry = isRecord(value.primaryIndustry) && typeof value.primaryIndustry.label === 'string'
    ? { label: value.primaryIndustry.label }
    : undefined
  const userKind = ['PLAYER', 'GUEST'].includes(String(value.userKind))
    ? value.userKind as PublicMipProfile['userKind']
    : undefined
  return {
    profileRef: value.profileRef,
    isSelf: value.isSelf,
    ...(optionalText(value.nickname) ? { nickname: optionalText(value.nickname) } : {}),
    ...(optionalText(value.realName) ? { realName: optionalText(value.realName) } : {}),
    ...(['UNKNOWN', 'MALE', 'FEMALE'].includes(String(value.gender)) ? { gender: value.gender as PublicMipProfile['gender'] } : {}),
    ...(optionalText(value.careerIdentityKey) ? { careerIdentityKey: optionalText(value.careerIdentityKey) } : {}),
    ...(optionalText(value.avatarUrl) ? { avatarUrl: optionalText(value.avatarUrl) } : {}),
    ...(userKind ? { userKind } : {}),
    ...(optionalText(value.identityStatus) ? { identityStatus: optionalText(value.identityStatus) } : {}),
    ...(optionalText(value.headline) ? { headline: optionalText(value.headline) } : {}),
    ...(optionalText(value.introduction) ? { introduction: optionalText(value.introduction) } : {}),
    ...(publicOrganizations(value.companies) ? { companies: publicOrganizations(value.companies) } : {}),
    ...(publicOrganizations(value.organizations) ? { organizations: publicOrganizations(value.organizations) } : {}),
    ...(primaryIndustry ? { primaryIndustry } : {}),
    ...(publicTags(value.abilities) ? { abilities: publicTags(value.abilities) } : {}),
    ...(primaryBranch ? { primaryBranch } : {}),
  }
}

function profileCardCode(value: unknown) {
  if (!isRecord(value) || typeof value.codeUrl !== 'string' || !value.codeUrl) {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效名片码')
  }
  return { codeUrl: value.codeUrl }
}

function profileCardSceneResolution(value: unknown) {
  if (!isRecord(value)
    || typeof value.profileRef !== 'string'
    || !/^p1\.[\w-]{16}\.[\w-]{48}\.[\w-]{22}$/.test(value.profileRef)) {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效名片档案')
  }
  return { profileRef: value.profileRef }
}

function accountClosure(value: unknown): AccountClosureResult {
  if (!isRecord(value)
    || value.status !== 'CLOSED'
    || !Number.isInteger(value.version)
    || Number(value.version) < 1
    || typeof value.closedAt !== 'string'
    || !Number.isFinite(Date.parse(value.closedAt))
    || typeof value.idempotent !== 'boolean') {
    throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效注销状态')
  }
  return {
    status: 'CLOSED',
    version: value.version as number,
    closedAt: new Date(value.closedAt).toISOString(),
    idempotent: value.idempotent,
  }
}

async function call<A extends MipIdentityAction>(
  transport: MipIdentityTransport,
  action: A,
  input: MipIdentityActionInputMap[A],
) {
  return unwrap(await transport.invoke({
    contractVersion: MIP_IDENTITY_CONTRACT_VERSION,
    action,
    input,
  }))
}

export function createMipIdentityGateway(transport: MipIdentityTransport): MipIdentityGateway {
  return {
    async signIn() {
      return snapshot(await call(transport, 'signIn', {}))
    },
    async getAccessSnapshot() {
      return snapshot(await call(transport, 'getAccessSnapshot', {}))
    },

    async acceptAgreements(input: AgreementAcceptanceInput) {
      return snapshot(await call(transport, 'acceptAgreements', input))
    },

    async bindWechatPhone(code: string) {
      return snapshot(await call(transport, 'bindWechatPhone', { code }))
    },

    async requestPhoneSms(phone: string): Promise<PhoneSmsRequestResult> {
      const value = await call(transport, 'requestPhoneSms', { phone })
      if (!isRecord(value) || typeof value.challengeId !== 'string'
        || !/^[0-9a-f-]{36}$/i.test(value.challengeId)
        || value.status !== 'ACCEPTED' || !Number.isInteger(value.retryAfterSeconds)
        || Number(value.retryAfterSeconds) < 1 || Number(value.retryAfterSeconds) > 3600
        || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt))) {
        throw new MipIdentityGatewayError('INVALID_RESPONSE', '验证码服务返回的数据格式不正确')
      }
      return { challengeId: value.challengeId, status: 'ACCEPTED', retryAfterSeconds: Number(value.retryAfterSeconds), expiresAt: value.expiresAt }
    },

    async bindSmsPhone(input: BindSmsPhoneInput) {
      return snapshot(await call(transport, 'bindSmsPhone', input))
    },

    async closeAccount(input: AccountClosureInput) {
      return accountClosure(await call(transport, 'closeAccount', input))
    },

    async getProfile() {
      return profile(await call(transport, 'getProfile', {}))
    },

    async getMembershipAgreement(document?: 'membership' | 'user'): Promise<MembershipAgreement> {
      const value = await call(transport, 'getMembershipAgreement', document ? { document } : {})
      const item = value as MembershipAgreement
      if (!item || typeof item.title !== 'string' || typeof item.body !== 'string'
        || typeof item.isDemo !== 'boolean' || !Number.isSafeInteger(item.version) || item.version < 0 || typeof item.updatedAt !== 'string') {
        throw new MipIdentityGatewayError('INVALID_RESPONSE', '协议响应无效')
      }
      return { title: item.title, body: item.body, isDemo: item.isDemo, version: item.version, updatedAt: item.updatedAt }
    },
    async getProfileCardSettings(): Promise<ProfileCardSettings> {
      const value = await call(transport, 'getProfileCardSettings', {})
      if (!isRecord(value) || typeof value.enabled !== 'boolean' || typeof value.reason !== 'string'
        || !Array.isArray(value.templates) || value.templates.some(item => !isRecord(item)
          || !['PINK', 'BLUE', 'WHITE', 'YELLOW'].includes(String(item.key)) || typeof item.name !== 'string'
          || !Array.isArray(item.requiredFields) || item.requiredFields.some(field => !['name', 'avatar', 'company', 'position', 'contact'].includes(String(field))))) {
        throw new MipIdentityGatewayError('INVALID_RESPONSE', '名片模板数据无效')
      }
      return value as unknown as ProfileCardSettings
    },

    async getMyProfileCardCode() {
      return profileCardCode(await call(transport, 'getMyProfileCardCode', {}))
    },

    async getPublicProfile(profileRef: string) {
      return publicProfile(await call(transport, 'getPublicProfile', { profileRef }))
    },

    async resolveProfileCardScene(scene: string) {
      return profileCardSceneResolution(await call(transport, 'resolveProfileCardScene', { scene }))
    },

    async updateProfile(input: ProfileUpdateInput) {
      return snapshot(await call(transport, 'updateProfile', input))
    },

    async updateCard(input: ProfileCardUpdateInput) {
      return snapshot(await call(transport, 'updateCard', input))
    },

    async listProfileTags() {
      const value = await call(transport, 'listProfileTags', {})
      if (!Array.isArray(value)) {
        throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效标签')
      }
      return value as ProfileTagOption[]
    },

    async listBranches() {
      const value = await call(transport, 'listBranches', {})
      if (!Array.isArray(value)) {
        throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效分会列表')
      }
      return value as CityBranchSummary[]
    },

    async setPrimaryBranch(input: SetPrimaryBranchInput) {
      const value = await call(transport, 'setPrimaryBranch', input)
      if (!isRecord(value) || !Array.isArray(value.branches) || !Number.isInteger(value.userVersion)) {
        throw new MipIdentityGatewayError('INVALID_RESPONSE', '身份服务返回了无效分会状态')
      }
      return value as unknown as BranchSelectionSnapshot
    },
  }
}
