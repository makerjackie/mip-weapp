import type { CooperationRoleKey } from '../modules/mip'

export interface TagOption {
  key: string
  label: string
  popular?: boolean
}

export interface TagGroup {
  key: string
  label: string
  options: TagOption[]
}

export interface CooperationField {
  key: string
  label: string
  input: 'text' | 'textarea' | 'number' | 'tags'
  required: boolean
  placeholder: string
}

export interface CooperationRoleDefinition {
  key: CooperationRoleKey
  name: string
  positioning: string
  abilities: string[]
  targetDirection: string
  fields: CooperationField[]
}

export const mipPlaceholderCatalog = {
  version: '2026-08-27-demo.14',
  replaceBeforeProduction: true,
  cityBranches: [
    { key: 'shenzhen', label: '深圳分会', city: '深圳' },
    { key: 'guangzhou', label: '广州分会', city: '广州' },
    { key: 'shanghai', label: '上海分会', city: '上海' },
    { key: 'beijing', label: '北京分会', city: '北京' },
  ],
  cityTags: [
    { key: 'shenzhen', label: '深圳', popular: true },
    { key: 'guangzhou', label: '广州', popular: true },
    { key: 'shanghai', label: '上海', popular: true },
    { key: 'beijing', label: '北京', popular: true },
    { key: 'hangzhou', label: '杭州', popular: true },
    { key: 'chengdu', label: '成都', popular: true },
    { key: 'foshan', label: '佛山' },
    { key: 'dongguan', label: '东莞' },
    { key: 'zhuhai', label: '珠海' },
  ],
  industryGroups: [
    {
      key: 'internet_ai',
      label: '互联网与人工智能',
      options: [
        { key: 'internet', label: '互联网', popular: true },
        { key: 'artificial_intelligence', label: '人工智能', popular: true },
        { key: 'software', label: '计算机软件' },
        { key: 'enterprise_services', label: '企业服务' },
        { key: 'ecommerce', label: '电子商务' },
        { key: 'cloud_computing', label: '云计算' },
        { key: 'data_services', label: '大数据' },
      ],
    },
    {
      key: 'creative_design',
      label: '创意与设计',
      options: [
        { key: 'advertising_marketing', label: '广告营销', popular: true },
        { key: 'visual_design', label: '视觉设计', popular: true },
        { key: 'culture_creative', label: '文化创意' },
        { key: 'media_content', label: '媒体与内容' },
        { key: 'brand_consulting', label: '品牌咨询' },
      ],
    },
    {
      key: 'business_services',
      label: '商业与专业服务',
      options: [
        { key: 'business_consulting', label: '商业咨询', popular: true },
        { key: 'human_resources', label: '人力资源' },
        { key: 'legal_services', label: '法律服务' },
        { key: 'education_training', label: '教育培训' },
        { key: 'real_estate', label: '房地产' },
      ],
    },
    {
      key: 'finance_investment',
      label: '金融与投资',
      options: [
        { key: 'investment', label: '投资', popular: true },
        { key: 'financial_services', label: '金融服务', popular: true },
        { key: 'accounting_tax', label: '财税服务' },
        { key: 'insurance', label: '保险' },
      ],
    },
    {
      key: 'consumer_services',
      label: '消费与生活服务',
      options: [
        { key: 'retail', label: '零售' },
        { key: 'food_beverage', label: '餐饮' },
        { key: 'healthcare', label: '医疗健康', popular: true },
        { key: 'sports_wellness', label: '运动健康' },
        { key: 'travel_hospitality', label: '文旅与酒店' },
      ],
    },
  ] satisfies TagGroup[],
} as const

export const cooperationAbilityDimensions = [
  { key: 'business_development', label: '业务拓展' },
  { key: 'resource_integration', label: '资源整合' },
  { key: 'capital_operation', label: '资本运作' },
  { key: 'strategy_planning', label: '策划能力' },
  { key: 'visual_design', label: '视觉能力' },
  { key: 'delivery_management', label: '交付管理' },
] as const

export const cooperationRoles: CooperationRoleDefinition[] = [
  {
    key: 'connector',
    name: '皮条客',
    positioning: '愿意分享自己的人脉或为他人引荐生意',
    abilities: ['拉业务', '拉资源', '识别商机', '经营圈子'],
    targetDirection: '引荐客户、促成生意和带来成交额',
    fields: [
      { key: 'circles', label: '熟悉的圈子', input: 'tags', required: true, placeholder: '选择或填写熟悉的圈子' },
      { key: 'resources', label: '可引荐资源', input: 'textarea', required: true, placeholder: '说明可以引荐的客户或资源' },
      { key: 'target', label: '目标', input: 'textarea', required: true, placeholder: '填写计划引荐的客户、成交笔数或成交额' },
    ],
  },
  {
    key: 'business_builder',
    name: '生意佬',
    positioning: '自己赚过钱并知道如何帮助别人赚钱',
    abilities: ['商业盈利模式设计', '资源整合', '财务测算'],
    targetDirection: '明确生意行业和商业模式服务人数',
    fields: [
      { key: 'industries', label: '擅长行业', input: 'tags', required: true, placeholder: '选择或填写擅长的行业' },
      { key: 'business_models', label: '商业模式经验', input: 'textarea', required: true, placeholder: '说明做过或擅长的商业模式' },
      { key: 'target', label: '目标', input: 'textarea', required: true, placeholder: '填写计划帮助的人数和业务目标' },
    ],
  },
  {
    key: 'capital_operator',
    name: '暴发户',
    positioning: '调度资源推动项目实现财富目标',
    abilities: ['投资', '拉投资', '找钱', '算账'],
    targetDirection: '明确投资领域、资金规模和目标规模',
    fields: [
      { key: 'investment_fields', label: '关注领域', input: 'tags', required: true, placeholder: '选择或填写关注的投资领域' },
      { key: 'capital_range', label: '资金范围', input: 'text', required: true, placeholder: '填写可参与或计划募集的资金范围' },
      { key: 'target', label: '目标', input: 'textarea', required: true, placeholder: '填写投资或项目规模目标' },
    ],
  },
  {
    key: 'strategist',
    name: '狗策划',
    positioning: '为项目确定方向，并结合创新方式有效落地',
    abilities: ['产品经理', '创意策划', '方法论设计'],
    targetDirection: '明确作品类型和产品策划数量',
    fields: [
      { key: 'planning_types', label: '策划类型', input: 'tags', required: true, placeholder: '选择或填写擅长的策划类型' },
      { key: 'methods', label: '方法与经验', input: 'textarea', required: true, placeholder: '说明常用方法和代表经验' },
      { key: 'target', label: '目标', input: 'textarea', required: true, placeholder: '填写计划完成的作品或产品数量' },
    ],
  },
  {
    key: 'visual_designer',
    name: '死美工',
    positioning: '为项目实现准确并符合审美标准的视觉效果',
    abilities: ['视觉设计', '包装', '审美把控'],
    targetDirection: '明确视觉作品类型和服务品牌数量',
    fields: [
      { key: 'visual_types', label: '视觉类型', input: 'tags', required: true, placeholder: '选择或填写擅长的视觉类型' },
      { key: 'portfolio_summary', label: '作品与经验', input: 'textarea', required: true, placeholder: '说明代表作品和服务经验' },
      { key: 'target', label: '目标', input: 'textarea', required: true, placeholder: '填写计划完成的作品或服务品牌数量' },
    ],
  },
  {
    key: 'delivery_lead',
    name: '老保姆',
    positioning: '带领团队确保项目按进度完成目标',
    abilities: ['项目管理', '执行统筹', '团队协调'],
    targetDirection: '明确项目数量和项目类型',
    fields: [
      { key: 'project_types', label: '项目类型', input: 'tags', required: true, placeholder: '选择或填写擅长管理的项目类型' },
      { key: 'delivery_experience', label: '交付经验', input: 'textarea', required: true, placeholder: '说明团队规模和交付经验' },
      { key: 'target', label: '目标', input: 'textarea', required: true, placeholder: '填写计划完成的项目数量和类型' },
    ],
  },
]
