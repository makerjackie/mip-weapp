/**
 * OrderTag — small filled keyline chip used on covers (design-system contract:
 * 32rpx tall, 8rpx radius, 1rpx stroke, 20rpx/500 text).
 * Preset labels resolve to their design colors; every other label falls back to
 * the panel surface so the chip always reads as a filled tag.
 */
interface OrderTagPreset {
  bg: string
  border: string
  color: string
}

const TAG_PRESETS: Record<string, OrderTagPreset> = {
  仅玩家: { bg: '#fde530', border: '#d0b801', color: '#000000' },
  沙龙: { bg: '#428bff', border: '#075adf', color: '#f7f7f7' },
}

Component({
  properties: {
    label: { type: String, value: '' },
    bg: { type: String, value: '' },
    border: { type: String, value: '' },
    color: { type: String, value: '' },
  },

  data: {
    tagStyle: '',
  },

  observers: {
    'label, bg, border, color': function (label: string, bg: string, border: string, color: string) {
      const preset = TAG_PRESETS[label]
      const resolvedBg = bg || preset?.bg || ''
      const resolvedBorder = border || preset?.border || ''
      const resolvedColor = color || preset?.color || ''
      const tagStyle = [
        resolvedBg ? `background:${resolvedBg}` : '',
        resolvedBorder ? `border-color:${resolvedBorder}` : '',
        resolvedColor ? `color:${resolvedColor}` : '',
      ].filter(Boolean).join(';')
      this.setData({ tagStyle })
    },
  },
})
