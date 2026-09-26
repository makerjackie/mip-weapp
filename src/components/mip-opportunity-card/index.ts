import { brand } from '../../config/brand'
import { clearComponentMedia, updateComponentMedia } from '../../platform/storage/component-media'

export interface OpportunityTypeTagView {
  key: string
  label: string
}

Component({
  data: {
    fallbackCoverUrl: brand.opportunityDefaultCoverPath,
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
    /** 详情保留城市、地区四行信息，末行仅展示类型与发表时间。 */
    variant: { type: String, value: 'list' },
    title: { type: String, value: '' },
    coverUrl: { type: String, value: '' },
    valueText: { type: String, value: '' },
    cityText: { type: String, value: '' },
    locationText: { type: String, value: '' },
    /** 主营地区自由文本（选传）：有值时地区行优先展示，服务端回传即生效。 */
    regionText: { type: String, value: '' },
    targetText: { type: String, value: '' },
    referralCount: { type: Number, value: 0 },
    avatars: { type: Array, value: [] },
    publishedText: { type: String, value: '' },
    /** journey-review J3-01/J3-09：机会类型黄标（找企业/找资源/找伙伴），可选，缺省不渲染。 */
    typeTags: { type: Array, value: [] as OpportunityTypeTagView[] },
    /** 聚合胶囊展示当前合作意向；旧引荐记录不计入这里。 */
    pillLabel: { type: String, value: '想合作' },
    /** 发表时间前缀：详情页用「发表于：」，列表默认「发布于 」。 */
    publishedPrefix: { type: String, value: '发布于 ' },
  },
})
