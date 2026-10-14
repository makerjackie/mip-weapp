import { brand } from './brand'

export type MemberCardStyleKey = 'PINK' | 'BLUE' | 'WHITE' | 'YELLOW'

// 名片卡面/缩略图走静态托管 CDN（PNG），不进小程序包：包内烘焙图真机不可用——
// ignoreUploadUnusedFiles 的上传依赖分析连 wx:elif 静态分支引用也剔除（MIW-100 的
// 分支静态引用方案 2026-10-14 真机复验失败，四个款式全部只剩纯色垫底），设备 webp
// 解码器又解不开 VP8L/ALPH；网络 PNG 绕开这两个变量且全设备可解码。
// 通道用 admin 网关域（brand.adminConsoleDomain）：默认托管域 tcloudbaseapp.com 对
// 部分出口区域回 HTTP 418（2026-10-14 实测），网关域回读 200。
// 换图流程：新图放 assets/cdn/member-card/<下一版本>/，`pnpm cloud:cdn-assets:deploy`
// 上传后 bump 下面的版本段（URL 不可变，天然利用 CDN 缓存）；素材源文件不得放 src/
// （会被打进分包）。上传脚本 scripts/deploy-weapp-cdn-assets.mjs，守卫
// tests/mip-member-card.test.ts。
const MEMBER_CARD_CDN_VERSION = 'v1'

function memberCardCdnUrl(file: string) {
  return `https://${brand.adminConsoleDomain}/mip-weapp-assets/member-card/${MEMBER_CARD_CDN_VERSION}/${file}`
}

export const memberCardArt: Record<MemberCardStyleKey, { asset: string, thumb: string }> = {
  PINK: { asset: memberCardCdnUrl('card-bg-a.jpg'), thumb: memberCardCdnUrl('card-bg-a.jpg') },
  BLUE: { asset: memberCardCdnUrl('card-bg-b.jpg'), thumb: memberCardCdnUrl('card-bg-b.jpg') },
  WHITE: { asset: memberCardCdnUrl('card-bg-c.jpg'), thumb: memberCardCdnUrl('card-bg-c.jpg') },
  // YELLOW 缩略用专用烘焙 thumb（card-thumb-yellow.png，带透明边缘），与卡面 d 图不同源（figma 口径）。
  YELLOW: { asset: memberCardCdnUrl('card-bg-d-yellow.jpg'), thumb: memberCardCdnUrl('card-thumb-yellow.png') },
}
