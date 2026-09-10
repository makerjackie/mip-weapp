import type { CooperationRoleKey } from '../../modules/mip'
import { cooperationRoles } from '../../config/mip-catalogs'

export interface CooperationCardVariant {
  image: string
  bg: string
  light: string
  name: string
}

/**
 * 六角色烘焙卡（references/wechat-component-contracts.md）。
 *  image 只能用 <image> 承载，WXSS background-image 不行；bg 仅作底图加载前的垫底色。
 */
export const cooperationCardVariants: Record<string, CooperationCardVariant> = {
  'dogplaner': { image: '/assets/mip/coop-card-dogplaner@3x.png', bg: '#7b00ff', light: '#f2e5ff', name: '狗策划 DOGPLANER' },
  'upstart': { image: '/assets/mip/coop-card-upstart@3x.png', bg: '#7a2900', light: '#fadab3', name: '暴发户 UPSTART' },
  'design-slave': { image: '/assets/mip/coop-card-design-slave@3x.png', bg: '#04a44f', light: '#e5fff1', name: '死美工 Design Slave' },
  'pimp': { image: '/assets/mip/coop-card-pimp@3x.png', bg: '#df07a9', light: '#ffe5f9', name: '皮条客 pimp' },
  'business-man': { image: '/assets/mip/coop-card-business-man@3x.png', bg: '#ff5500', light: '#ffeee5', name: '生意佬 business man' },
  'old-nanny': { image: '/assets/mip/coop-card-old-nanny@3x.png', bg: '#1a71ff', light: '#e5efff', name: '老保姆 old nanny' },
}

/** 产品角色 key → 设计变种 key。 */
export const variantByRoleKey: Partial<Record<CooperationRoleKey, string>> = {
  strategist: 'dogplaner',
  capital_operator: 'upstart',
  visual_designer: 'design-slave',
  connector: 'pimp',
  business_builder: 'business-man',
  delivery_lead: 'old-nanny',
}

export interface CooperationNameRun {
  text: string
  latin: boolean
}

/** Figma 里中文段 PingFang 600、拉丁段 Baloo 400（characterStyleOverrides 实测），按 run 拆分。 */
export function cooperationNameRuns(name: string): CooperationNameRun[] {
  return String(name ?? '')
    .split(/([A-Z0-9][A-Z0-9\s'!.-]*)/i)
    .filter(Boolean)
    .map(text => ({ text, latin: /^[A-Z0-9]/i.test(text) }))
}

export interface CooperationRoleCardInput {
  roleKey: string
  name?: string
  positioning?: string
  targetSummary?: string
}

/** 未知角色退化为无烘焙底图的中性卡，不臆造美术资源。 */
export function cooperationRoleCardView(input: CooperationRoleCardInput) {
  const definition = cooperationRoles.find(role => role.key === input.roleKey)
  const variantKey = (definition && variantByRoleKey[definition.key]) || ''
  const variant = cooperationCardVariants[variantKey]
  const name = input.name?.trim() || variant?.name || definition?.name || '合作角色'

  return {
    roleKey: definition?.key || '',
    variant: variantKey,
    name,
    nameRuns: cooperationNameRuns(name),
    goal: input.targetSummary?.trim() || definition?.targetDirection?.trim() || '',
    referral: input.positioning?.trim() || definition?.positioning?.trim() || '',
    image: variant?.image || '',
    bg: variant?.bg || '#333333',
    light: variant?.light || '#f7f7f7',
  }
}
