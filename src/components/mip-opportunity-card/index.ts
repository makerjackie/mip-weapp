import { brand } from '../../config/brand'
import { clearComponentMedia, updateComponentMedia } from '../../platform/storage/component-media'

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
    locationText: { type: String, value: '' },
    targetText: { type: String, value: '' },
    referralCount: { type: Number, value: 0 },
    avatars: { type: Array, value: [] },
    publishedText: { type: String, value: '' },
  },
})
