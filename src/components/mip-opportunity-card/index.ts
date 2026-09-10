import { brand } from '../../config/brand'

Component({
  data: {
    fallbackCoverUrl: brand.logoPath,
  },
  properties: {
    title: { type: String, value: '' },
    coverUrl: { type: String, value: '' },
    valueText: { type: String, value: '' },
    locationText: { type: String, value: '' },
    targetText: { type: String, value: '' },
    referralCount: { type: Number, value: 0 },
    avatars: { type: Array, value: [] },
    publishedText: { type: String, value: '' },
  },
})
