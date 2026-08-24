import type { IdentityAccessSnapshot, PublicMipProfile } from '../../../modules/mip-identity'
import { mipAiModule } from '../../../modules/mip-ai/client'
import { mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

type CardStyleKey = 'BLACK' | 'YELLOW' | 'LIGHT'

interface Canvas2dNode {
  width: number
  height: number
  createImage: () => WechatMiniprogram.Image
  getContext: (type: '2d') => WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D
  requestAnimationFrame?: (callback: () => void) => number
}

interface CardPalette {
  key: CardStyleKey
  label: string
  background: string
  foreground: string
  muted: string
  accent: string
  chip: string
}

const CARD_WIDTH = 375
const CARD_HEIGHT = 600

const palettes: Record<CardStyleKey, CardPalette> = {
  BLACK: {
    key: 'BLACK',
    label: '黑色',
    background: '#090909',
    foreground: '#FFFFFF',
    muted: '#B8B8B8',
    accent: '#FCDF03',
    chip: '#242424',
  },
  YELLOW: {
    key: 'YELLOW',
    label: '黄色',
    background: '#FCDF03',
    foreground: '#090909',
    muted: '#514A10',
    accent: '#090909',
    chip: '#F3D700',
  },
  LIGHT: {
    key: 'LIGHT',
    label: '浅色',
    background: '#F7F7F2',
    foreground: '#111111',
    muted: '#686868',
    accent: '#D3B900',
    chip: '#EAEAE4',
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
    styleKey: 'BLACK' as CardStyleKey,
    palette: palettes.BLACK,
    nickname: '',
    initial: 'M',
    avatarUrl: '',
    digitalAvatarUrl: '',
    cardAvatarUrl: '',
    avatarSource: 'ORIGINAL' as 'ORIGINAL' | 'DIGITAL',
    memberType: 'MIP 成员',
    identityStatus: '',
    headline: '',
    branchName: '',
    industryName: '',
    abilities: [] as string[],
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
      const [profile, avatarHistory] = await Promise.all([
        mipIdentityModule.getPublicProfile(snapshot.profileRef),
        mipAiModule.listDigitalAvatars().catch(() => ({ items: [] })),
      ])
      const digitalAvatar = avatarHistory.items
        .find(item => item.status === 'READY' && item.outputUrl)
      const digitalAvatarUrl = digitalAvatar?.outputUrl || ''
      this.applyCard(snapshot, profile, digitalAvatarUrl)
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '名片加载失败',
      })
    }
  },

  applyCard(snapshot: IdentityAccessSnapshot, profile: PublicMipProfile, digitalAvatarUrl = '') {
    const nickname = compactText(profile.nickname, 'MIP 成员')
    const avatarUrl = profile.avatarUrl || ''
    const avatarSource = this.data.avatarSource === 'DIGITAL' && digitalAvatarUrl ? 'DIGITAL' : 'ORIGINAL'
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
      identityStatus: compactText(profile.identityStatus),
      headline: compactText(profile.headline),
      branchName: compactText(profile.primaryBranch?.name),
      industryName: compactText(profile.primaryIndustry?.label),
      abilities: (profile.abilities || []).map(item => compactText(item.label)).filter(Boolean).slice(0, 3),
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

  chooseStyle(event: WechatMiniprogram.TouchEvent) {
    const key = String(event.currentTarget.dataset.key || '') as CardStyleKey
    if (!palettes[key] || key === this.data.styleKey || this.data.generating) {
      return
    }
    this.setData({ styleKey: key, palette: palettes[key], posterPath: '', message: '' })
  },

  async createPoster() {
    if (this.data.generating || this.data.state !== 'ready') {
      return
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
      this.createSelectorQuery()
        .select('#mip-member-card-canvas')
        .fields({ node: true, size: true })
        .exec((results) => {
          const result = results?.[0] as { node?: Canvas2dNode } | undefined
          result?.node ? resolve(result.node) : reject(new Error('名片画布不可用'))
        })
    })
    const ratio = wx.getWindowInfo().pixelRatio || 1
    node.width = CARD_WIDTH * ratio
    node.height = CARD_HEIGHT * ratio
    const context = node.getContext('2d')
    context.scale(ratio, ratio)
    const palette = this.data.palette
    context.fillStyle = palette.background
    context.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT)

    context.fillStyle = palette.accent
    context.fillRect(0, 0, CARD_WIDTH, 12)
    context.fillStyle = palette.foreground
    context.font = '700 34px sans-serif'
    context.fillText('MIP', 28, 64)
    context.font = '500 12px sans-serif'
    context.fillStyle = palette.muted
    context.fillText('会员名片', 28, 88)

    await this.drawAvatar(node, context, 28, 126, 104, palette)
    context.fillStyle = palette.foreground
    context.font = '700 29px sans-serif'
    context.fillText(this.data.nickname.slice(0, 12), 28, 270)
    context.font = '500 14px sans-serif'
    context.fillStyle = palette.muted
    context.fillText([this.data.memberType, this.data.identityStatus].filter(Boolean).join(' · ').slice(0, 28), 28, 300)

    const headline = this.data.headline || '暂未填写个人介绍'
    context.fillStyle = palette.foreground
    context.font = '600 18px sans-serif'
    this.drawWrappedText(context, headline, 28, 346, 319, 29, 2)

    const details = [
      this.data.branchName ? `城市分会  ${this.data.branchName}` : '',
      this.data.industryName ? `主要行业  ${this.data.industryName}` : '',
    ].filter(Boolean)
    context.font = '500 13px sans-serif'
    context.fillStyle = palette.muted
    details.forEach((item, index) => context.fillText(item.slice(0, 32), 28, 426 + index * 28))

    let chipX = 28
    const chipY = details.length > 1 ? 488 : 462
    context.font = '500 12px sans-serif'
    for (const ability of this.data.abilities) {
      const label = ability.slice(0, 8)
      const width = Math.min(104, context.measureText(label).width + 24)
      if (chipX + width > CARD_WIDTH - 28) {
        break
      }
      roundedRect(context, chipX, chipY, width, 30, 15)
      context.fillStyle = palette.chip
      context.fill()
      context.fillStyle = palette.foreground
      context.fillText(label, chipX + 12, chipY + 20)
      chipX += width + 8
    }

    context.fillStyle = palette.muted
    context.font = '400 11px sans-serif'
    context.fillText('通过微信分享可查看公开档案', 28, 558)
    context.fillStyle = palette.accent
    context.fillRect(28, 574, 64, 4)

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

  async drawAvatar(
    node: Canvas2dNode,
    context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    palette: CardPalette,
  ) {
    context.save()
    context.beginPath()
    context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
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
    context.fillStyle = palette.accent
    context.fillRect(x, y, size, size)
    context.fillStyle = palette.background
    context.font = '700 42px sans-serif'
    context.textAlign = 'center'
    context.fillText(this.data.initial, x + size / 2, y + 66)
    context.textAlign = 'start'
    context.restore()
  },

  drawWrappedText(
    context: WechatMiniprogram.CanvasRenderingContext.CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
  ) {
    const characters = [...text]
    let line = ''
    let lineIndex = 0
    for (let index = 0; index < characters.length && lineIndex < maxLines; index += 1) {
      const candidate = `${line}${characters[index]}`
      if (context.measureText(candidate).width <= maxWidth) {
        line = candidate
        continue
      }
      context.fillText(line, x, y + lineIndex * lineHeight)
      lineIndex += 1
      line = characters[index]
    }
    if (lineIndex < maxLines && line) {
      context.fillText(line, x, y + lineIndex * lineHeight)
    }
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
