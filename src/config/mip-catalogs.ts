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
  placeholder: string
}

export interface CooperationRoleDefinition {
  key: CooperationRoleKey
  name: string
  positioning: string
  abilities: string[]
  targetDirection: string
  /** 六项特征评分的角色专属显示标签，按 cooperationAbilityDimensions 顺序映射到稳定存储 key（存储契约不变） */
  abilityLabels: string[]
  /** 角色菜单区：皮条客为结构化圈子（可多组），其余角色为普通输入字段 */
  menu: {
    title: string
    structured: '' | 'circles'
    fields: CooperationField[]
  }
  /** 旧模型独有字段键：编辑已有卡时原样透传保存，页面不展示 */
  legacyFieldKeys: string[]
}

/** 编辑页共同输入区：目标写入页面级 targetSummary，其余两项入 roleFields */
export const cooperationGoalFields = [
  { key: 'targetSummary', label: '目标', placeholder: '示例：2026 年商务引荐赚100 万' },
  { key: 'support', label: '需要支持或引荐的是', placeholder: '示例：需要能带队打仗的操盘手' },
  { key: 'value', label: '和我合作的最大价值是', placeholder: '示例：躺着赚钱' },
] as const

/** 需要被理解的"臭毛病"：单组结构化字段，支持多组（roleFields.quirks） */
export const cooperationQuirkFields = [
  { key: 'external', label: '"臭毛病"（外显）', placeholder: '示例：拖延症晚期' },
  { key: 'internal', label: '病因（内在）', placeholder: '示例：存在侥幸心理' },
  { key: 'advice', label: '预防发作建议（行为）', placeholder: '示例：请跟我强调事情的紧迫性' },
] as const

/** 长混迹的圈子：单组结构化字段（皮条客菜单区），支持多组（roleFields.circles） */
export const cooperationCircleFields = [
  { key: 'name', label: '圈子名称', placeholder: '示例：MIP全球创意人平台' },
  { key: 'identity', label: '圈内身份', placeholder: '示例：资深玩家' },
  { key: 'years', label: '圈内年限', placeholder: '示例：2年' },
  { key: 'trait', label: '圈子特点', placeholder: '聚集一群有创意，协同作战的超级个体' },
] as const

export const mipPlaceholderCatalog = {
  version: '2026-09-03-demo.21',
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
    abilityLabels: ['开拓人脉', '引荐人脉', '长期维护', '引荐商机', '卖点提炼', '跨圈交际'],
    menu: { title: '长混迹的圈子', structured: 'circles', fields: [] },
    legacyFieldKeys: ['resources', 'target'],
  },
  {
    key: 'business_builder',
    name: '生意佬',
    positioning: '自己赚过钱并知道如何帮助别人赚钱',
    abilities: ['商业盈利模式设计', '资源整合', '财务测算'],
    targetDirection: '明确生意行业和商业模式服务人数',
    abilityLabels: ['商机洞察', '财务测算', '盈利建模', '资源整合', '利益统筹', '合作谈判'],
    menu: {
      title: '',
      structured: '',
      fields: [
        { key: 'industries', label: '做过行业或在做行业', input: 'tags', placeholder: '示例：餐饮、商业地产' },
        { key: 'industry_years', label: '行业年限', input: 'text', placeholder: '示例：8 年' },
        { key: 'selling_point', label: '卖点', input: 'textarea', placeholder: '示例：拿得到一手房源' },
      ],
    },
    legacyFieldKeys: ['business_models', 'target'],
  },
  {
    key: 'capital_operator',
    name: '暴发户',
    positioning: '调度资源推动项目实现财富目标',
    abilities: ['投资', '拉投资', '找钱', '算账'],
    targetDirection: '明确投资领域、资金规模和目标规模',
    abilityLabels: ['投资洞察', '上市规划', '股权规划', '投融策划', '融资达成', '资源整合'],
    menu: {
      title: '',
      structured: '',
      fields: [
        { key: 'investment_fields', label: '擅长领域', input: 'tags', placeholder: '示例：消费、医疗' },
        { key: 'field_years', label: '领域年限', input: 'text', placeholder: '示例：10 年' },
        { key: 'achievements', label: '成就', input: 'textarea', placeholder: '示例：主导过 3 个亿元级项目' },
      ],
    },
    legacyFieldKeys: ['capital_range', 'target'],
  },
  {
    key: 'strategist',
    name: '狗策划',
    positioning: '为项目确定方向，并结合创新方式有效落地',
    abilities: ['产品经理', '创意策划', '方法论设计'],
    targetDirection: '明确作品类型和产品策划数量',
    abilityLabels: ['项目调研', '项目定位', '创新创意', '方法设计', '提案竞标', '落地规划'],
    menu: {
      title: '',
      structured: '',
      fields: [
        { key: 'planning_types', label: '类型', input: 'tags', placeholder: '示例：品牌策划、活动策划' },
        { key: 'expertise', label: '擅长领域', input: 'text', placeholder: '示例：消费品从 0 到 1' },
        { key: 'selling_point', label: '卖点', input: 'textarea', placeholder: '示例：提案一次过' },
      ],
    },
    legacyFieldKeys: ['methods', 'target'],
  },
  {
    key: 'visual_designer',
    name: '死美工',
    positioning: '为项目实现准确并符合审美标准的视觉效果',
    abilities: ['视觉设计', '包装', '审美把控'],
    targetDirection: '明确视觉作品类型和服务品牌数量',
    abilityLabels: ['视觉策略', '视觉设计', '素材搜寻', '视觉落地', '视觉管理', '提案竞标'],
    menu: {
      title: '',
      structured: '',
      fields: [
        { key: 'visual_types', label: '类型', input: 'tags', placeholder: '示例：品牌 VI、包装' },
        { key: 'expertise', label: '擅长领域', input: 'text', placeholder: '示例：新消费品牌' },
        { key: 'selling_point', label: '卖点', input: 'textarea', placeholder: '示例：上线即出片' },
      ],
    },
    legacyFieldKeys: ['portfolio_summary', 'target'],
  },
  {
    key: 'delivery_lead',
    name: '老保姆',
    positioning: '带领团队确保项目按进度完成目标',
    abilities: ['项目管理', '执行统筹', '团队协调'],
    targetDirection: '明确项目数量和项目类型',
    abilityLabels: ['目标计划', '执行统筹', '进度复盘', '沟通机制', '标准研发', '应急沟通'],
    menu: {
      title: '',
      structured: '',
      fields: [
        { key: 'project_types', label: '类型', input: 'tags', placeholder: '示例：快闪店、展会' },
        { key: 'expertise', label: '擅长领域', input: 'text', placeholder: '示例：泛娱乐线下' },
        { key: 'selling_point', label: '卖点', input: 'textarea', placeholder: '示例：延期率低于 5%' },
      ],
    },
    legacyFieldKeys: ['delivery_experience', 'target'],
  },
]
