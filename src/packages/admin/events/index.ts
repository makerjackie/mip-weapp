import type {
  ActivityType,
  AdminEventDraft,
  AdminEventItem,
  AdminRegistrationQuestion,
  AdminRegistrationQuestionType,
  EventMode,
  RegistrationMode,
} from '../../../modules/admin/types'
import type { AdminPageState } from '../shared/page-state'
import { adminModule } from '../../../modules/admin/client'
import { AdminGatewayError } from '../../../modules/admin/cloudbase-gateway'
import { caseNavigateTo, caseRedirectTo } from '../../../modules/platform/case-navigation'
import {
  chooseSingleImage,
  compressImageToBase64,
  IMAGE_UPLOAD_POLICIES,
} from '../../../modules/platform/image-upload'
import { formatLocalDate, formatLocalDateTime, formatLocalTime } from '../../../utils/date'
import { adminLoadFailure } from '../shared/page-state'

type AuthorableActivityType = ActivityType

interface DisplayAdminEvent extends AdminEventItem {
  startsText: string
  endsText: string
  deadlineText: string
  placeText: string
  activityTypeText: string
  statusText: string
  canComplete: boolean
}

interface AdminQuestionDraft extends AdminRegistrationQuestion {
  optionsText: string
  profileFieldIndex: number
}

const profileFields = [
  null,
  'nickname',
  'phone',
  'city',
  'organization',
  'roleTitle',
  'industry',
] as const

const profileFieldLabels = [
  '不关联名片',
  '昵称',
  '手机号',
  '城市',
  '机构',
  '职位',
  '行业',
]

const profileQuestionPresets = {
  nickname: { label: '姓名或称呼', profileField: 'nickname' },
  phone: { label: '联系电话', profileField: 'phone' },
  city: { label: '所在城市', profileField: 'city' },
  organization: { label: '所在机构', profileField: 'organization' },
  roleTitle: { label: '职位', profileField: 'roleTitle' },
} as const

const statusLabels: Record<AdminEventItem['status'], string> = {
  DRAFT: '草稿',
  PUBLISHED: '已发布',
  CANCELLED: '已取消',
  COMPLETED: '已结束',
}

const activityTypeLabels: Record<ActivityType, string> = {
  PUBLIC_FREE: '公开免费',
  MEMBER_INCLUDED: '会员包含',
  PAID: '独立付费',
}

function tomorrowDate() {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return formatLocalDate(tomorrow)
}

function initialDraft() {
  const date = tomorrowDate()
  return {
    activityType: 'PUBLIC_FREE' as AuthorableActivityType,
    registrationMode: 'AUTO' as RegistrationMode,
    waitlistEnabled: true,
    eventMode: 'OFFLINE' as EventMode,
    eventDate: date,
    eventTime: '19:30',
    endDate: date,
    endTime: '21:00',
    deadlineDate: date,
    deadlineTime: '18:00',
    hasDeadline: true,
    venueName: '',
    address: '',
    latitude: null as number | null,
    longitude: null as number | null,
    onlineUrl: '',
    capacity: '30',
    cancellationPolicy: '',
    notices: '',
    description: '',
    priceYuan: '0.10',
    albumEnabled: true,
    albumRequiresReview: true,
    questions: [] as AdminQuestionDraft[],
    title: '',
    coverAssetId: '' as string,
    coverPreviewUrl: '',
    uploadingCover: false,
    version: 0,
  }
}

function combineLocalIso(date: string, time: string) {
  if (!date || !time) {
    return ''
  }
  return `${date}T${time}:00+08:00`
}

function placeText(item: AdminEventItem) {
  if (item.eventMode === 'ONLINE') {
    return '线上活动'
  }
  if (item.venueName && item.address) {
    return `${item.venueName} · ${item.address}`
  }
  return item.venueName || item.address || item.location || '地点待补充'
}

function displayEvents(events: AdminEventItem[]): DisplayAdminEvent[] {
  const now = Date.now()
  return events.map(item => ({
    ...item,
    startsText: formatLocalDateTime(item.startsAt),
    endsText: item.endsAt ? formatLocalDateTime(item.endsAt) : '',
    deadlineText: item.registrationDeadline ? formatLocalDateTime(item.registrationDeadline) : '未设置截止',
    placeText: placeText(item),
    activityTypeText: activityTypeLabels[item.activityType] || activityTypeLabels.PUBLIC_FREE,
    statusText: statusLabels[item.status],
    canComplete: item.status === 'PUBLISHED'
      && Boolean(item.endsAt)
      && new Date(item.endsAt).getTime() <= now,
  }))
}

function isAuthorableType(value: string): value is AuthorableActivityType {
  return value === 'PUBLIC_FREE' || value === 'MEMBER_INCLUDED' || value === 'PAID'
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    questionTypeLabels: ['简短文本', '长文本', '数字', '手机号', '身份证号', '单选', '多选', '确认项'],
    profileFieldLabels,
    events: [] as DisplayAdminEvent[],
    canCreate: false,
    pendingEditId: '',
    pendingCreate: false,
    pendingSection: '',
    editorVisible: false,
    editingId: '',
    editingStatus: 'DRAFT' as AdminEventItem['status'],
    editingCanComplete: false,
    editingCanDuplicate: false,
    conflict: false,
    ...initialDraft(),
    saving: false,
    processingId: '',
    message: '',
    cancelDialogVisible: false,
    cancelEventId: '',
    cancelEventTitle: '',
    cancelEventVersion: 0,
    cancelReason: '',
    cancelling: false,
    /** Version conflict on cancel: submit locked until operator refreshes and reopens confirm. */
    cancelConflict: false,
  },

  onShow() {
    void this.loadEvents()
  },

  onLoad(query: Record<string, string>) {
    this.setData({
      pendingEditId: query.eventId || '',
      pendingCreate: query.mode === 'create' || !query.eventId,
      pendingSection: query.section || '',
    })
  },

  updateDraft(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    const allowed = [
      'title',
      'venueName',
      'address',
      'description',
      'notices',
      'capacity',
      'cancellationPolicy',
      'priceYuan',
      'onlineUrl',
    ]
    if (allowed.includes(field)) {
      this.setData({ [field]: event.detail.value, conflict: false })
    }
  },

  chooseActivityType(event: WechatMiniprogram.TouchEvent) {
    const activityType = String(event.currentTarget.dataset.type || '')
    if (!isAuthorableType(activityType)) {
      return
    }
    this.setData({
      activityType,
      registrationMode: activityType === 'PAID' ? 'AUTO' : this.data.registrationMode,
      waitlistEnabled: activityType === 'PAID' ? false : this.data.waitlistEnabled,
      conflict: false,
      message: '',
    })
  },

  chooseRegistrationMode(event: WechatMiniprogram.TouchEvent) {
    const registrationMode = String(event.currentTarget.dataset.mode || '')
    if (this.data.activityType === 'PAID'
      || (registrationMode !== 'AUTO' && registrationMode !== 'APPROVAL')) {
      return
    }
    this.setData({
      registrationMode: registrationMode as RegistrationMode,
      conflict: false,
      message: '',
    })
  },

  toggleWaitlist(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    if (this.data.activityType === 'PAID') {
      return
    }
    this.setData({
      waitlistEnabled: Boolean(event.detail.value),
      conflict: false,
      message: '',
    })
  },

  chooseEventMode(event: WechatMiniprogram.TouchEvent) {
    const eventMode = String(event.currentTarget.dataset.mode || '')
    if (!['OFFLINE', 'ONLINE', 'HYBRID'].includes(eventMode)) {
      return
    }
    this.setData({
      eventMode: eventMode as EventMode,
      conflict: false,
      message: '',
    })
  },

  async chooseLocation() {
    try {
      const result = await wx.chooseLocation({})
      this.setData({
        venueName: result.name || this.data.venueName,
        address: result.address || this.data.address,
        latitude: result.latitude,
        longitude: result.longitude,
        conflict: false,
        message: '',
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!/cancel/i.test(message)) {
        this.setData({ message: '地图选点失败，请稍后重试。' })
      }
    }
  },

  chooseDate(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['eventDate', 'endDate', 'deadlineDate'].includes(field)) {
      this.setData({ [field]: event.detail.value, conflict: false })
    }
  },

  chooseTime(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['eventTime', 'endTime', 'deadlineTime'].includes(field)) {
      this.setData({ [field]: event.detail.value, conflict: false })
    }
  },

  toggleDeadline() {
    this.setData({ hasDeadline: !this.data.hasDeadline, conflict: false })
  },

  toggleAlbum() {
    this.setData({ albumEnabled: !this.data.albumEnabled, conflict: false })
  },

  toggleAlbumReview() {
    this.setData({ albumRequiresReview: !this.data.albumRequiresReview, conflict: false })
  },

  async chooseCover() {
    if (this.data.uploadingCover) {
      return
    }
    this.setData({ uploadingCover: true, message: '' })
    try {
      const selected = await chooseSingleImage()
      const base64 = await compressImageToBase64(selected, IMAGE_UPLOAD_POLICIES.eventCover)
      const result = await adminModule.uploadEventCover(base64, this.data.editingId)
      this.setData({
        coverAssetId: result.assetId,
        coverPreviewUrl: result.coverUrl,
        conflict: false,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '活动封面上传失败' })
    }
    finally {
      this.setData({ uploadingCover: false })
    }
  },

  addQuestion() {
    if (this.data.questions.length >= 12) {
      this.setData({ message: '每个活动最多设置 12 个报名问题。' })
      return
    }
    const next = this.data.questions.length + 1
    this.setData({
      questions: [...this.data.questions, {
        id: `question_${Date.now()}_${next}`,
        label: '',
        description: '',
        type: 'SHORT_TEXT',
        required: false,
        options: [],
        profileField: null,
        privacy: 'ORGANIZER_ONLY',
        sortOrder: this.data.questions.length,
        optionsText: '',
        profileFieldIndex: 0,
      }],
      conflict: false,
      message: '',
    })
  },

  addPresetQuestion(event: WechatMiniprogram.BaseEvent) {
    const key = String(event.currentTarget.dataset.preset || '') as keyof typeof profileQuestionPresets
    const preset = profileQuestionPresets[key]
    if (!preset || this.data.questions.length >= 12) {
      this.setData({ message: '每个活动最多设置 12 个报名问题。' })
      return
    }
    if (this.data.questions.some(question => question.profileField === preset.profileField)) {
      this.setData({ message: `${preset.label}已经在报名问题中。` })
      return
    }
    const profileFieldIndex = profileFields.indexOf(preset.profileField)
    this.setData({
      questions: [...this.data.questions, {
        id: `question_${Date.now()}_${this.data.questions.length + 1}`,
        label: preset.label,
        description: '已填写的名片信息会自动带入，报名时仍可修改。',
        type: key === 'phone' ? 'PHONE' : 'SHORT_TEXT',
        required: true,
        options: [],
        profileField: preset.profileField,
        profileFieldIndex,
        privacy: 'ORGANIZER_ONLY',
        sortOrder: this.data.questions.length,
        optionsText: '',
      }],
      conflict: false,
      message: '',
    })
  },

  updateQuestion(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    const field = String(event.currentTarget.dataset.field || '')
    if (!Number.isInteger(index) || !this.data.questions[index]) {
      return
    }
    if (field === 'options') {
      this.setData({
        [`questions[${index}].options`]: event.detail.value
          .split(/[、,，]/)
          .map(item => item.trim())
          .filter(Boolean),
        [`questions[${index}].optionsText`]: event.detail.value,
        conflict: false,
      })
      return
    }
    if (['label', 'description'].includes(field)) {
      this.setData({ [`questions[${index}].${field}`]: event.detail.value, conflict: false })
    }
  },

  chooseQuestionType(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    const types: AdminRegistrationQuestionType[] = [
      'SHORT_TEXT',
      'LONG_TEXT',
      'NUMBER',
      'PHONE',
      'ID_CARD',
      'SINGLE_CHOICE',
      'MULTI_CHOICE',
      'BOOLEAN',
    ]
    const type = types[Number(event.detail.value)]
    if (!this.data.questions[index] || !type) {
      return
    }
    this.setData({
      [`questions[${index}].type`]: type,
      [`questions[${index}].options`]: ['SINGLE_CHOICE', 'MULTI_CHOICE'].includes(type)
        ? this.data.questions[index].options
        : [],
      conflict: false,
    })
  },

  chooseQuestionProfileField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const index = Number(event.currentTarget.dataset.index)
    const profileFieldIndex = Number(event.detail.value)
    const profileField = profileFields[profileFieldIndex]
    if (!this.data.questions[index] || profileField === undefined) {
      return
    }
    this.setData({
      [`questions[${index}].profileField`]: profileField,
      [`questions[${index}].profileFieldIndex`]: profileFieldIndex,
      conflict: false,
    })
  },

  toggleQuestionRequired(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.questions[index]) {
      return
    }
    this.setData({ [`questions[${index}].required`]: Boolean(event.detail.value), conflict: false })
  },

  removeQuestion(event: WechatMiniprogram.BaseEvent) {
    const index = Number(event.currentTarget.dataset.index)
    if (!this.data.questions[index]) {
      return
    }
    this.setData({
      questions: this.data.questions
        .filter((_, itemIndex) => itemIndex !== index)
        .map((question, sortOrder) => ({ ...question, sortOrder })),
      conflict: false,
    })
  },

  moveQuestion(event: WechatMiniprogram.BaseEvent) {
    const index = Number(event.currentTarget.dataset.index)
    const direction = Number(event.currentTarget.dataset.direction)
    const target = index + direction
    if (!this.data.questions[index] || target < 0 || target >= this.data.questions.length) {
      return
    }
    const questions = [...this.data.questions]
    const [question] = questions.splice(index, 1)
    questions.splice(target, 0, question)
    this.setData({
      questions: questions.map((item, sortOrder) => ({ ...item, sortOrder })),
      conflict: false,
    })
  },

  async loadEvents(force = false) {
    const cached = adminModule.peekEvents()
    if (cached) {
      this.setData({ state: 'ready', events: displayEvents(cached), message: this.data.conflict ? this.data.message : '' })
    }
    else if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const [events, session] = await Promise.all([
        adminModule.listEvents({ force }),
        adminModule.getSession({ force }),
      ])
      // On version conflict, only refresh the list. Never merge the latest version
      // into a form that still holds stale content — that would let a retry overwrite.
      this.setData({
        state: 'ready',
        events: displayEvents(events),
        canCreate: session.capabilities.includes('events'),
      })
      if (this.data.pendingEditId) {
        const selected = events.find(item => item.id === this.data.pendingEditId)
        const pendingSection = this.data.pendingSection
        this.setData({ pendingEditId: '', pendingSection: '' })
        if (selected) {
          this.applyEventToForm(selected)
          setTimeout(() => {
            wx.pageScrollTo({
              scrollTop: pendingSection === 'actions' ? 100000 : 0,
              duration: 0,
            })
          }, 0)
        }
      }
      else if (this.data.pendingCreate) {
        this.setData({ pendingCreate: false })
        this.startCreate()
      }
    }
    catch (error) {
      this.setData(adminLoadFailure(error, {
        hasContent: Boolean(cached) || this.data.state === 'ready',
        fallbackMessage: '活动列表加载失败',
      }))
    }
  },

  startCreate() {
    if (!this.data.canCreate) {
      this.setData({ message: '活动管理员只能编辑已分配的活动。' })
      return
    }
    this.setData({
      editorVisible: true,
      editingId: '',
      editingStatus: 'DRAFT',
      editingCanComplete: false,
      editingCanDuplicate: false,
      conflict: false,
      ...initialDraft(),
      message: '',
    })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  async onPullDownRefresh() {
    try {
      await this.loadEvents(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  buildDraftPayload(): AdminEventDraft | null {
    const title = this.data.title.trim()
    const venueName = this.data.venueName.trim()
    const address = this.data.address.trim()
    if (!title) {
      this.setData({ message: '请填写活动标题。' })
      return null
    }
    if (this.data.eventMode !== 'ONLINE' && !venueName && !address) {
      this.setData({ message: '请填写场地名称或详细地址。' })
      return null
    }
    const onlineUrl = this.data.onlineUrl.trim()
    if (this.data.eventMode !== 'OFFLINE' && !/^https:\/\//i.test(onlineUrl)) {
      this.setData({ message: '线上或混合活动请填写 HTTPS 会议链接。' })
      return null
    }
    const startsAt = combineLocalIso(this.data.eventDate, this.data.eventTime)
    const endsAt = combineLocalIso(this.data.endDate, this.data.endTime)
    if (!startsAt || !endsAt) {
      this.setData({ message: '请完整选择开始和结束时间。' })
      return null
    }
    const capacityRaw = this.data.capacity.trim()
    const capacity = capacityRaw ? Number(capacityRaw) : 30
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 10000) {
      this.setData({ message: '名额需为 1 至 10000 的整数。' })
      return null
    }
    if (!isAuthorableType(this.data.activityType)) {
      this.setData({ message: '请选择活动类型。' })
      return null
    }
    const priceCents = this.data.activityType === 'PAID'
      ? Math.round(Number(this.data.priceYuan) * 100)
      : 0
    if (this.data.activityType === 'PAID' && (!Number.isInteger(priceCents) || priceCents < 1)) {
      this.setData({ message: '请填写有效的活动价格。' })
      return null
    }
    const registrationSchema = this.data.questions.map((question, index) => {
      const {
        optionsText: _optionsText,
        profileFieldIndex: _profileFieldIndex,
        ...schema
      } = question
      return {
        ...schema,
        label: question.label.trim(),
        description: question.description.trim(),
        sortOrder: index,
      }
    })
    if (registrationSchema.some(question => !question.label)) {
      this.setData({ message: '请填写所有报名问题的标题。' })
      return null
    }

    const payload: AdminEventDraft = {
      title,
      description: this.data.description.trim(),
      notices: this.data.notices.trim(),
      registrationSchema,
      albumEnabled: this.data.albumEnabled,
      albumRequiresReview: this.data.albumRequiresReview,
      registrationMode: this.data.activityType === 'PAID' ? 'AUTO' : this.data.registrationMode,
      waitlistEnabled: this.data.activityType === 'PAID' ? false : this.data.waitlistEnabled,
      eventMode: this.data.eventMode,
      startsAt,
      endsAt,
      registrationDeadline: this.data.hasDeadline
        ? combineLocalIso(this.data.deadlineDate, this.data.deadlineTime) || null
        : null,
      venueName,
      address,
      location: this.data.eventMode === 'ONLINE' ? '线上活动' : (venueName || address),
      latitude: this.data.eventMode === 'ONLINE' ? null : this.data.latitude,
      longitude: this.data.eventMode === 'ONLINE' ? null : this.data.longitude,
      onlineUrl: this.data.eventMode === 'OFFLINE' ? '' : onlineUrl,
      capacity,
      cancellationPolicy: this.data.cancellationPolicy.trim(),
      activityType: this.data.activityType,
      priceCents,
    }
    if (this.data.coverAssetId) {
      payload.coverAssetId = this.data.coverAssetId
    }
    if (this.data.editingId) {
      payload.id = this.data.editingId
      payload.version = this.data.version
    }
    return payload
  },

  async saveDraft() {
    if (this.data.saving) {
      return
    }
    // Conflict blocks mutation until the operator explicitly reloads latest content+version.
    if (this.data.conflict) {
      this.setData({
        message: '版本冲突未解决。请先点击「刷新并载入最新版本」，再保存。',
      })
      return
    }
    const payload = this.buildDraftPayload()
    if (!payload) {
      return
    }
    this.setData({ saving: true, message: '' })
    try {
      const result = await adminModule.saveEvent(payload)
      wx.showToast({
        title: this.data.editingId ? '修改已保存' : '草稿已保存',
        icon: 'success',
      })
      await caseRedirectTo({
        url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(result.id)}`,
      })
    }
    catch (error) {
      if (error instanceof AdminGatewayError && error.code === 'EVENT_VERSION_CONFLICT') {
        this.setData({
          conflict: true,
          message: '活动已被其他人更新。你的输入已保留；必须刷新并载入最新版本后才能再次保存。',
        })
        await this.loadEvents(true)
        return
      }
      this.setData({
        conflict: false,
        message: error instanceof Error ? error.message : '活动保存失败',
      })
    }
    finally {
      this.setData({ saving: false })
    }
  },

  async refreshAfterConflict() {
    // Explicit operator action: load both latest content and version into the form.
    await this.loadEvents(true)
    if (!this.data.editingId) {
      this.setData({ conflict: false, message: '列表已刷新。' })
      return
    }
    const latest = this.data.events.find(item => item.id === this.data.editingId)
    if (!latest) {
      this.setData({
        editorVisible: false,
        conflict: false,
        editingId: '',
        ...initialDraft(),
        message: '原活动已不存在，列表已刷新。',
      })
      return
    }
    this.applyEventToForm(latest)
    this.setData({
      conflict: false,
      message: '已载入最新版本，请确认内容后再次保存。',
    })
  },

  applyEventToForm(selected: AdminEventItem) {
    const startsAt = selected.startsAt ? new Date(selected.startsAt) : null
    const endsAt = selected.endsAt ? new Date(selected.endsAt) : null
    const deadline = selected.registrationDeadline ? new Date(selected.registrationDeadline) : null
    const fallbackDate = tomorrowDate()
    const activityType = isAuthorableType(selected.activityType) ? selected.activityType : 'PUBLIC_FREE'

    this.setData({
      editorVisible: true,
      editingId: selected.id,
      editingStatus: selected.status,
      editingCanComplete: Boolean((selected as DisplayAdminEvent).canComplete),
      editingCanDuplicate: Boolean(selected.canDuplicate),
      title: selected.title || '',
      activityType,
      registrationMode: selected.registrationMode,
      waitlistEnabled: selected.waitlistEnabled,
      eventMode: selected.eventMode,
      eventDate: startsAt ? formatLocalDate(startsAt) : fallbackDate,
      eventTime: startsAt ? formatLocalTime(startsAt) : '19:30',
      endDate: endsAt ? formatLocalDate(endsAt) : (startsAt ? formatLocalDate(startsAt) : fallbackDate),
      endTime: endsAt ? formatLocalTime(endsAt) : '21:00',
      hasDeadline: Boolean(deadline),
      deadlineDate: deadline ? formatLocalDate(deadline) : (startsAt ? formatLocalDate(startsAt) : fallbackDate),
      deadlineTime: deadline ? formatLocalTime(deadline) : '18:00',
      venueName: selected.venueName || '',
      address: selected.address || '',
      latitude: selected.latitude,
      longitude: selected.longitude,
      onlineUrl: selected.onlineUrl || '',
      capacity: String(selected.capacity || 30),
      cancellationPolicy: selected.cancellationPolicy || '',
      notices: selected.notices || '',
      description: selected.description || '',
      priceYuan: selected.activityType === 'PAID'
        ? (selected.priceCents / 100).toFixed(2)
        : '0.10',
      albumEnabled: selected.albumEnabled,
      albumRequiresReview: selected.albumRequiresReview,
      questions: (selected.registrationSchema || []).map(question => ({
        ...question,
        optionsText: question.options.join('、'),
        profileFieldIndex: Math.max(0, profileFields.indexOf(
          question.profileField as (typeof profileFields)[number],
        )),
      })),
      coverAssetId: selected.coverAssetId || '',
      coverPreviewUrl: selected.coverUrl || '',
      version: selected.version || 1,
      conflict: false,
      message: '',
    })
  },

  editEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    const selected = this.data.events.find(item => item.id === eventId)
    if (!selected) {
      return
    }
    this.applyEventToForm(selected)
    wx.pageScrollTo({ scrollTop: 0, duration: 300 })
  },

  async duplicateEvent(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    const selected = this.data.events.find(item => item.id === eventId)
    if (!selected || this.data.processingId || this.data.cancelling) {
      return
    }
    this.setData({ processingId: eventId, message: '' })
    try {
      const modal = await wx.showModal({
        title: '复制活动',
        content: '将复制为草稿，日期顺延，报名与相册数据不会复制。',
        confirmText: '复制',
        confirmColor: '#235B43',
      })
      if (!modal.confirm) {
        return
      }
      const result = await adminModule.duplicateEvent(eventId)
      wx.showToast({ title: '已复制为草稿', icon: 'success' })
      await caseRedirectTo({
        url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(result.id)}`,
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '复制活动失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  openRoster(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    const selected = this.data.events.find(item => item.id === eventId)
    if (!selected) {
      return
    }
    caseNavigateTo({
      url: `/packages/admin/event-registrations/index?eventId=${encodeURIComponent(selected.id)}&title=${encodeURIComponent(selected.title)}`,
    })
  },

  openManagers(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    if (!eventId) {
      return
    }
    caseNavigateTo({
      url: `/packages/admin/event-managers/index?eventId=${encodeURIComponent(eventId)}`,
    })
  },

  openAlbumReview(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    if (!eventId) {
      return
    }
    caseNavigateTo({
      url: `/packages/admin/event-album/index?eventId=${encodeURIComponent(eventId)}`,
    })
  },

  cancelEdit() {
    wx.navigateBack({
      fail: () => caseRedirectTo({ url: '/packages/admin/managed-events/index' }),
    })
  },

  async setStatus(event: WechatMiniprogram.TouchEvent) {
    const eventId = String(event.currentTarget.dataset.eventId || '')
    const status = String(event.currentTarget.dataset.status || '')
    if (!eventId || (status !== 'PUBLISHED' && status !== 'COMPLETED')) {
      return
    }
    const selected = this.data.events.find(item => item.id === eventId)
    if (!selected) {
      return
    }
    // Confirm latch before showModal so stacked taps cannot open parallel dialogs.
    if (this.data.processingId || this.data.cancelling) {
      return
    }
    this.setData({ processingId: eventId, message: '' })
    try {
      const modal = await wx.showModal({
        title: status === 'PUBLISHED' ? '发布活动' : '结束活动',
        content: status === 'PUBLISHED'
          ? '发布后会员端立即可见，请确认时间与名额无误。'
          : '结束后不再接受报名，已签到与活动相册仍会保留。',
        confirmColor: '#235B43',
      })
      if (!modal.confirm) {
        return
      }
      await adminModule.setEventStatus(
        eventId,
        status as 'PUBLISHED' | 'COMPLETED',
        selected.version || 1,
      )
      wx.showToast({ title: status === 'PUBLISHED' ? '活动已发布' : '活动已结束', icon: 'success' })
      await caseRedirectTo({
        url: `/packages/admin/event-console/index?eventId=${encodeURIComponent(eventId)}`,
      })
    }
    catch (error) {
      if (error instanceof AdminGatewayError && error.code === 'EVENT_VERSION_CONFLICT') {
        this.setData({
          message: status === 'PUBLISHED'
            ? '活动版本已变化，请刷新列表后再发布。'
            : '活动版本已变化，请刷新列表后再结束活动。',
        })
        await this.loadEvents(true)
        return
      }
      this.setData({ message: error instanceof Error ? error.message : '状态更新失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  openCancelDialog(event: WechatMiniprogram.TouchEvent) {
    if (this.data.cancelling || this.data.processingId) {
      return
    }
    // After version conflict, operator must refresh list first, then reopen confirm explicitly.
    if (this.data.cancelConflict) {
      this.setData({
        message: '取消确认已失效。请先刷新列表，再重新打开取消确认。',
      })
      return
    }
    const eventId = String(event.currentTarget.dataset.eventId || '')
    const selected = this.data.events.find(item => item.id === eventId)
    if (!selected || (selected.status !== 'PUBLISHED' && selected.status !== 'DRAFT')) {
      return
    }
    this.setData({
      cancelDialogVisible: true,
      cancelEventId: selected.id,
      cancelEventTitle: selected.title,
      cancelEventVersion: selected.version || 1,
      cancelReason: '',
      cancelConflict: false,
      message: '',
    })
  },

  closeCancelDialog() {
    if (this.data.cancelling) {
      return
    }
    this.setData({
      cancelDialogVisible: false,
      cancelEventId: '',
      cancelEventTitle: '',
      cancelEventVersion: 0,
      cancelReason: '',
    })
  },

  updateCancelReason(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ cancelReason: event.detail.value })
  },

  async refreshAfterCancelConflict() {
    await this.loadEvents(true)
    this.setData({
      cancelConflict: false,
      cancelDialogVisible: false,
      cancelEventId: '',
      cancelEventTitle: '',
      cancelEventVersion: 0,
      cancelReason: '',
      message: '列表已刷新。请重新打开取消确认并填写原因。',
    })
  },

  async confirmCancelEvent() {
    if (this.data.cancelling || this.data.processingId) {
      return
    }
    if (this.data.cancelConflict) {
      this.setData({
        message: '取消确认已失效。请先刷新列表，再重新打开取消确认。',
      })
      return
    }
    const eventId = this.data.cancelEventId
    const reason = this.data.cancelReason.trim()
    const expectedVersion = this.data.cancelEventVersion
    if (!eventId) {
      return
    }
    if (reason.length < 1 || reason.length > 500) {
      this.setData({ message: '取消原因需为 1 至 500 个字符。' })
      return
    }
    // Latch before network so double-submit cannot race.
    this.setData({ cancelling: true, message: '' })
    try {
      const result = await adminModule.cancelEvent(eventId, reason, expectedVersion)
      this.setData({
        cancelDialogVisible: false,
        cancelEventId: '',
        cancelEventTitle: '',
        cancelEventVersion: 0,
        cancelReason: '',
        cancelConflict: false,
        message: result.refundSubmitFailedCount
          ? `活动已取消，${result.refundSubmitFailedCount} 笔退款待在订单页重试。`
          : (result.refundIds.length
              ? `活动已取消，${result.refundIds.length} 笔退款已提交。`
              : `活动已取消，已处理 ${result.affectedCount} 条有效报名。`),
      })
      await this.loadEvents(true)
      await caseRedirectTo({ url: '/packages/admin/managed-events/index' })
    }
    catch (error) {
      if (error instanceof AdminGatewayError && error.code === 'EVENT_VERSION_CONFLICT') {
        // Close dialog, lock submit, drop stale reason/version. Never auto-adopt latest version.
        this.setData({
          cancelDialogVisible: false,
          cancelConflict: true,
          cancelEventId: '',
          cancelEventTitle: '',
          cancelEventVersion: 0,
          cancelReason: '',
          message: '活动版本已变化。请刷新列表后重新打开取消确认。',
        })
        return
      }
      this.setData({
        message: error instanceof Error ? error.message : '取消活动失败',
      })
    }
    finally {
      this.setData({ cancelling: false })
    }
  },
})
