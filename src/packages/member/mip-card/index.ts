import type { IdentityAccessSnapshot, MipProfileSnapshot, PublicMipProfile } from '../../../modules/mip-identity'
import { mipAiModule } from '../../../modules/mip-ai/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

type CardStyleKey = 'PINK' | 'BLUE' | 'WHITE' | 'YELLOW'

interface Canvas2dNode {
  width: number
  height: number
  createImage: () => WechatMiniprogram.Image
  getContext: (type: '2d') => WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
  requestAnimationFrame?: (callback: () => void) => number
}

interface CardTheme {
  key: CardStyleKey
  label: string
  asset: string
  background: string
  foreground: string
  muted: string
  codeBackground: string
}

const CARD_WIDTH = 702
const CARD_HEIGHT = 492
const GENERIC_MINI_PROGRAM_CODE = '/assets/brand/mip-mini-program-qrcode.jpg'
const themes: Record<CardStyleKey, CardTheme> = {
  PINK: {
    key: 'PINK',
    label: '暖色',
    asset: '/packages/member/assets/figma/profile/card-bg-a.jpg',
    background: '#FF5F6D',
    foreground: '#090909',
    muted: '#4A2326',
    codeBackground: '#FFFFFF',
  },
  BLUE: {
    key: 'BLUE',
    label: '蓝色',
    asset: '/packages/member/assets/figma/profile/card-bg-b.jpg',
    background: '#403BDA',
    foreground: '#FFFFFF',
    muted: '#E4E3FF',
    codeBackground: '#FFFFFF',
  },
  WHITE: {
    key: 'WHITE',
    label: '浅色',
    asset: '/packages/member/assets/figma/profile/card-bg-c-optimized.jpg',
    background: '#F5F4F0',
    foreground: '#090909',
    muted: '#575757',
    codeBackground: '#FFFFFF',
  },
  YELLOW: {
    key: 'YELLOW',
    label: '品牌色',
    asset: '',
    background: '#FCDF03',
    foreground: '#090909',
    muted: '#514A10',
    codeBackground: '#FFFFFF',
  },
}

function loadCanvasImage(canvas: Canvas2dNode, source: string) {
  return new Promise<WechatMiniprogram.Image>((resolve, reject) => {
    const image = canvas.createImage()
    image.onload = () => resolve(image)
    image.onerror = reject
    image.src = source
  })
}

function roundedRect(
  context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const bounded = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + bounded, y)
  context.lineTo(x + width - bounded, y)
  context.arcTo(x + width, y, x + width, y + bounded, bounded)
  context.lineTo(x + width, y + height - bounded)
  context.arcTo(x + width, y + height, x + width - bounded, y + height, bounded)
  context.lineTo(x + bounded, y + height)
  context.arcTo(x, y + height, x, y + height - bounded, bounded)
  context.lineTo(x, y + bounded)
  context.arcTo(x, y, x + bounded, y, bounded)
  context.closePath()
}

function compactText(value: string | undefined, fallback = '') {
  return String(value || fallback).trim().replace(/\s+/g, ' ')
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    styleKey: 'PINK' as CardStyleKey,
    theme: themes.PINK,
    themeOptions: Object.values(themes),
    nickname: '',
    initial: 'M',
    avatarUrl: '',
    digitalAvatarUrl: '',
    cardAvatarUrl: '',
    avatarSource: 'ORIGINAL' as 'ORIGINAL' | 'DIGITAL',
    memberType: 'MIP 成员',
    gender: '',
    identityStatus: '',
    branchName: '',
    industryName: '',
    companyName: '',
    roleTitle: '',
    organizationLine: '',
    phone: '',
    wechat: '',
    email: '',
    address: '',
    codeUrl: '',
    codeMessage: '',
    posterPath: '',
    generating: false,
    message: '',
  },
  profileRef: '',

  onShow() {
    void this.loadCard()
  },

  retryLoad() {
    void this.loadCard(true)
  },

  async loadCard(_force = false) {
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (!snapshot.profileRef) {
        throw new Error('公开档案引用暂时不可用')
      }
      const codePromise = this.data.codeUrl && !this.data.codeMessage
        ? Promise.resolve({ codeUrl: this.data.codeUrl })
        : mipIdentityModule.getMyProfileCardCode().catch(() => ({ codeUrl: '' }))
      const [profile, privateProfile, avatarHistory, cardCode] = await Promise.all([
        mipIdentityModule.getPublicProfile(snapshot.profileRef),
        mipIdentityModule.getProfile(),
        mipAiModule.listDigitalAvatars().catch(() => ({ items: [] })),
        codePromise,
      ])
      const digitalAvatar = avatarHistory.items.find(item => item.status === 'READY' && item.outputUrl)
      this.applyCard(snapshot, profile, privateProfile, digitalAvatar?.outputUrl || '', cardCode.codeUrl)
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '名片加载失败' })
    }
  },

  applyCard(snapshot: IdentityAccessSnapshot, profile: PublicMipProfile, privateProfile: MipProfileSnapshot, digitalAvatarUrl = '', codeUrl = '') {
    const nickname = compactText(privateProfile.realName || profile.realName || profile.nickname, 'MIP 成员')
    const avatarUrl = profile.avatarUrl || ''
    const avatarSource = this.data.avatarSource === 'DIGITAL' && digitalAvatarUrl ? 'DIGITAL' : 'ORIGINAL'
    const company = profile.companies?.[0]
    const organization = profile.organizations?.[0]
    const contact = privateProfile.privateContact
    const contactVisibility = privateProfile.visibility.cardContacts
    const effectiveCodeUrl = codeUrl || GENERIC_MINI_PROGRAM_CODE
    this.profileRef = snapshot.profileRef || ''
    this.setData({
      state: 'ready',
      nickname,
      initial: nickname.slice(0, 1) || 'M',
      avatarUrl,
      digitalAvatarUrl,
      avatarSource,
      cardAvatarUrl: avatarSource === 'DIGITAL' ? digitalAvatarUrl : avatarUrl,
      memberType: profile.userKind === 'PLAYER' ? '玩家' : profile.userKind === 'GUEST' ? '嘉宾' : 'MIP 成员',
      gender: profile.gender === 'MALE' ? '男' : profile.gender === 'FEMALE' ? '女' : '',
      identityStatus: compactText(profile.identityStatus),
      branchName: compactText(profile.primaryBranch?.name),
      industryName: compactText(profile.primaryIndustry?.label),
      companyName: compactText(company?.name),
      roleTitle: compactText(company?.role),
      organizationLine: organization ? [compactText(organization.name), compactText(organization.role)].filter(Boolean).join(' · ') : '',
      phone: contactVisibility?.phone ? compactText(contact?.phone || contact?.phoneMasked) : '',
      wechat: contactVisibility?.wechat ? compactText(contact?.wechat) : '',
      email: contactVisibility?.email ? compactText(contact?.email) : '',
      address: contactVisibility?.address ? compactText(contact?.address) : '',
      codeUrl: effectiveCodeUrl,
      codeMessage: codeUrl ? '' : '当前显示通用小程序二维码，可稍后重试专属名片码。',
      posterPath: '',
      message: '',
    })
  },

  chooseAvatarSource(event: WechatMiniprogram.TouchEvent) {
    const source = String(event.currentTarget.dataset.source || '') as 'ORIGINAL' | 'DIGITAL'
    if (!['ORIGINAL', 'DIGITAL'].includes(source) || (source === 'DIGITAL' && !this.data.digitalAvatarUrl)) {
      return
    }
    this.setData({
      avatarSource: source,
      cardAvatarUrl: source === 'DIGITAL' ? this.data.digitalAvatarUrl : this.data.avatarUrl,
      posterPath: '',
      message: '',
    })
  },

  openDigitalAvatar() {
    caseNavigateTo({ url: '/packages/member/mip-avatar/index' })
  },

  openProfileEdit() {
    caseNavigateTo({ url: '/packages/member/mip-card-edit/index' })
  },

  chooseStyle(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as CardStyleKey
    if (!themes[key] || key === this.data.styleKey || this.data.generating) {
      return
    }
    this.setData({ styleKey: key, theme: themes[key], posterPath: '', message: '' })
  },

  async retryCode() {
    if (this.data.generating) {
      return
    }
    this.setData({ generating: true, codeMessage: '' })
    try {
      const result = await mipIdentityModule.getMyProfileCardCode()
      this.setData({ codeUrl: result.codeUrl, codeMessage: '', posterPath: '' })
    }
    catch {
      this.setData({ codeMessage: '名片码暂时不可用，可稍后重试。' })
    }
    finally {
      this.setData({ generating: false })
    }
  },

  async createPoster() {
    if (this.data.generating || this.data.state !== 'ready') {
      return ''
    }
    this.setData({ generating: true, message: '' })
    try {
      const posterPath = await this.drawCard()
      this.setData({ posterPath })
      return posterPath
    }
    catch {
      this.setData({ message: '名片图片生成失败，请稍后重试。' })
      return ''
    }
    finally {
      this.setData({ generating: false })
    }
  },

  async drawCard() {
    const node = await new Promise<Canvas2dNode>((resolve, reject) => {
      this.createSelectorQuery().select('#mip-member-card-canvas').fields({ node: true, size: true }).exec((results) => {
        const result = results?.[0] as { node?: Canvas2dNode } | undefined
        result?.node ? resolve(result.node) : reject(new Error('名片画布不可用'))
      })
    })
    const ratio = wx.getWindowInfo().pixelRatio || 1
    node.width = CARD_WIDTH * ratio
    node.height = CARD_HEIGHT * ratio
    const context = node.getContext('2d')
    context.scale(ratio, ratio)
    const theme = this.data.theme
    context.fillStyle = theme.background
    context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)
    await this.drawBackground(node, context, theme.asset)

    context.fillStyle = theme.foreground
    context.font = '700 44px sans-serif'
    context.fillText(this.data.nickname.slice(0, 10), 38, 78)
    context.font = '600 22px sans-serif'
    context.fillText([this.data.companyName, this.data.roleTitle].filter(Boolean).join(' · ').slice(0, 30), 40, 118)
    context.fillText(this.data.organizationLine.slice(0, 30), 40, 150)
    if (this.data.gender) {
      context.fillText(`性别  ${this.data.gender}`, 40, 182)
    }

    context.font = '500 20px sans-serif'
    context.fillStyle = theme.muted
    const contacts = [
      this.data.phone ? `电话  ${this.data.phone}` : '',
      this.data.wechat ? `微信  ${this.data.wechat}` : '',
      this.data.email ? `邮箱  ${this.data.email}` : '',
      this.data.address ? `地址  ${this.data.address}` : '',
    ].filter(Boolean)
    const details = contacts.length
      ? contacts
      : [[this.data.memberType, this.data.identityStatus].filter(Boolean).join(' · '), [this.data.branchName, this.data.industryName].filter(Boolean).join(' · ')]
    details.slice(0, 4).forEach((item, index) => context.fillText(item.slice(0, 36), 40, 255 + index * 36))

    await this.drawAvatar(node, context, 472, 36, 192, theme)
    if (this.data.codeUrl) {
      try {
        const code = await loadCanvasImage(node, this.data.codeUrl)
        roundedRect(context, 548, 348, 104, 104, 12)
        context.fillStyle = theme.codeBackground
        context.fill()
        context.drawImage(code, 554, 354, 92, 92)
      }
      catch {}
    }
    if (node.requestAnimationFrame) {
      await new Promise<void>(resolve => node.requestAnimationFrame?.(resolve))
    }
    return new Promise<string>((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas: node,
        fileType: 'png',
        destWidth: CARD_WIDTH * ratio,
        destHeight: CARD_HEIGHT * ratio,
        success: result => resolve(result.tempFilePath),
        fail: reject,
      })
    })
  },

  async drawBackground(node: Canvas2dNode, context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D, source: string) {
    if (!source) {
      return
    }
    try {
      const image = await loadCanvasImage(node, source)
      context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT)
    }
    catch {}
  },

  async drawAvatar(
    node: Canvas2dNode,
    context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    theme: CardTheme,
  ) {
    context.save()
    roundedRect(context, x, y, size, size, size / 2)
    context.clip()
    if (this.data.cardAvatarUrl) {
      try {
        const image = await loadCanvasImage(node, this.data.cardAvatarUrl)
        context.drawImage(image, x, y, size, size)
        context.restore()
        return
      }
      catch {}
    }
    context.fillStyle = theme.codeBackground
    context.fillRect(x, y, size, size)
    context.fillStyle = '#111111'
    context.font = '700 58px sans-serif'
    context.textAlign = 'center'
    context.fillText(this.data.initial, x + size / 2, y + 92)
    context.textAlign = 'start'
    context.restore()
  },

  previewPoster() {
    if (this.data.posterPath) {
      wx.previewImage({ current: this.data.posterPath, urls: [this.data.posterPath] })
    }
  },

  async savePoster() {
    if (this.data.generating) {
      return
    }
    const posterPath = this.data.posterPath || await this.createPoster()
    if (!posterPath) {
      return
    }
    try {
      await wx.saveImageToPhotosAlbum({ filePath: posterPath })
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    }
    catch {
      this.setData({ message: '保存失败，请检查相册权限后重试。' })
    }
  },

  onShareAppMessage() {
    const profileRef = encodeURIComponent(this.profileRef)
    return {
      title: `${this.data.nickname}的 MIP 名片`,
      path: `/packages/member/mip-public-profile/index?profileRef=${profileRef}`,
      ...(this.data.posterPath ? { imageUrl: this.data.posterPath } : {}),
    }
  },
})
