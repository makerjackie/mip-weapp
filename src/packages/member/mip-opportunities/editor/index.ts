import type { BranchId, CooperationRoleKey, OpportunityId } from '../../../../modules/mip'
import type { OpportunityCatalog, OpportunityDetail } from '../../../../modules/mip-opportunities'
import { cooperationRoles } from '../../../../config/mip-catalogs'
import { mipMediaModule } from '../../../../modules/mip-media/client'
import { opportunityModule } from '../../../../modules/mip-opportunities'
import { chooseSingleImage } from '../../../../modules/platform/image-upload'

interface SelectOption { id: string, label: string, selected: boolean }
interface IndustryGroupOption { id: string, label: string, options: SelectOption[] }
interface RoleOption { key: CooperationRoleKey, name: string, selected: boolean }

Page({
  data: {
    id: '' as OpportunityId | '',
    version: 0,
    state: 'loading' as 'loading' | 'ready' | 'error',
    saving: false,
    message: '',
    title: '',
    valueSummary: '',
    targetSummary: '',
    description: '',
    scopeType: 'PLATFORM' as 'PLATFORM' | 'BRANCH',
    branchId: '' as BranchId | '',
    branchIndex: 0,
    cityTagId: '',
    cityIndex: 0,
    coverAssetId: '',
    coverUrl: '',
    coverUploading: false,
    catalog: { branches: [], cityTags: [], industryGroups: [], industryTags: [], abilityTags: [] } as OpportunityCatalog,
    branchOptions: [{ id: '', name: 'MIP 平台', cityName: '全国' }],
    cityOptions: [{ id: '', label: '全国' }],
    roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name, selected: false })) as RoleOption[],
    industryGroups: [] as IndustryGroupOption[],
    abilityOptions: [] as SelectOption[],
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ id: String(options.id || '') as OpportunityId | '' })
    void this.initialize()
  },

  async initialize() {
    this.setData({ state: 'loading', message: '' })
    try {
      const [catalog, detail] = await Promise.all([
        opportunityModule.getCatalogs(),
        this.data.id ? opportunityModule.get(this.data.id) : Promise.resolve(null),
      ])
      this.applyCatalog(catalog, detail)
      this.setData({ state: 'ready' })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '页面加载失败' })
    }
  },

  applyCatalog(catalog: OpportunityCatalog, detail: OpportunityDetail | null) {
    const branchOptions = [{ id: '', name: 'MIP 平台', cityName: '全国' }, ...catalog.branches]
    const cityOptions = [{ id: '', label: '全国' }, ...catalog.cityTags]
    const roleKeys = new Set(detail?.roles || [])
    const industryIds = new Set(detail?.industryTags.map(item => item.id) || [])
    const abilityIds = new Set(detail?.abilityTags.map(item => item.id) || [])
    const branchIndex = detail?.branchId
      ? Math.max(0, branchOptions.findIndex(item => item.id === detail.branchId))
      : 0
    const cityIndex = detail?.city?.id
      ? Math.max(0, cityOptions.findIndex(item => item.id === detail.city?.id))
      : 0
    this.setData({
      catalog,
      branchOptions,
      cityOptions,
      branchIndex,
      cityIndex,
      title: detail?.title || '',
      valueSummary: detail?.valueSummary || '',
      targetSummary: detail?.targetSummary || '',
      description: detail?.description || '',
      scopeType: detail?.branchId ? 'BRANCH' : 'PLATFORM',
      branchId: detail?.branchId || '',
      cityTagId: detail?.city?.id || '',
      coverAssetId: detail?.coverAssetId || '',
      coverUrl: detail?.coverUrl || '',
      version: detail?.version || 0,
      roleOptions: cooperationRoles.map(item => ({ key: item.key, name: item.name, selected: roleKeys.has(item.key) })),
      industryGroups: catalog.industryGroups.map(group => ({
        id: group.id,
        label: group.label,
        options: group.options.map(item => ({ id: item.id, label: item.label, selected: industryIds.has(item.id) })),
      })),
      abilityOptions: catalog.abilityTags.map(item => ({ id: item.id, label: item.label, selected: abilityIds.has(item.id) })),
    })
  },

  updateText(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['title', 'valueSummary', 'targetSummary', 'description'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value })
  },

  chooseScope(event: WechatMiniprogram.TouchEvent) {
    const scopeType = String(event.currentTarget.dataset.scope || '') as 'PLATFORM' | 'BRANCH'
    if (!['PLATFORM', 'BRANCH'].includes(scopeType)) {
      return
    }
    this.setData({
      scopeType,
      branchId: scopeType === 'PLATFORM' ? '' : this.data.branchId,
      branchIndex: scopeType === 'PLATFORM' ? 0 : this.data.branchIndex,
    })
  },

  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branchOptions[branchIndex]
    if (!branch) {
      return
    }
    this.setData({ branchIndex, branchId: branch.id as BranchId | '', scopeType: branch.id ? 'BRANCH' : 'PLATFORM' })
  },

  changeCity(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const cityIndex = Number(event.detail.value)
    const city = this.data.cityOptions[cityIndex]
    if (city) {
      this.setData({ cityIndex, cityTagId: city.id })
    }
  },

  toggleRole(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '')
    this.setData({ roleOptions: this.data.roleOptions.map(item => item.key === key ? { ...item, selected: !item.selected } : item) })
  },

  toggleTag(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type || '')
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || !['industry', 'ability'].includes(type)) {
      return
    }
    if (type === 'industry') {
      this.setData({
        industryGroups: this.data.industryGroups.map(group => ({
          ...group,
          options: group.options.map(item => item.id === id ? { ...item, selected: !item.selected } : item),
        })),
      })
    }
    else {
      this.setData({ abilityOptions: this.data.abilityOptions.map(item => item.id === id ? { ...item, selected: !item.selected } : item) })
    }
  },

  async chooseCover() {
    if (this.data.coverUploading || this.data.saving) {
      return
    }
    this.setData({ coverUploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('OPPORTUNITY_COVER', sourcePath)
      this.setData({ coverAssetId: asset.assetId, coverUrl: asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '封面上传失败，请重试。' })
    }
    finally {
      this.setData({ coverUploading: false })
    }
  },

  saveDraft() { void this.save(false) },
  publish() { void this.save(true) },

  async save(publish: boolean) {
    if (this.data.saving || this.data.coverUploading) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await opportunityModule.save({
        id: this.data.id || undefined,
        expectedVersion: this.data.id ? this.data.version : undefined,
        title: this.data.title,
        valueSummary: this.data.valueSummary,
        targetSummary: this.data.targetSummary,
        description: this.data.description,
        scopeType: this.data.scopeType,
        branchId: this.data.branchId || undefined,
        cityTagId: this.data.cityTagId || undefined,
        coverAssetId: this.data.coverAssetId || undefined,
        roleKeys: this.data.roleOptions.filter(item => item.selected).map(item => item.key),
        industryTagIds: this.data.industryGroups
          .flatMap(group => group.options)
          .filter(item => item.selected)
          .map(item => item.id),
        abilityTagIds: this.data.abilityOptions.filter(item => item.selected).map(item => item.id),
        publish,
      })
      this.setData({ id: result.id, version: result.version })
      wx.showToast({ title: result.status === 'PUBLISHED' ? '机会已发布' : '草稿已保存', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '保存失败' })
    }
    finally {
      this.setData({ saving: false })
    }
  },
})
