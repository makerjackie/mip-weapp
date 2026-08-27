import type { AdminRequestInput } from '../domain/contracts'

export type AdminDetailRoute = 'users' | 'events' | 'orders' | 'messages' | 'knowledge' | 'opportunities'
export type AdminDetailRow = Record<string, unknown>

export interface AdminDetailField {
  label: string
  value: string
}

export interface AdminDetailSection {
  title: string
  fields?: AdminDetailField[]
  metrics?: AdminDetailField[]
  rows?: AdminDetailRow[]
  columns?: Array<{ key: string; label: string }>
}

export interface AdminDetailView {
  route: AdminDetailRoute
  title: string
  subtitle: string
  status: string
  sections: AdminDetailSection[]
}

export type AdminDetailRequest = <T>(action: string, input?: AdminRequestInput) => Promise<T>

export async function loadAdminDetail(
  route: AdminDetailRoute,
  id: string,
  request: AdminDetailRequest,
): Promise<AdminDetailView> {
  if (route === 'users') return loadUserDetail(id, request)
  if (route === 'events') return loadEventDetail(id, request)
  if (route === 'orders') return loadOrderDetail(id, request)
  if (route === 'messages') return loadMessageDetail(id, request)
  if (route === 'opportunities') return loadOpportunityDetail(id, request)
  return loadKnowledgeDetail(id, request)
}

async function loadUserDetail(userId: string, request: AdminDetailRequest): Promise<AdminDetailView> {
  const [userValue, membershipValue] = await Promise.all([
    request('mip.admin.users.get', { userId, includePhone: false }),
    request('mip.admin.memberships.get', { userId }),
  ])
  const user = record(userValue)
  const membershipDetail = record(membershipValue)
  const membership = record(user.membership)
  const growth = record(user.growth)
  const counts = record(user.counts)
  const influence = record(user.influence)
  const sections: AdminDetailSection[] = [{
    title: '基本信息',
    fields: fields([
      ['身份', codeLabel(user.kind)],
      ['账号状态', codeLabel(user.status)],
      ['手机状态', user.phoneBound === true ? '已绑定' : '未绑定'],
      ['所属分会', text(user.branchName)],
      ['城市', text(user.cityName)],
      ['简介', text(user.headline)],
      ['个人介绍', text(user.introduction)],
      ['注册时间', dateTime(user.createdAt)],
    ]),
  }]
  if (Object.keys(membership).length || membershipDetail.chainVersion !== undefined) {
    sections.push({
      title: '会员权益',
      fields: fields([
        ['权益状态', codeLabel(membership.status)],
        ['生效时间', dateTime(membership.startsAt)],
        ['到期时间', dateTime(membership.endsAt)],
        ['会员链版本', numberText(membershipDetail.chainVersion)],
      ]),
    })
  }
  if (Object.keys(growth).length) {
    sections.push({
      title: '成长数据',
      metrics: fields([
        ['当前等级', text(growth.levelName)],
        ['经验值', numberText(growth.experience)],
        ['贡献值', numberText(growth.contribution)],
        ['MIP 币', numberText(growth.coin)],
      ]),
    })
  }
  if (Object.keys(counts).length) {
    sections.push({
      title: '业务记录',
      metrics: fields([
        ['活动报名', numberText(counts.registrations)],
        ['活动签到', numberText(counts.attended)],
        ['订单', numberText(counts.orders)],
        ['合作机会', numberText(counts.opportunities)],
        ['合作卡', numberText(counts.cooperationCards)],
        ['超级案例', numberText(counts.superCases)],
      ]),
    })
  }
  if (Object.keys(influence).length) {
    sections.push({
      title: '影响力数据',
      metrics: fields([
        ['嘉宾邀请', numberText(influence.guestCount)],
        ['互动', numberText(influence.interactionCount)],
        ['心动', numberText(influence.interestCount)],
        ['访客', numberText(influence.visitorCount)],
      ]),
    })
  }
  appendUserCollections(sections, user)
  return {
    route: 'users',
    title: text(user.nickname, '用户详情'),
    subtitle: [text(user.branchName, ''), text(user.cityName, '')].filter(Boolean).join(' · '),
    status: codeLabel(user.kind),
    sections,
  }
}

function appendUserCollections(sections: AdminDetailSection[], user: AdminDetailRow) {
  const companies = records(user.companies)
  const organizations = records(user.organizations)
  if (companies.length || organizations.length) {
    sections.push({
      title: '任职信息',
      rows: [...companies.map(item => ({ type: '公司', name: text(item.name), role: text(item.role) })),
        ...organizations.map(item => ({ type: '组织', name: text(item.name), role: text(item.role) }))],
      columns: columns([['type', '类型'], ['name', '名称'], ['role', '职位']]),
    })
  }
  const tags = records(user.tags)
  if (tags.length) {
    sections.push({
      title: '标签',
      rows: tags.map(item => ({ type: codeLabel(item.kind), relation: codeLabel(item.relation), label: text(item.label) })),
      columns: columns([['type', '类型'], ['relation', '关系'], ['label', '标签']]),
    })
  }
  const roles = records(user.roles)
  if (roles.length) {
    sections.push({
      title: '运营角色',
      rows: roles.map(item => ({ role: codeLabel(item.roleKey), scope: codeLabel(item.scopeType), grantedAt: dateTime(item.grantedAt) })),
      columns: columns([['role', '角色'], ['scope', '作用范围'], ['grantedAt', '授权时间']]),
    })
  }
}

async function loadEventDetail(eventId: string, request: AdminDetailRequest): Promise<AdminDetailView> {
  const [eventValue, insightsValue, rosterValue] = await Promise.all([
    request('mip.admin.events.get', { eventId }),
    request('mip.admin.events.insights.get', { eventId }),
    request('mip.admin.events.roster', { eventId, includePhone: false, limit: 20 }),
  ])
  const event = record(eventValue)
  const insights = record(insightsValue)
  const participation = record(insights.participation)
  const composition = record(insights.composition)
  const invitations = record(insights.invitations)
  const hearts = record(insights.hearts)
  const financials = record(insights.financials)
  const feedback = record(insights.feedback)
  const roster = pageRecords(rosterValue)
  const sections: AdminDetailSection[] = [
    {
      title: '活动信息',
      fields: fields([
        ['摘要', text(event.summary)],
        ['活动说明', text(event.description)],
        ['活动须知', text(event.notices)],
        ['活动方式', codeLabel(event.eventMode)],
        ['活动类型', event.accessType === 'PAID' ? '付费' : codeLabel(event.accessType)],
        ['价格', money(event.priceCents, 'CNY')],
        ['开始时间', dateTime(event.startsAt)],
        ['结束时间', dateTime(event.endsAt)],
        ['报名截止', dateTime(event.registrationDeadline)],
        ['取消截止', dateTime(event.cancellationDeadline)],
        ['场地', text(event.venueName)],
        ['地址', text(event.address)],
        ['城市', text(event.cityName)],
        ['版本', numberText(event.version)],
        ['活动状态', codeLabel(event.status)],
      ]),
    },
    {
      title: '参与情况',
      metrics: fields([
        ['有效报名', numberText(participation.effectiveRegistrationCount)],
        ['已签到', numberText(participation.checkedInCount)],
        ['签到率', basisPoints(participation.checkInRateBasisPoints)],
        ['待审核', numberText(participation.pendingReviewCount)],
        ['候补', numberText(participation.waitlistedCount)],
        ['玩家', numberText(composition.playerCount)],
        ['嘉宾', numberText(composition.guestCount)],
      ]),
    },
    {
      title: '互动数据',
      metrics: fields([
        ['邀请报名', numberText(invitations.attributedRegistrationCount)],
        ['邀请人', numberText(invitations.distinctInviterCount)],
        ['心动用户', numberText(hearts.voterCount)],
        ['有效心动', numberText(hearts.activeVoteCount)],
        ['互选', numberText(hearts.mutualMatchCount)],
      ]),
    },
  ]
  sections.push(financialSection(financials), feedbackSection(feedback))
  sections.push({
    title: '报名名单（前 20 条）',
    rows: roster.map(item => ({
      name: text(item.nickname),
      city: text(item.cityName),
      phone: item.phoneBound === true ? '已绑定' : '未绑定',
      submittedAt: dateTime(item.submittedAt),
      checkedInAt: dateTime(item.checkedInAt),
      state: codeLabel(item.status),
    })),
    columns: columns([['name', '姓名'], ['city', '城市'], ['phone', '手机状态'], ['submittedAt', '报名时间'], ['checkedInAt', '签到时间'], ['state', '状态']]),
  })
  return {
    route: 'events',
    title: text(event.title, '活动详情'),
    subtitle: [text(event.cityName, ''), text(event.venueName, '')].filter(Boolean).join(' · '),
    status: codeLabel(event.status),
    sections,
  }
}

function financialSection(value: AdminDetailRow): AdminDetailSection {
  if (value.access !== 'GRANTED') return { title: '财务数据', fields: fields([['数据权限', '当前账号不可查看']]) }
  return {
    title: '财务数据',
    metrics: fields([
      ['已支付订单', numberText(value.paidOrderCount)],
      ['订单金额', money(value.grossAmountCents, value.currency)],
      ['已退款', money(value.refundedAmountCents, value.currency)],
      ['实收金额', money(value.netAmountCents, value.currency)],
    ]),
  }
}

function feedbackSection(value: AdminDetailRow): AdminDetailSection {
  if (value.access !== 'GRANTED') return { title: '反馈数据', fields: fields([['数据权限', '当前账号不可查看']]) }
  return {
    title: '反馈数据',
    metrics: fields([
      ['已提交', numberText(value.submissionCount)],
      ['可提交签到', numberText(value.eligibleCheckInCount)],
      ['提交率', basisPoints(value.submissionRateBasisPoints)],
      ['已评分', numberText(value.ratedCount)],
      ['平均评分', decimalText(value.averageRating)],
    ]),
  }
}

async function loadOrderDetail(orderId: string, request: AdminDetailRequest): Promise<AdminDetailView> {
  const detail = record(await request('mip.admin.orders.get', { orderId }))
  const order = record(detail.order)
  const buyer = record(detail.buyer)
  const product = record(detail.product)
  const snapshot = record(product.snapshot)
  const attemptPage = await request('mip.admin.paymentAttempts.list', {
    filters: { query: orderId },
    limit: 20,
  })
  const attempts = pageRecords(attemptPage).filter(item => item.orderId === undefined || item.orderId === orderId)
  const sections: AdminDetailSection[] = [
    {
      title: '订单信息',
      fields: fields([
        ['订单号', text(order.merchantOrderNoMasked, text(order.id))],
        ['订单类型', codeLabel(order.orderType)],
        ['订单内容', text(order.resourceTitle)],
        ['金额', money(order.amountCents, order.currency)],
        ['已退款', money(order.refundedAmountCents, order.currency)],
        ['订单状态', codeLabel(order.status)],
        ['退款状态', codeLabel(order.refundStatus)],
        ['支付时间', dateTime(order.paidAt)],
        ['创建时间', dateTime(order.createdAt)],
        ['更新时间', dateTime(order.updatedAt)],
      ]),
    },
    {
      title: '购买人',
      fields: fields([
        ['姓名', text(buyer.nickname)],
        ['身份', codeLabel(buyer.kind)],
        ['账号状态', codeLabel(buyer.accountStatus)],
        ['所属分会', text(buyer.branchName)],
        ['城市', text(buyer.cityName)],
      ]),
    },
    {
      title: '商品快照',
      fields: fields([
        ['商品名称', text(product.title)],
        ['资源类型', codeLabel(product.resourceType)],
        ['所属分会', text(product.branchName)],
        ['权益天数', numberText(snapshot.durationDays)],
        ['解锁天数', numberText(snapshot.unlockDays)],
        ['退款规则', codeLabel(snapshot.refundPolicy)],
        ['权益内容', arrayText(snapshot.benefits)],
      ]),
    },
    {
      title: '支付尝试',
      rows: attempts.map(item => ({
        provider: codeLabel(item.provider),
        paymentId: text(item.providerPaymentIdMasked),
        amount: money(item.amountCents, item.currency),
        createdAt: dateTime(item.createdAt),
        state: codeLabel(item.status),
        attention: item.requiresAttention === true ? '需要处理' : '正常',
      })),
      columns: columns([['provider', '支付渠道'], ['paymentId', '支付标识'], ['amount', '金额'], ['createdAt', '创建时间'], ['state', '状态'], ['attention', '处理状态']]),
    },
  ]
  appendOrderTimelineSections(sections, detail, order)
  return {
    route: 'orders',
    title: text(order.resourceTitle, '订单详情'),
    subtitle: text(order.merchantOrderNoMasked, text(order.id)),
    status: codeLabel(order.status),
    sections,
  }
}

async function loadMessageDetail(campaignId: string, request: AdminDetailRequest): Promise<AdminDetailView> {
  const campaign = record(await request('mip.admin.messageCampaigns.get', { campaignId }))
  const title = text(campaign.title, text(campaign.name, '消息活动'))
  const [reviewPage, deliveryPage] = await Promise.all([
    request('mip.admin.messageDeliveryReviews.list', {
      sourceType: 'CAMPAIGN_DISPATCH',
      workflowStatus: 'ALL',
      limit: 20,
    }),
    request('mip.admin.messageDeliveryRecords.list', {
      query: title,
      limit: 20,
    }),
  ])
  const reviews = pageRecords(reviewPage)
    .filter(item => record(item.evidence).campaignRef && record(record(item.evidence).campaignRef).id === campaignId)
  const reviewDetails = await Promise.all(reviews.slice(0, 5).map(item => (
    request('mip.admin.messageDeliveryReviews.get', { resourceRef: item.resourceRef })
  )))
  const stats = record(campaign.deliveryStats)
  const outbox = record(stats.outboxStats)
  const external = record(stats.externalTaskStats)
  const dispatch = record(campaign.activeDispatch)
  const sections: AdminDetailSection[] = [
    {
      title: '消息活动信息',
      fields: fields([
        ['活动名称', text(campaign.name)],
        ['消息标题', title],
        ['消息正文', text(campaign.body)],
        ['作用范围', campaign.scopeType === 'BRANCH' ? text(campaign.branchName) : '平台'],
        ['发送范围', campaign.audienceType === 'ALL' ? '全部用户' : `${numberText(campaign.recipientCount)} 人`],
        ['状态', codeLabel(campaign.status)],
        ['内容安全', codeLabel(campaign.contentSafetyStatus)],
        ['版本', numberText(campaign.version)],
        ['更新时间', dateTime(campaign.updatedAt)],
        ['发布时间', dateTime(campaign.publishedAt)],
      ]),
    },
    {
      title: '投递统计',
      metrics: fields([
        ['目标人数', numberText(campaign.recipientCount)],
        ['已提交', numberText(stats.submittedCount)],
        ['收件箱就绪', numberText(stats.inboxReadyCount)],
        ['失败', numberText(stats.failedCount)],
        ['队列待处理', numberText(outbox.pendingCount)],
        ['队列已送达', numberText(outbox.deliveredCount)],
        ['外部任务待处理', numberText(external.pendingCount)],
        ['外部任务已送达', numberText(external.deliveredCount)],
      ]),
    },
  ]
  if (Object.keys(dispatch).length) {
    sections.push({
      title: '当前投递计划',
      fields: fields([
        ['计划状态', codeLabel(dispatch.status)],
        ['计划时间', dateTime(dispatch.scheduledFor)],
        ['尝试次数', numberText(dispatch.attempts)],
        ['最近结果', codeLabel(dispatch.lastOutcome)],
        ['重试策略', codeLabel(dispatch.retryDisposition)],
        ['最近错误', text(dispatch.lastErrorCode)],
        ['计划版本', numberText(dispatch.version)],
        ['更新时间', dateTime(dispatch.updatedAt)],
      ]),
    })
  }
  sections.push({
    title: '投递记录（当前可见）',
    rows: pageRecords(deliveryPage).map(item => ({
      title: text(item.title),
      recipient: text(item.nickname),
      channel: codeLabel(item.channel),
      state: codeLabel(item.status),
      attempts: numberText(item.attempts),
      occurredAt: dateTime(item.occurredAt),
      error: text(item.lastErrorCode),
    })),
    columns: columns([
      ['title', '消息'], ['recipient', '收件人'], ['channel', '渠道'], ['state', '状态'],
      ['attempts', '尝试次数'], ['occurredAt', '发生时间'], ['error', '错误'],
    ]),
  })
  sections.push({
    title: '投递复核（当前可见）',
    rows: reviewDetails.map(value => {
      const item = record(value)
      const source = record(item.sourceState)
      const workflow = record(item.workflow)
      return {
        source: codeLabel(record(item.resourceRef).type),
        classification: codeLabel(item.classification),
        state: codeLabel(workflow.status),
        sourceState: codeLabel(source.status),
        attempts: numberText(source.attempts),
        occurredAt: dateTime(source.occurredAt),
        error: text(source.lastErrorCode),
      }
    }),
    columns: columns([
      ['source', '来源'], ['classification', '分类'], ['state', '复核状态'], ['sourceState', '投递状态'],
      ['attempts', '尝试次数'], ['occurredAt', '发生时间'], ['error', '错误'],
    ]),
  })
  return {
    route: 'messages',
    title,
    subtitle: [campaign.branchName, codeLabel(campaign.status)].filter(Boolean).join(' · '),
    status: codeLabel(campaign.status),
    sections,
  }
}

async function loadOpportunityDetail(opportunityId: string, request: AdminDetailRequest): Promise<AdminDetailView> {
  const opportunity = record(await request('mip.admin.opportunities.get', { opportunityId }))
  let commentState: AdminDetailRow | null = null
  try {
    commentState = record(await request('mip.admin.opportunityComments.get', { opportunityId }))
  }
  catch {
    commentState = null
  }
  const terms = record(opportunity.commercialTerms)
  const settings = record(commentState?.settings)
  const sections: AdminDetailSection[] = [{
    title: '机会信息',
    fields: fields([
      ['发布人', text(opportunity.ownerNickname)],
      ['作用范围', opportunity.scopeType === 'BRANCH' ? text(opportunity.branchName) : '平台'],
      ['城市', text(opportunity.cityName)],
      ['价值说明', text(opportunity.valueSummary)],
      ['合作目标', text(opportunity.targetSummary)],
      ['详细说明', text(opportunity.description)],
      ['合作角色', codeArray(opportunity.roleKeys)],
      ['标签', arrayText(opportunity.tags)],
      ['金额说明', text(terms.amountDisplay)],
      ['引荐数', numberText(opportunity.referralCount)],
      ['截止时间', dateTime(opportunity.deadlineAt)],
      ['内容安全', codeLabel(opportunity.contentSafetyStatus)],
      ['发布时间', dateTime(opportunity.publishedAt)],
      ['更新时间', dateTime(opportunity.updatedAt)],
    ]),
  }]
  const team = records(opportunity.teamMembers)
  sections.push({
    title: '组队玩家',
    rows: team.map(item => ({ name: text(item.nickname), branch: text(item.branchName) })),
    columns: columns([['name', '姓名'], ['branch', '所属分会']]),
  })
  if (commentState) {
    sections.push({
      title: '评论设置',
      fields: fields([
        ['评论', booleanText(settings.commentsEnabled)],
        ['项目评价', booleanText(settings.reviewsEnabled)],
        ['打 call', booleanText(settings.callsEnabled)],
        ['审核方式', settings.moderationMode === 'REVIEW' ? '发布前审核' : '自动发布'],
      ]),
    })
    sections.push({
      title: '评论与评价',
      rows: records(commentState.comments).map(item => ({
        author: text(item.authorNickname),
        type: codeLabel(item.type),
        body: text(item.body),
        rating: item.rating === null || item.rating === undefined ? '—' : `${numberText(item.rating)} / 5`,
        calls: numberText(item.callCount),
        createdAt: dateTime(item.createdAt),
        state: codeLabel(item.status),
      })),
      columns: columns([['author', '提交人'], ['type', '类型'], ['body', '内容'], ['rating', '评分'], ['calls', '打 call'], ['createdAt', '时间'], ['state', '状态']]),
    })
    sections.push({
      title: '评论举报',
      rows: records(commentState.reports).map(item => ({ reporter: text(item.reporterNickname), category: codeLabel(item.category), description: text(item.description), createdAt: dateTime(item.createdAt), state: codeLabel(item.status) })),
      columns: columns([['reporter', '举报人'], ['category', '分类'], ['description', '说明'], ['createdAt', '时间'], ['state', '状态']]),
    })
  }
  else {
    sections.push({ title: '评论数据', fields: fields([['数据权限', '当前账号不可查看']]) })
  }
  sections.push({
    title: '操作记录',
    rows: records(opportunity.history).map(item => ({ action: codeLabel(item.action), actor: text(item.actorNickname), createdAt: dateTime(item.createdAt) })),
    columns: columns([['action', '操作'], ['actor', '操作人'], ['createdAt', '时间']]),
  })
  return {
    route: 'opportunities',
    title: text(opportunity.title, '机会详情'),
    subtitle: [text(opportunity.ownerNickname, ''), text(opportunity.cityName, '')].filter(Boolean).join(' · '),
    status: codeLabel(opportunity.status),
    sections,
  }
}

async function loadKnowledgeDetail(contentId: string, request: AdminDetailRequest): Promise<AdminDetailView> {
  const [contentValue, schedulesValue] = await Promise.all([
    request('mip.admin.knowledge.get', { contentId }),
    request('mip.admin.knowledge.schedules.list', { limit: 20 }),
  ])
  const content = record(contentValue)
  const category = record(content.category)
  const source = record(content.source)
  const product = record(content.product)
  const sections: AdminDetailSection[] = [{
    title: '内容信息',
    fields: fields([
      ['标题', text(content.title, '知识内容')],
      ['内容类型', codeLabel(content.contentType)],
      ['摘要', text(content.summary)],
      ['作者', text(content.authorName)],
      ['分类', text(category.name)],
      ['来源', text(source.name)],
      ['访问范围', codeLabel(content.accessType)],
      ['状态', codeLabel(content.status)],
      ['内容安全', codeLabel(content.contentSafetyStatus)],
      ['更新时间', dateTime(content.updatedAt)],
      ['发布时间', dateTime(content.publishedAt)],
      ['审核时间', dateTime(content.reviewedAt)],
      ['审核说明', text(content.reviewReason)],
      ['外部链接', text(content.externalUrl)],
      ['正文', text(content.bodyText)],
    ]),
  }]
  if (Object.keys(product).length) {
    sections.push({
      title: '付费内容配置',
      fields: fields([
        ['商品名称', text(product.name)],
        ['价格', money(product.priceCents, product.currency)],
        ['目录阶段', codeLabel(product.catalogStage)],
        ['商品状态', codeLabel(product.status)],
        ['解锁天数', numberText(product.unlockDays)],
        ['退款规则', codeLabel(product.refundPolicy)],
        ['退款窗口', product.refundWindowHours === undefined ? '—' : `${numberText(product.refundWindowHours)} 小时`],
      ]),
    })
  }
  sections.push({
    title: '内容设置',
    fields: fields([
      ['评论功能', content.commentsEnabled === true ? '已开启' : '未开启'],
      ['审核模式', codeLabel(content.moderationMode)],
      ['设置版本', numberText(content.settingsVersion)],
      ['视频号用户', text(content.channelFinderUserName)],
      ['视频号 Feed', text(content.channelFeedId)],
      ['封面素材', text(content.coverAssetId)],
    ]),
  })
  sections.push({
    title: '知识库同步计划（当前可见）',
    rows: pageRecords(schedulesValue).map(item => {
      const scheduleSource = record(item.source)
      const scheduleCategory = record(item.category)
      return {
        source: text(scheduleSource.name),
        type: codeLabel(scheduleSource.sourceType),
        category: text(scheduleCategory.name),
        time: `${text(item.dailyTime)} ${text(item.timeZone)}`,
        nextRunAt: dateTime(item.nextRunAt),
        state: codeLabel(item.status),
        lastError: text(item.lastErrorCode),
      }
    }),
    columns: columns([
      ['source', '来源'], ['type', '来源类型'], ['category', '分类'], ['time', '执行时间'],
      ['nextRunAt', '下次执行'], ['state', '状态'], ['lastError', '最近错误'],
    ]),
  })
  return {
    route: 'knowledge',
    title: text(content.title, '知识内容详情'),
    subtitle: [text(category.name, ''), codeLabel(content.status)].filter(Boolean).join(' · '),
    status: codeLabel(content.status),
    sections,
  }
}

function appendOrderTimelineSections(sections: AdminDetailSection[], detail: AdminDetailRow, order: AdminDetailRow) {
  const refunds = records(detail.refunds)
  if (refunds.length) {
    sections.push({
      title: '退款记录',
      rows: refunds.map(item => ({ amount: money(item.amountCents, item.currency || order.currency), reason: text(item.reason), createdAt: dateTime(item.createdAt), state: codeLabel(item.status) })),
      columns: columns([['amount', '金额'], ['reason', '原因'], ['createdAt', '创建时间'], ['state', '状态']]),
    })
  }
  const entitlements = records(detail.entitlementTimeline)
  if (entitlements.length) {
    sections.push({
      title: '权益记录',
      rows: entitlements.map(item => ({ kind: codeLabel(item.kind), startsAt: dateTime(item.startsAt), endsAt: dateTime(item.endsAt), state: codeLabel(item.status) })),
      columns: columns([['kind', '权益类型'], ['startsAt', '开始时间'], ['endsAt', '结束时间'], ['state', '状态']]),
    })
  }
  const timeline = records(detail.statusTimeline)
  if (timeline.length) {
    sections.push({
      title: '状态记录',
      rows: timeline.map(item => ({ occurredAt: dateTime(item.occurredAt), state: codeLabel(item.status), evidence: codeLabel(item.evidence) })),
      columns: columns([['occurredAt', '时间'], ['state', '状态'], ['evidence', '依据']]),
    })
  }
}

function pageRecords(value: unknown) {
  return records(record(value).items)
}

function records(value: unknown): AdminDetailRow[] {
  return Array.isArray(value)
    ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as AdminDetailRow[]
    : []
}

function record(value: unknown): AdminDetailRow {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as AdminDetailRow : {}
}

function fields(entries: Array<[string, string]>): AdminDetailField[] {
  return entries.map(([label, value]) => ({ label, value }))
}

function columns(entries: Array<[string, string]>) {
  return entries.map(([key, label]) => ({ key, label }))
}

function text(value: unknown, fallback = '—') {
  return value === undefined || value === null || value === '' ? fallback : String(value)
}

function numberText(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN') : '—'
}

function decimalText(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'
}

function dateTime(value: unknown) {
  const date = new Date(String(value || ''))
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-CN', { hour12: false })
}

function money(value: unknown, currency: unknown) {
  const cents = Number(value)
  if (!Number.isFinite(cents)) return '—'
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: text(currency, 'CNY') }).format(cents / 100)
}

function basisPoints(value: unknown) {
  const points = Number(value)
  return Number.isFinite(points) ? `${(points / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%` : '—'
}

function arrayText(value: unknown) {
  return Array.isArray(value) && value.length ? value.map(item => String(item)).join('、') : '—'
}

function codeArray(value: unknown) {
  return Array.isArray(value) && value.length ? value.map(codeLabel).join('、') : '—'
}

function booleanText(value: unknown) {
  return value === true ? '已开启' : value === false ? '未开启' : '—'
}

const codeLabels: Record<string, string> = {
  ACTIVE: '启用', INACTIVE: '未生效', SCHEDULED: '待生效', PENDING: '待处理', EXPIRED: '已过期',
  REVOKED: '已撤销', REFUNDED: '已退款', BLOCKED: '已限制', CLOSED: '已关闭',
  PLAYER: '玩家', GUEST: '嘉宾', PLATFORM: '平台', BRANCH: '分会', EVENT: '活动',
  DRAFT: '草稿', PUBLISHED: '已发布', UNPUBLISHED: '已下架', CANCELLED: '已取消', ENDED: '已结束', ARCHIVED: '已归档',
  FREE: '免费', MEMBER_INCLUDED: '会员权益', PAID: '已支付', OFFLINE: '线下', ONLINE: '线上', HYBRID: '线上与线下',
  CREATED: '待支付', PAYMENT_CREATED: '支付处理中', FAILED: '失败', REFUND_PENDING: '退款处理中', PARTIALLY_REFUNDED: '部分退款',
  MEMBERSHIP: '会员订单', CONTENT: '内容订单', MEMBERSHIP_PLAN: '会员方案', KNOWLEDGE_CONTENT: '知识内容',
  WECHAT_PAY: '微信支付', TEST: '测试支付', PARAMETERS_ISSUED: '支付参数已生成', SUCCEEDED: '成功',
  BEFORE_ACCESS: '访问前可退款', NON_REFUNDABLE: '不可退款', ADMIN_ADJUSTMENT: '人工开通', ORDER: '购买',
  PLATFORM_OWNER: '平台负责人', PLATFORM_OPERATIONS: '平台运营', PLATFORM_FINANCE: '平台财务',
  BRANCH_ADMIN: '分会管理员', EVENT_OWNER: '活动负责人', EVENT_MANAGER: '活动管理员', EVENT_STAFF: '活动工作人员',
  PENDING_REVIEW: '待审核', WAITLISTED: '候补', PAYMENT_PENDING: '待支付', REGISTERED: '已报名', CANCELLATION_PENDING: '取消处理中', REJECTED: '已拒绝', ATTENDED: '已签到',
  ORDER_CREATED: '订单创建', PAYMENT_CONFIRMED: '支付确认', ORDER_CLOSED: '订单关闭', REFUND_CREATED: '退款创建', REFUND_COMPLETED: '退款完成',
  connector: '皮条客', business_builder: '生意佬', capital_operator: '暴发户', strategist: '狗策划', visual_designer: '死美工', delivery_lead: '老保姆',
  COMMENT: '评论', REVIEW: '项目评价', HIDDEN: '已隐藏', APPROVED: '已通过',
  SPAM: '垃圾信息', HARASSMENT: '骚扰行为', FRAUD: '欺诈风险', INAPPROPRIATE_CONTENT: '不当内容', IMPERSONATION: '冒充他人', OTHER: '其他问题',
  'admin.opportunities.create': '创建机会', 'admin.opportunities.update': '更新机会', 'admin.opportunities.publish': '发布机会',
  'admin.opportunities.end': '结束机会', 'admin.opportunities.unpublish': '下架机会', 'admin.opportunities.archive': '归档机会',
}

function codeLabel(value: unknown) {
  const code = text(value, '')
  return codeLabels[code] || code || '—'
}
