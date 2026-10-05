import type { IdentityAccessSnapshot, MipProfileSnapshot, PublicMipProfile } from '../../../modules/mip-identity'
import { resolveIconColor } from '../../../components/mip-icon/colors'
import { ICONS } from '../../../components/mip-icon/icons'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../platform/navigation/client'

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
  thumbAsset: string
  background: string
  foreground: string
  muted: string
  codeBackground: string
}

const CARD_WIDTH = 702
const CARD_HEIGHT = 492
// figma 1732_20401 卡面几何（canvas 像素 = 设计 rpx，均为 @2x 值）。
const CARD_NAME = { x: 24, y: 24 }
const CARD_ROWS: Array<{ field: 'companyName' | 'roleTitle' | 'organizationName' | 'organizationRole' | 'gender', y: number }> = [
  { field: 'companyName', y: 88 },
  { field: 'roleTitle', y: 130 },
  { field: 'organizationName', y: 188 },
  { field: 'organizationRole', y: 230 },
  { field: 'gender', y: 272 },
]
const CONTACT_ROWS: Array<{ field: 'phone' | 'wechat' | 'email' | 'address', icon: string, y: number }> = [
  { field: 'phone', icon: 'cellphone-2', y: 308 },
  { field: 'wechat', icon: 'wechat-2', y: 350 },
  { field: 'email', icon: 'mail-2', y: 392 },
  { field: 'address', icon: 'icon-map-pin-line', y: 434 },
]
// 设计稿联系行：图标列 x=13 设计 px（=26 canvas px），文案 x=33（=66）；图标 32 盒内等比居中。
const CONTACT_ICON_BOX = 32
const CONTACT_ICON_X = 26
const CONTACT_TEXT_X = 66
const AVATAR = { x: 438, y: 24, size: 240 }
const CODE = { x: 558, y: 348, size: 120 }
// figma 1735_3369：品牌色卡的头像环 2px、名片码描边 1px，均为 #fcdf03。
const CARD_RING_COLOR = '#fcdf03'
const themes: Record<CardStyleKey, CardTheme> = {
  PINK: {
    key: 'PINK',
    label: '暖色',
    asset: '/packages/member/assets/figma/profile/card-bg-a.webp',
    thumbAsset: '/packages/member/assets/figma/profile/card-bg-a.webp',
    background: '#FF5F6D',
    foreground: '#080808',
    muted: '#4A2326',
    codeBackground: '#FFFFFF',
  },
  BLUE: {
    key: 'BLUE',
    label: '蓝色',
    asset: '/packages/member/assets/figma/profile/card-bg-b.webp',
    thumbAsset: '/packages/member/assets/figma/profile/card-bg-b.webp',
    background: '#403BDA',
    foreground: '#FFFFFF',
    muted: '#E4E3FF',
    codeBackground: '#FFFFFF',
  },
  WHITE: {
    key: 'WHITE',
    label: '浅色',
    asset: '/packages/member/assets/figma/profile/card-bg-c.webp',
    thumbAsset: '/packages/member/assets/figma/profile/card-bg-c.webp',
    background: '#F5F4F0',
    foreground: '#080808',
    muted: '#575757',
    codeBackground: '#FFFFFF',
  },
  // figma 1735_3369: 品牌色卡为 #fde104 实底 + 吉祥物 hard-light，WXSS 无法可靠表达，
  // 预烘成 card-bg-d-yellow.webp（702×492），背景色仅作加载垫底。
  YELLOW: {
    key: 'YELLOW',
    label: '品牌色',
    asset: '/packages/member/assets/figma/profile/card-bg-d-yellow.webp',
    thumbAsset: '/packages/member/assets/figma/profile/card-thumb-yellow.png',
    background: '#FDE104',
    foreground: '#080808',
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

/** 画布没有 WXML 的 truncate：超宽时截断并补省略号。 */
function fitText(
  context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
) {
  if (context.measureText(value).width <= maxWidth) {
    return value
  }
  let text = value
  while (text.length > 1 && context.measureText(`${text}…`).width > maxWidth) {
    text = text.slice(0, -1)
  }
  return `${text}…`
}

/** 联系行图标：复用 mip-icon 的 SVG 注册表绘制，画布不支持 SVG 时静默跳过。 */
function iconSource(name: string, color: string) {
  const icon = ICONS[name]
  if (!icon) {
    return ''
  }
  const hex = resolveIconColor(color)
  const body = icon.mono ? (icon.body || '').replace(/currentColor/g, hex) : (icon.body || '')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.vb}" width="${icon.w || 16}" height="${icon.h || 16}" fill="${hex}">${body}</svg>`)}`
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    styleKey: 'PINK' as CardStyleKey,
    theme: themes.PINK,
    themeOptions: Object.values(themes),
    templateRequirements: {} as Partial<Record<CardStyleKey, string[]>>,
    nickname: '',
    initial: 'M',
    avatarUrl: '',
    cardAvatarUrl: '',
    gender: '',
    companyName: '',
    roleTitle: '',
    organizationName: '',
    organizationRole: '',
    phone: '',
    wechat: '',
    email: '',
    address: '',
    codeUrl: '',
    codeMessage: '',
    posterPath: '',
    // 分享缩略图：进入页面/切换样式后静默渲染的名片图；下载仍走 createPoster 的模板校验。
    shareImagePath: '',
    generating: false,
    message: '',
    // figma 1732_20401 版式只有卡片/样式选择/底栏；页头标题由原生导航承担，
    // 「编辑名片」入口用 showHeader 保留在生产环境。
    showHeader: true,
    // figma 2165_17277 访客视角：无样式选择，底栏为单按钮「登录制作我的名片」。
    // 访客入口携带 guest=1 打开（路由缺口，见 ui-fidelity manifest notes）。
    isGuest: false,
  },
  profileRef: '',
  loadSequence: 0,
  drawingShare: false,

  onLoad(options: { guest?: string } = {}) {
    if (options?.guest === '1') {
      this.setData({ isGuest: true })
    }
  },

  onShow() {
    void this.loadCard()
  },

  onHide() {
    this.loadSequence += 1
  },

  onUnload() {
    this.loadSequence += 1
  },

  retryLoad() {
    void this.loadCard(true)
  },

  async loadCard(_force = false) {
    const sequence = ++this.loadSequence
    if (this.data.state !== 'ready') {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const snapshot = await mipIdentityModule.loadSnapshot()
      if (!snapshot.profileRef) {
        throw new Error('公开档案引用暂时不可用')
      }
      const settings = await mipIdentityModule.getProfileCardSettings()
      if (!settings.enabled) {
        throw new Error(settings.reason ? `名片已下架：${settings.reason}` : '名片已下架，请联系管理员')
      }
      if (!settings.templates.length) {
        throw new Error('暂无可用名片模板，请联系管理员')
      }
      const styleKey = settings.templates.some(item => item.key === this.data.styleKey) ? this.data.styleKey : settings.templates[0].key
      this.setData({ styleKey, theme: themes[styleKey], themeOptions: settings.templates.map(item => ({ ...themes[item.key], label: item.name })), templateRequirements: Object.fromEntries(settings.templates.map(item => [item.key, item.requiredFields])) })
      const codePromise = this.data.codeUrl && !this.data.codeMessage
        ? Promise.resolve({ codeUrl: this.data.codeUrl })
        : mipIdentityModule.getMyProfileCardCode().catch(() => ({ codeUrl: '' }))
      const [profile, privateProfile, cardCode] = await Promise.all([
        mipIdentityModule.getPublicProfile(snapshot.profileRef),
        mipIdentityModule.getProfile(),
        codePromise,
      ])
      if (sequence !== this.loadSequence) {
        return
      }
      this.applyCard(snapshot, profile, privateProfile, cardCode.codeUrl)
      void this.refreshShareImage()
    }
    catch (error) {
      if (sequence !== this.loadSequence) {
        return
      }
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '名片加载失败' })
    }
  },

  applyCard(snapshot: IdentityAccessSnapshot, profile: PublicMipProfile, privateProfile: MipProfileSnapshot, codeUrl = '') {
    const nickname = compactText(privateProfile.realName || profile.realName || profile.nickname, 'MIP 成员')
    const avatarUrl = profile.avatarUrl || ''
    const company = profile.companies?.[0]
    const organization = profile.organizations?.[0]
    const contact = privateProfile.privateContact
    const contactVisibility = privateProfile.visibility.cardContacts
    this.profileRef = snapshot.profileRef || ''
    this.setData({
      state: 'ready',
      nickname,
      initial: nickname.slice(0, 1) || 'M',
      avatarUrl,
      cardAvatarUrl: avatarUrl,
      gender: profile.gender === 'MALE' ? '男' : profile.gender === 'FEMALE' ? '女' : '',
      companyName: compactText(company?.name),
      roleTitle: compactText(company?.role),
      organizationName: compactText(organization?.name),
      organizationRole: compactText(organization?.role),
      phone: contactVisibility?.phone ? compactText(contact?.phone || contact?.phoneMasked) : '',
      wechat: contactVisibility?.wechat ? compactText(contact?.wechat) : '',
      email: contactVisibility?.email ? compactText(contact?.email) : '',
      address: contactVisibility?.address ? compactText(contact?.address) : '',
      codeUrl,
      codeMessage: codeUrl ? '' : '名片码暂时不可用，可稍后重试。',
      posterPath: '',
      // 名片数据可能已变更（编辑返回、头像更新），分享缩略图按最新数据重画。
      shareImagePath: '',
      message: '',
    })
  },

  openProfileEdit() {
    caseNavigateTo({ url: '/packages/member/mip-card-edit/index' })
  },

  // figma 2165_17277 访客底栏：回首页登录后再制作名片。
  guestLogin() {
    caseNavigateTo({ url: '/pages/profile/index' })
  },

  chooseStyle(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as CardStyleKey
    if (!this.data.themeOptions.some(item => item.key === key) || key === this.data.styleKey || this.data.generating) {
      return
    }
    this.setData({ styleKey: key, theme: themes[key], posterPath: '', shareImagePath: '', message: '' })
    void this.refreshShareImage()
  },

  // 分享缩略图静默渲染：下载按钮仍由 createPoster 负责模板必填校验，这里不校验、不报错。
  async refreshShareImage() {
    if (this.data.isGuest || this.data.generating || this.drawingShare || this.data.state !== 'ready') {
      return
    }
    this.drawingShare = true
    try {
      const shareImagePath = await this.drawCard()
      if (shareImagePath) {
        this.setData({ shareImagePath })
      }
    }
    catch {}
    finally {
      this.drawingShare = false
    }
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
    if (this.data.generating || this.drawingShare || this.data.state !== 'ready') {
      return ''
    }
    this.setData({ generating: true, message: '' })
    try {
      const settings = await mipIdentityModule.getProfileCardSettings()
      const template = settings.templates.find(item => item.key === this.data.styleKey)
      if (!settings.enabled || !template) {
        throw new Error('当前名片或模板已停用，请重新加载')
      }
      const fields: Record<string, { value: string, label: string }> = {
        name: { value: this.data.nickname, label: '姓名' },
        avatar: { value: this.data.avatarUrl, label: '头像' },
        company: { value: this.data.companyName, label: '公司' },
        position: { value: this.data.roleTitle, label: '职位' },
        contact: { value: this.data.phone || this.data.wechat || this.data.email, label: '公开联系方式' },
      }
      const missing = template.requiredFields.filter(key => !fields[key]?.value).map(key => fields[key]?.label || key)
      if (missing.length) {
        throw new Error(`请先编辑名片，补充${missing.join('、')}`)
      }
      const posterPath = await this.drawCard()
      this.setData({ posterPath })
      return posterPath
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '名片图片生成失败，请稍后重试。' })
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

    // figma 1732_20401：全部卡面文字同一前景色、medium 字重，textBaseline=top 落在 WXML 同款行位。
    context.fillStyle = theme.foreground
    context.textBaseline = 'top'
    context.font = '500 40px sans-serif'
    context.fillText(fitText(context, this.data.nickname, 420), CARD_NAME.x, CARD_NAME.y)
    context.font = '500 24px sans-serif'
    CARD_ROWS.forEach((row) => {
      const value = row.field === 'gender' ? (this.data.gender ? `性别 · ${this.data.gender}` : '') : this.data[row.field]
      if (value) {
        context.fillText(fitText(context, value, 420), 24, row.y)
      }
    })
    for (const row of CONTACT_ROWS) {
      const value = this.data[row.field]
      if (!value) {
        continue
      }
      await this.drawContactIcon(node, context, row.icon, row.y, theme.foreground)
      context.fillText(fitText(context, value, 458 - CONTACT_TEXT_X), CONTACT_TEXT_X, row.y)
    }

    await this.drawAvatar(node, context, AVATAR.x, AVATAR.y, AVATAR.size, theme)
    if (this.data.codeUrl) {
      try {
        const code = await loadCanvasImage(node, this.data.codeUrl)
        // 设计稿名片码为圆形（r=50），与线卡 rounded-full 一致；白底圆先铺避免透明码可读性差。
        context.save()
        context.beginPath()
        context.arc(CODE.x + CODE.size / 2, CODE.y + CODE.size / 2, CODE.size / 2, 0, Math.PI * 2)
        context.fillStyle = theme.codeBackground
        context.fill()
        context.clip()
        context.drawImage(code, CODE.x, CODE.y, CODE.size, CODE.size)
        context.restore()
        if (this.data.styleKey === 'YELLOW') {
          context.beginPath()
          context.arc(CODE.x + CODE.size / 2, CODE.y + CODE.size / 2, CODE.size / 2 - 1, 0, Math.PI * 2)
          context.lineWidth = 2
          context.strokeStyle = CARD_RING_COLOR
          context.stroke()
        }
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

  async drawContactIcon(
    node: Canvas2dNode,
    context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    name: string,
    y: number,
    color: string,
  ) {
    const source = iconSource(name, color)
    if (!source) {
      return
    }
    try {
      const image = await loadCanvasImage(node, source)
      const icon = ICONS[name]
      const width = icon?.w || icon?.h || 16
      const height = icon?.h || icon?.w || 16
      const scale = Math.min(CONTACT_ICON_BOX / width, CONTACT_ICON_BOX / height)
      const fittedWidth = width * scale
      const fittedHeight = height * scale
      context.drawImage(image, CONTACT_ICON_X + (CONTACT_ICON_BOX - fittedWidth) / 2, y + (CONTACT_ICON_BOX - fittedHeight) / 2, fittedWidth, fittedHeight)
    }
    catch {}
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
    let drawn = false
    if (this.data.cardAvatarUrl) {
      try {
        const image = await loadCanvasImage(node, this.data.cardAvatarUrl)
        context.save()
        roundedRect(context, x, y, size, size, size / 2)
        context.clip()
        context.drawImage(image, x, y, size, size)
        context.restore()
        drawn = true
      }
      catch {}
    }
    if (!drawn) {
      await this.drawAvatarFallback(context, x, y, size, theme)
    }
    // figma 1735_3369：品牌色卡头像 2px 品牌环（WXML ring-2 ring-brand），其余卡无环。
    if (this.data.styleKey === 'YELLOW') {
      context.beginPath()
      context.arc(x + size / 2, y + size / 2, size / 2 - 2, 0, Math.PI * 2)
      context.lineWidth = 4
      context.strokeStyle = CARD_RING_COLOR
      context.stroke()
    }
  },

  async drawAvatarFallback(
    context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    theme: CardTheme,
  ) {
    context.save()
    roundedRect(context, x, y, size, size, size / 2)
    context.clip()
    context.fillStyle = theme.codeBackground
    context.fillRect(x, y, size, size)
    context.fillStyle = '#080808'
    // 与线卡兜底一致：text-[48rpx] font-bold（=48 canvas px），居中。
    context.font = '700 48px sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(this.data.initial, x + size / 2, y + size / 2)
    context.textBaseline = 'top'
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
    const posterPath = await this.createPoster()
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
      // 分享缩略图用已渲染的名片图；画布未就绪时退回当前样式的底图素材。
      imageUrl: this.data.posterPath || this.data.shareImagePath || this.data.theme.asset,
    }
  },
})
