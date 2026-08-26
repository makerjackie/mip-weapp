import type {
  AdminOpportunityEditorOptions,
  AdminUserContentDetail,
  AdminUserContentKind,
  AdminUserContentStatus,
} from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { cooperationAbilityDimensions, cooperationRoles } from '../../../config/mip-catalogs'
import { mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

interface FieldView { key: string, label: string, input: string, value: string, placeholder: string }
type Status = Extract<AdminUserContentStatus, 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED'>

const statuses: Array<{ label: string, value: Status }> = [
  { label: '草稿', value: 'DRAFT' },
  { label: '已发布', value: 'PUBLISHED' },
  { label: '已下架', value: 'UNPUBLISHED' },
]

function fieldText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join('、') : value || ''
}

function ownerLabel(owner: { nickname: string, branchName: string } | undefined) {
  return owner ? `${owner.nickname}${owner.branchName ? ` · ${owner.branchName}` : ''}` : '请选择归属用户'
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    kind: 'COOPERATION_CARD' as AdminUserContentKind,
    contentId: '',
    version: 0,
    detail: null as AdminUserContentDetail | null,
    options: null as AdminOpportunityEditorOptions | null,
    industryOptions: [] as Array<{ id: string, label: string }>,
    ownerIndex: -1,
    ownerName: '请选择归属用户',
    statusIndex: 0,
    statuses,
    status: 'DRAFT' as Status,
    roleIndex: 0,
    roleOptions: cooperationRoles.map(role => ({ key: role.key, label: role.name })),
    roleFields: [] as FieldView[],
    abilityScores: cooperationAbilityDimensions.map(item => ({ ...item, score: 3 })),
    positioning: '',
    targetSummary: '',
    projectName: '',
    summary: '',
    startedOn: '',
    endedOn: '',
    responsibility: '',
    cityIndex: -1,
    industryIndex: -1,
    caseType: '',
    description: '',
    coverAssetId: '',
    mediaAssetIds: [] as string[],
    saving: false,
    message: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const kind = query.kind === 'SUPER_CASE' ? 'SUPER_CASE' : 'COOPERATION_CARD'
    this.setData({ kind, contentId: String(query.contentId || query.id || '') })
    void this.load()
  },

  async load() {
    try {
      const [options, detail] = await Promise.all([
        mipAdminModule.opportunities.getEditorOptions(true),
        this.data.contentId
          ? mipAdminModule.userContent.get(this.data.kind, this.data.contentId, true)
          : Promise.resolve(null),
      ])
      const item = detail as AdminUserContentDetail | null
      const status = item?.status === 'PUBLISHED' || item?.status === 'UNPUBLISHED' ? item.status : 'DRAFT'
      const statusIndex = statuses.findIndex(entry => entry.value === status)
      const ownerIndex = item ? options.owners.findIndex(owner => owner.id === item.owner.userId) : -1
      const roleIndex = item?.kind === 'COOPERATION_CARD'
        ? Math.max(0, cooperationRoles.findIndex(role => role.key === item.roleKey))
        : 0
      const selectedRole = cooperationRoles[roleIndex]
      const cityIndex = item?.kind === 'SUPER_CASE'
        ? options.cities.findIndex(city => city.id === item.cityTagId)
        : -1
      const industries = options.tags.filter(tag => tag.kind === 'INDUSTRY')
      const industryIndex = item?.kind === 'SUPER_CASE'
        ? industries.findIndex(tag => tag.id === item.industryTagId)
        : -1
      this.setData({
        state: 'ready',
        options,
        detail: item,
        ownerIndex,
        industryOptions: industries,
        ownerName: ownerLabel(options.owners[ownerIndex]),
        statusIndex: statusIndex >= 0 ? statusIndex : 0,
        status,
        roleIndex,
        roleFields: selectedRole?.fields.map(field => ({
          key: field.key,
          label: field.label,
          input: field.input,
          value: item?.kind === 'COOPERATION_CARD' ? fieldText(item.roleFields[field.key]) : '',
          placeholder: field.placeholder,
        })) || [],
        abilityScores: cooperationAbilityDimensions.map(dimension => ({
          ...dimension,
          score: item?.kind === 'COOPERATION_CARD' ? Number(item.abilityScores[dimension.key] ?? 3) : 3,
        })),
        positioning: item?.kind === 'COOPERATION_CARD' ? item.positioning : '',
        targetSummary: item?.kind === 'COOPERATION_CARD' ? item.targetSummary : '',
        projectName: item?.kind === 'SUPER_CASE' ? item.projectName : '',
        summary: item?.kind === 'SUPER_CASE' ? item.summary : '',
        startedOn: item?.kind === 'SUPER_CASE' ? item.startedOn || '' : '',
        endedOn: item?.kind === 'SUPER_CASE' ? item.endedOn || '' : '',
        responsibility: item?.kind === 'SUPER_CASE' ? item.responsibility : '',
        cityIndex,
        industryIndex,
        caseType: item?.kind === 'SUPER_CASE' ? item.caseType : '',
        description: item?.kind === 'SUPER_CASE' ? item.description : '',
        coverAssetId: item?.kind === 'SUPER_CASE' ? item.coverAssetId || '' : '',
        mediaAssetIds: item?.kind === 'SUPER_CASE' ? item.mediaAssetIds : [],
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '用户内容编辑页加载失败' }))
    }
  },

  chooseOwner(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const ownerIndex = Number(event.detail.value)
    this.setData({ ownerIndex, ownerName: ownerLabel(this.data.options?.owners[ownerIndex]) })
  },
  chooseStatus(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const statusIndex = Number(event.detail.value) || 0
    this.setData({ statusIndex, status: statuses[statusIndex]?.value || 'DRAFT' })
  },
  chooseRole(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const roleIndex = Number(event.detail.value) || 0
    const role = cooperationRoles[roleIndex]
    this.setData({
      roleIndex,
      roleFields: role.fields.map(field => ({ ...field, value: '' })),
    })
  },
  chooseCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ cityIndex: Number(event.detail.value) })
  },
  chooseIndustry(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ industryIndex: Number(event.detail.value) })
  },
  chooseDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (field === 'startedOn' || field === 'endedOn') {
      this.setData({ [field]: event.detail.value })
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['positioning', 'targetSummary', 'projectName', 'summary', 'responsibility', 'caseType', 'description'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  updateRoleField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ roleFields: this.data.roleFields.map(field => field.key === key ? { ...field, value: event.detail.value } : field) })
  },
  updateAbility(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const key = String(event.currentTarget.dataset.key || '')
    const score = Math.max(0, Math.min(5, Number(event.detail.value)))
    this.setData({ abilityScores: this.data.abilityScores.map(item => item.key === key ? { ...item, score: Number.isFinite(score) ? score : 0 } : item) })
  },

  async save() {
    if (this.data.saving || !this.data.options) {
      return
    }
    const owner = this.data.options.owners[this.data.ownerIndex]
    if (!owner) {
      this.setData({ message: '请选择明确的归属用户。' })
      return
    }
    const status = this.data.status
    if (status === 'PUBLISHED' && this.data.detail?.status === 'ARCHIVED') {
      return
    }
    const draft = this.data.kind === 'COOPERATION_CARD'
      ? {
          kind: 'COOPERATION_CARD' as const,
          roleKey: this.data.roleOptions[this.data.roleIndex]?.key || '',
          positioning: this.data.positioning,
          targetSummary: this.data.targetSummary,
          roleFields: Object.fromEntries(this.data.roleFields.map(field => [
            field.key,
            field.input === 'tags' ? field.value.split(/[、,，\n]/).map(item => item.trim()).filter(Boolean) : field.value,
          ])),
          abilityScores: Object.fromEntries(this.data.abilityScores.map(item => [item.key, item.score])),
          status,
        }
      : {
          kind: 'SUPER_CASE' as const,
          projectName: this.data.projectName,
          summary: this.data.summary,
          startedOn: this.data.startedOn || null,
          endedOn: this.data.endedOn || null,
          responsibility: this.data.responsibility,
          cityTagId: this.data.cityIndex >= 0 ? this.data.options.cities[this.data.cityIndex]?.id || null : null,
          industryTagId: this.data.industryIndex >= 0 ? this.data.industryOptions[this.data.industryIndex]?.id || null : null,
          caseType: this.data.caseType || null,
          description: this.data.description,
          coverAssetId: this.data.coverAssetId || null,
          mediaAssetIds: this.data.mediaAssetIds,
          status,
        }
    this.setData({ saving: true, message: '' })
    try {
      const result = await mipAdminModule.userContent.save({
        kind: this.data.kind,
        contentId: this.data.contentId || undefined,
        expectedVersion: this.data.contentId ? this.data.version : undefined,
        ownerUserId: owner.id,
        draft,
      })
      wx.showToast({ title: '内容已保存', icon: 'success' })
      void wx.redirectTo({ url: `/packages/admin/user-content/index?ownerUserId=${encodeURIComponent(owner.id)}&kind=${this.data.kind}&contentId=${encodeURIComponent(result.id)}` })
    }
    catch (error) {
      this.setData({ message: isAdminVersionConflict(error) ? '内容已被其他运营成员更新，请刷新后重试。' : (error instanceof Error ? error.message : '内容保存失败') })
    }
    finally { this.setData({ saving: false }) }
  },
})
