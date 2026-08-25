import type { AdminEventDetail } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, mipAdminModule } from '../../../modules/mip-admin'
import { mipBranchesModule } from '../../../modules/mip-identity/client'
import { mipMediaModule } from '../../../modules/mip-media/client'
import { chooseSingleImage } from '../../../modules/platform/image-upload'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

interface DateTimeParts {
  date: string
  time: string
}

interface AdminContentMediaDraft {
  assetId: string
  imageUrl: string
  caption: string
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function dateTimeParts(value: string | Date): DateTimeParts {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return { date: '', time: '' }
  }
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

function localDateTimeIso(date: string, time: string) {
  const value = new Date(`${date}T${time}:00`)
  return Number.isFinite(value.getTime()) ? value.toISOString() : ''
}

function initialDraft() {
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000)
  return {
    scopeType: 'PLATFORM',
    branchId: '',
    title: '',
    summary: '',
    description: '',
    contentMedia: [] as AdminContentMediaDraft[],
    notices: '',
    coverAssetId: '',
    eventTypeKey: 'general',
    eventMode: 'OFFLINE',
    accessType: 'FREE',
    registrationPolicy: 'AUTO',
    albumEnabled: true,
    albumSubmissionPolicy: 'REVIEW',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    registrationDeadline: '',
    cancellationDeadline: '',
    venueName: '',
    address: '',
    cityName: '',
    latitude: null as number | null,
    longitude: null as number | null,
    onlineUrl: '',
    capacity: '',
    waitlistEnabled: false,
    priceYuan: '0',
    registrationSchema: [] as unknown[],
  }
}

const initial = initialDraft()
const initialStarts = dateTimeParts(initial.startsAt)
const initialEnds = dateTimeParts(initial.endsAt)

Page({
  data: {
    state: 'loading' as AdminPageState,
    eventId: '',
    eventStatus: 'DRAFT',
    version: 0,
    draft: initial,
    startsDate: initialStarts.date,
    startsTime: initialStarts.time,
    endsDate: initialEnds.date,
    endsTime: initialEnds.time,
    registrationDeadlineEnabled: false,
    registrationDeadlineDate: initialStarts.date,
    registrationDeadlineTime: initialStarts.time,
    cancellationDeadlineEnabled: false,
    cancellationDeadlineDate: initialStarts.date,
    cancellationDeadlineTime: initialStarts.time,
    branches: [] as Array<{ id: string, name: string }>,
    branchIndex: -1,
    canChangeScope: false,
    canSelectBranch: false,
    saving: false,
    conflict: false,
    cancelDialogVisible: false,
    cancelConflict: false,
    cancelReason: '',
    cancelBusy: false,
    coverUrl: '',
    coverUploading: false,
    contentUploading: false,
    message: '',
  },
  onLoad(query: Record<string, string>) {
    const eventId = query.eventId || query.id || ''
    this.setData({ eventId })
    void this.loadAccessAndBranches()
    if (eventId) {
      void this.loadEvent()
    }
  },
  async loadAccessAndBranches() {
    try {
      const [session, branchSnapshot] = await Promise.all([
        mipAdminModule.getSession(),
        mipBranchesModule.load(),
      ])
      const canChangeScope = session.capabilities.some(item =>
        item.capability === 'events.write' && item.scopeType === 'PLATFORM')
      const allowedBranchIds = new Set(session.capabilities
        .filter(item => item.capability === 'events.write' && item.scopeType === 'BRANCH' && item.scopeId)
        .map(item => item.scopeId))
      const branches = branchSnapshot.branches
        .filter(item => item.status === 'ACTIVE' && (canChangeScope || allowedBranchIds.has(item.id)))
        .map(item => ({ id: item.id, name: item.name }))
      let branchId = this.data.draft.branchId
      if (!this.data.eventId && !canChangeScope && branches.length) {
        branchId = branches[0].id
      }
      const branchIndex = branches.findIndex(item => item.id === branchId)
      this.setData({
        branches,
        branchIndex,
        canChangeScope,
        canSelectBranch: canChangeScope || (!this.data.eventId && branches.length > 1),
        ...(!this.data.eventId && !canChangeScope && branchId
          ? { 'draft.scopeType': 'BRANCH', 'draft.branchId': branchId }
          : {}),
      })
      if (!this.data.eventId) {
        if (!hasCapability(session.capabilities, 'events.write') || (!canChangeScope && branches.length === 0)) {
          this.setData({ state: 'forbidden', message: '当前账号不能新建活动。' })
        }
        else {
          this.setData({ state: 'ready', message: '' })
        }
      }
    }
    catch (error) {
      if (!this.data.eventId) {
        this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '活动权限加载失败' }))
      }
    }
  },
  async loadEvent(force = false) {
    this.setData({ state: 'loading', message: '' })
    try {
      const event = await mipAdminModule.events.get(this.data.eventId, force)
      this.applyEventToForm(event)
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent: false, fallbackMessage: '活动信息加载失败' }))
    }
  },
  applyEventToForm(event: AdminEventDetail) {
    const starts = dateTimeParts(event.startsAt)
    const ends = dateTimeParts(event.endsAt)
    const registrationDeadline = event.registrationDeadline
      ? dateTimeParts(event.registrationDeadline)
      : starts
    const cancellationDeadline = event.cancellationDeadline
      ? dateTimeParts(event.cancellationDeadline)
      : starts
    const branchIndex = this.data.branches.findIndex(item => item.id === event.branchId)
    this.setData({
      state: 'ready',
      eventStatus: event.status,
      version: event.version,
      draft: this.toDraft(event),
      startsDate: starts.date,
      startsTime: starts.time,
      endsDate: ends.date,
      endsTime: ends.time,
      registrationDeadlineEnabled: Boolean(event.registrationDeadline),
      registrationDeadlineDate: registrationDeadline.date,
      registrationDeadlineTime: registrationDeadline.time,
      cancellationDeadlineEnabled: Boolean(event.cancellationDeadline),
      cancellationDeadlineDate: cancellationDeadline.date,
      cancellationDeadlineTime: cancellationDeadline.time,
      branchIndex,
      coverUrl: event.coverUrl,
      conflict: false,
      cancelConflict: false,
      message: '',
    })
  },
  toDraft(event: AdminEventDetail) {
    return {
      scopeType: event.scopeType,
      branchId: event.branchId || '',
      title: event.title,
      summary: event.summary,
      description: event.description,
      contentMedia: (event.contentMedia || []).map(item => ({ ...item })),
      notices: event.notices,
      coverAssetId: event.coverAssetId || '',
      eventTypeKey: event.eventTypeKey,
      eventMode: event.eventMode,
      accessType: event.accessType,
      registrationPolicy: event.registrationPolicy,
      albumEnabled: event.albumEnabled,
      albumSubmissionPolicy: event.albumSubmissionPolicy,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      registrationDeadline: event.registrationDeadline || '',
      cancellationDeadline: event.cancellationDeadline || '',
      venueName: event.venueName,
      address: event.address,
      cityName: event.cityName,
      latitude: event.latitude,
      longitude: event.longitude,
      onlineUrl: event.onlineUrl,
      capacity: event.capacity === null ? '' : String(event.capacity),
      waitlistEnabled: event.waitlistEnabled,
      priceYuan: event.priceCents > 0 ? (event.priceCents / 100).toFixed(2).replace(/\.00$/, '') : '0',
      registrationSchema: event.registrationSchema,
    }
  },
  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!field || !(field in this.data.draft)) {
      return
    }
    this.setData({
      [`draft.${field}`]: event.detail.value,
      ...(field === 'address' ? { 'draft.latitude': null, 'draft.longitude': null } : {}),
    })
  },

  async chooseVenue() {
    if (this.data.saving || this.data.cancelBusy) {
      return
    }
    try {
      const location = await wx.chooseLocation({})
      this.setData({
        'draft.venueName': location.name || this.data.draft.venueName,
        'draft.address': location.address || this.data.draft.address,
        'draft.latitude': location.latitude,
        'draft.longitude': location.longitude,
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('cancel')) {
        this.setData({ message: '暂时无法选择地点，请稍后重试。' })
      }
    }
  },

  async chooseCover() {
    if (this.data.coverUploading || this.data.saving || this.data.cancelBusy) {
      return
    }
    this.setData({ coverUploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('EVENT_COVER', sourcePath)
      this.setData({ 'draft.coverAssetId': asset.assetId, 'coverUrl': asset.imageUrl })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '封面上传失败，请重试。' })
    }
    finally {
      this.setData({ coverUploading: false })
    }
  },
  async chooseContentImage() {
    if (this.data.contentUploading || this.data.saving || this.data.cancelBusy) {
      return
    }
    if (this.data.draft.contentMedia.length >= 12) {
      this.setData({ message: '活动介绍图片最多 12 张。' })
      return
    }
    this.setData({ contentUploading: true, message: '' })
    try {
      const sourcePath = await chooseSingleImage()
      const asset = await mipMediaModule.uploadImageFromPath('EVENT_CONTENT', sourcePath)
      this.setData({
        'draft.contentMedia': [
          ...this.data.draft.contentMedia,
          { assetId: asset.assetId, imageUrl: asset.imageUrl, caption: '' },
        ],
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '图片上传失败，请重试。' })
    }
    finally {
      this.setData({ contentUploading: false })
    }
  },
  updateContentCaption(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    if (Number.isInteger(index) && this.data.draft.contentMedia[index]) {
      this.setData({ [`draft.contentMedia[${index}].caption`]: event.detail.value })
    }
  },
  moveContentImage(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const direction = Number(event.currentTarget.dataset.direction)
    const target = index + direction
    const media = [...this.data.draft.contentMedia]
    if (!Number.isInteger(index) || ![-1, 1].includes(direction) || !media[index] || !media[target]) {
      return
    }
    const current = media[index]
    media[index] = media[target]
    media[target] = current
    this.setData({ 'draft.contentMedia': media })
  },
  removeContentImage(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || !this.data.draft.contentMedia[index]) {
      return
    }
    this.setData({
      'draft.contentMedia': this.data.draft.contentMedia.filter((_, itemIndex) => itemIndex !== index),
    })
  },
  previewContentImage(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const urls = this.data.draft.contentMedia.map(item => item.imageUrl).filter(Boolean)
    const current = this.data.draft.contentMedia[index]?.imageUrl
    if (current && urls.length) {
      void wx.previewImage({ current, urls })
    }
  },
  choose(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field || '')
    const value = event.currentTarget.dataset.value
    if (!field || !(field in this.data.draft)) {
      return
    }
    if (field === 'accessType') {
      const accessType = String(value)
      this.setData({
        'draft.accessType': accessType,
        ...(accessType === 'PAID'
          ? { 'draft.registrationPolicy': 'AUTO', 'draft.waitlistEnabled': false }
          : { 'draft.priceYuan': '0' }),
      })
      return
    }
    this.setData({ [`draft.${field}`]: value })
  },
  chooseScope(event: WechatMiniprogram.TouchEvent) {
    if (!this.data.canChangeScope) {
      return
    }
    const scopeType = String(event.currentTarget.dataset.value || '')
    if (scopeType === 'PLATFORM') {
      this.setData({ 'branchIndex': -1, 'draft.scopeType': 'PLATFORM', 'draft.branchId': '' })
    }
    else if (scopeType === 'BRANCH' && this.data.branches.length) {
      const branchIndex = this.data.branchIndex >= 0 ? this.data.branchIndex : 0
      this.setData({
        'draft.scopeType': 'BRANCH',
        'draft.branchId': this.data.branches[branchIndex].id,
        branchIndex,
      })
    }
  },
  changeBranch(event: WechatMiniprogram.CustomEvent<{ value: string | number }>) {
    if (!this.data.canSelectBranch) {
      return
    }
    const branchIndex = Number(event.detail.value)
    const branch = this.data.branches[branchIndex]
    if (branch) {
      this.setData({ branchIndex, 'draft.scopeType': 'BRANCH', 'draft.branchId': branch.id })
    }
  },
  changeDateTimePart(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    const allowed = new Set([
      'startsDate',
      'startsTime',
      'endsDate',
      'endsTime',
      'registrationDeadlineDate',
      'registrationDeadlineTime',
      'cancellationDeadlineDate',
      'cancellationDeadlineTime',
    ])
    if (allowed.has(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },
  toggleDeadline(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (!['registrationDeadlineEnabled', 'cancellationDeadlineEnabled'].includes(field)) {
      return
    }
    this.setData({ [field]: event.detail.value === true })
  },
  toggleWaitlist(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.draft.accessType !== 'PAID') {
      this.setData({ 'draft.waitlistEnabled': event.detail.value === true })
    }
  },
  toggleAlbum(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    this.setData({ 'draft.albumEnabled': event.detail.value === true })
  },
  async save() {
    if (this.data.saving) {
      return
    }
    if (this.data.coverUploading || this.data.contentUploading) {
      return
    }
    if (this.data.conflict) {
      this.setData({ message: '活动信息已更新，请先载入最新版本。' })
      return
    }
    if (this.data.eventStatus === 'CANCELLED' || this.data.eventStatus === 'ENDED') {
      this.setData({ message: '已结束或已取消的活动不能继续编辑。' })
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const startsAt = localDateTimeIso(this.data.startsDate, this.data.startsTime)
      const endsAt = localDateTimeIso(this.data.endsDate, this.data.endsTime)
      const registrationDeadline = this.data.registrationDeadlineEnabled
        ? localDateTimeIso(this.data.registrationDeadlineDate, this.data.registrationDeadlineTime)
        : ''
      const cancellationDeadline = this.data.cancellationDeadlineEnabled
        ? localDateTimeIso(this.data.cancellationDeadlineDate, this.data.cancellationDeadlineTime)
        : ''
      if (!startsAt || !endsAt || (this.data.registrationDeadlineEnabled && !registrationDeadline)
        || (this.data.cancellationDeadlineEnabled && !cancellationDeadline)) {
        this.setData({ message: '请检查活动日期和时间。' })
        return
      }
      if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
        this.setData({ message: '结束时间必须晚于开始时间。' })
        return
      }
      if (registrationDeadline && new Date(registrationDeadline).getTime() >= new Date(startsAt).getTime()) {
        this.setData({ message: '报名截止时间必须早于活动开始时间。' })
        return
      }
      if (cancellationDeadline && new Date(cancellationDeadline).getTime() >= new Date(startsAt).getTime()) {
        this.setData({ message: '取消报名截止时间必须早于活动开始时间。' })
        return
      }
      const priceYuan = String(this.data.draft.priceYuan || '').trim()
      if (this.data.draft.accessType === 'PAID' && !/^\d+(?:\.\d{1,2})?$/.test(priceYuan)) {
        this.setData({ message: '报名价格最多保留两位小数。' })
        return
      }
      const priceCents = this.data.draft.accessType === 'PAID'
        ? Math.round(Number(priceYuan) * 100)
        : 0
      if (this.data.draft.accessType === 'PAID' && priceCents <= 0) {
        this.setData({ message: '付费活动的报名价格必须大于 0 元。' })
        return
      }
      const draft = {
        ...this.data.draft,
        startsAt,
        endsAt,
        registrationDeadline,
        cancellationDeadline,
        capacity: this.data.draft.capacity ? Number(this.data.draft.capacity) : null,
        priceCents,
      }
      delete (draft as Partial<typeof draft>).priceYuan
      const result = await mipAdminModule.events.save({
        eventId: this.data.eventId || undefined,
        expectedVersion: this.data.version || undefined,
        draft,
      })
      this.setData({ eventId: result.id, eventStatus: result.status, version: result.version, state: 'ready' })
      wx.showToast({ title: '草稿已保存', icon: 'success' })
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({
          state: 'ready',
          conflict: true,
          message: '活动信息已被其他管理员更新。本地输入已保留，请显式载入最新版本后重新编辑。',
        })
        return
      }
      const failure = adminLoadFailure(error, { hasContent: true, fallbackMessage: '保存失败' })
      this.setData({ state: failure.state || 'ready', message: failure.message })
    }
    finally {
      this.setData({ saving: false })
    }
  },
  async refreshAfterConflict() {
    if (!this.data.eventId || this.data.saving || this.data.cancelBusy) {
      return
    }
    await this.loadEvent(true)
  },
  openCancelDialog() {
    if (!this.data.eventId || this.data.eventStatus === 'CANCELLED' || this.data.cancelBusy || this.data.conflict) {
      return
    }
    this.setData({ cancelDialogVisible: true, cancelConflict: false, cancelReason: '', message: '' })
  },
  closeCancelDialog() {
    if (!this.data.cancelBusy) {
      this.setData({ cancelDialogVisible: false, cancelReason: '' })
    }
  },
  updateCancelReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ cancelReason: event.detail.value })
  },
  async confirmCancelEvent() {
    const reason = this.data.cancelReason.trim()
    if (!this.data.eventId || this.data.cancelBusy || this.data.cancelConflict || this.data.conflict) {
      return
    }
    if (!reason) {
      this.setData({ message: '请填写取消原因。' })
      return
    }
    this.setData({ cancelBusy: true, message: '' })
    try {
      const modal = await wx.showModal({
        title: '取消活动',
        content: '取消后将影响已报名参与者，请确认后继续。',
      })
      if (!modal.confirm) {
        return
      }
      const result = await mipAdminModule.events.changeStatus({
        eventId: this.data.eventId,
        expectedVersion: this.data.version,
        status: 'CANCELLED',
        reason,
      })
      this.setData({
        eventStatus: result.status,
        version: result.version,
        cancelDialogVisible: false,
        cancelReason: '',
        conflict: false,
        message: '',
      })
      wx.showToast({ title: '活动已取消', icon: 'success' })
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({
          cancelDialogVisible: false,
          cancelConflict: true,
          conflict: true,
          message: '活动版本已变化。请载入最新版本，然后重新填写取消原因。',
        })
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '活动取消失败' })
    }
    finally {
      this.setData({ cancelBusy: false })
    }
  },
  async refreshAfterCancelConflict() {
    if (!this.data.eventId || this.data.cancelBusy) {
      return
    }
    this.setData({ cancelReason: '' })
    await this.loadEvent(true)
  },
})
