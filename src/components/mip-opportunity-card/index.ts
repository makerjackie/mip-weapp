import { brand } from '../../config/brand'
import { clearComponentMedia, updateComponentMedia } from '../../platform/storage/component-media'

export interface OpportunityTypeTagView {
  key: string
  label: string
}

Component({
  data: {
    fallbackCoverUrl: brand.logoPath,
    displayCoverUrl: '',
    displayAvatars: [],
  },
  observers: {
    coverUrl(value: string) {
      updateComponentMedia(this, 'displayCoverUrl', value)
    },
    avatars(value: unknown[]) {
      updateComponentMedia(this, 'displayAvatars', value)
    },
  },
  lifetimes: {
    detached() { clearComponentMedia(this) },
  },
  properties: {
    title: { type: String, value: '' },
    coverUrl: { type: String, value: '' },
    valueText: { type: String, value: '' },
    cityText: { type: String, value: '' },
    locationText: { type: String, value: '' },
    targetText: { type: String, value: '' },
    referralCount: { type: Number, value: 0 },
    avatars: { type: Array, value: [] },
    publishedText: { type: String, value: '' },
    /** journey-review J3-01/J3-09：机会类型黄标（找企业/找资源/找伙伴），可选，缺省不渲染。 */
    typeTags: { type: Array, value: [] as OpportunityTypeTagView[] },
    /** 聚合胶囊文案：机会 Tab 用「想合作」，历史调用方保持「引荐」。 */
    pillLabel: { type: String, value: '引荐' },
    /** 发表时间前缀：详情页用「发表于：」，列表默认「发布于 」。 */
    publishedPrefix: { type: String, value: '发布于 ' },
  },
})
