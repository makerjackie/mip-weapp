import type { CooperationRoleKey } from '../../modules/mip'
import { brand } from '../../config/brand'
import { cooperationRoles } from '../../config/mip-catalogs'

export interface CooperationRoleVisual {
  backgroundColor: string
  softColor: string
  foregroundColor: string
  artPath: string
}

export const cooperationRoleVisuals: Record<CooperationRoleKey, CooperationRoleVisual> = {
  connector: {
    backgroundColor: '#DF07A9',
    softColor: '#FFE5F9',
    foregroundColor: '#FFFFFF',
    artPath: '/assets/figma/cooperation/connector.png',
  },
  business_builder: {
    backgroundColor: '#FF5500',
    softColor: '#FFE5F9',
    foregroundColor: '#FFFFFF',
    artPath: '/assets/figma/cooperation/business-builder.png',
  },
  capital_operator: {
    backgroundColor: '#7A2900',
    softColor: '#FADAB3',
    foregroundColor: '#FFFFFF',
    artPath: '/assets/figma/cooperation/capital-operator.png',
  },
  strategist: {
    backgroundColor: '#7B00FF',
    softColor: '#DAB8FF',
    foregroundColor: '#FFFFFF',
    artPath: '/assets/figma/cooperation/strategist.png',
  },
  visual_designer: {
    backgroundColor: '#04A44F',
    softColor: '#AFFDD4',
    foregroundColor: '#FFFFFF',
    artPath: '/assets/figma/cooperation/visual-designer.png',
  },
  delivery_lead: {
    backgroundColor: '#1A71FF',
    softColor: '#E5EFFF',
    foregroundColor: '#FFFFFF',
    artPath: '/assets/figma/cooperation/delivery-lead.png',
  },
}

export interface CooperationRoleCardInput {
  roleKey: string
  positioning?: string
  targetSummary?: string
}

export function cooperationRoleCardView(input: CooperationRoleCardInput) {
  const definition = cooperationRoles.find(role => role.key === input.roleKey)
  const visual = definition ? cooperationRoleVisuals[definition.key] : null
  const backgroundColor = visual?.backgroundColor || '#363636'
  const softColor = visual?.softColor || '#4A4A4A'
  const foregroundColor = visual?.foregroundColor || '#FFFFFF'

  return {
    roleKey: definition?.key || '',
    roleName: definition?.name || '合作角色',
    positioning: input.positioning?.trim() || definition?.positioning || '角色信息待完善',
    targetSummary: input.targetSummary?.trim() || definition?.targetDirection || '合作目标待完善',
    artPath: visual?.artPath || '',
    brandMark: brand.markText,
    heroStyle: `background-color: ${backgroundColor}; color: ${foregroundColor};`,
    softStyle: `background-color: ${softColor};`,
  }
}
