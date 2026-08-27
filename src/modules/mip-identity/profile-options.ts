import type { ProfileGender } from './contracts'

export const profileGenderOptions: Array<{ value: ProfileGender, label: string }> = [
  { value: 'UNKNOWN', label: '未设置' },
  { value: 'MALE', label: '男' },
  { value: 'FEMALE', label: '女' },
]

export const careerIdentityOptions = [
  { value: 'BRAND_PRINCIPAL', label: '品牌主理人' },
  { value: 'PROFESSIONAL_INVESTOR', label: '专业投资人' },
  { value: 'BIG_TECH_ELITE', label: '大厂精英' },
  { value: 'STUDENT', label: '在读学生' },
  { value: 'PASSIONATE_FOUNDER', label: '激情创业者' },
  { value: 'FREE_EXPLORER', label: '自由探索者' },
  { value: 'COMPANY_OWNER', label: '公司负责人' },
  { value: 'SLASH_YOUTH', label: '斜杠青年' },
] as const
