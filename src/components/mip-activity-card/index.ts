import type { WechatChannelsDestination } from '../../platform/wechat/channels'
import { clearComponentMedia, updateComponentMedia } from '../../platform/storage/component-media'
import { openWechatChannelsDestination } from '../../platform/wechat/channels'

interface RecapEntry {
  destination: WechatChannelsDestination
}

Component({
  data: {
    displayCoverUrl: '',
    displayParticipants: [],
  },
  observers: {
    event(value: { coverUrl?: string, participantPreview?: unknown[] }) {
      updateComponentMedia(this, 'displayCoverUrl', value?.coverUrl || '')
      updateComponentMedia(this, 'displayParticipants', value?.participantPreview || [])
    },
  },
  lifetimes: {
    detached() { clearComponentMedia(this) },
  },
  properties: {
    event: { type: Object, value: {} },
    variant: { type: String, value: 'default' },
    showAction: { type: Boolean, value: false },
    showShare: { type: Boolean, value: false },
    actionLoading: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
  },

  methods: {
    handleSelect() {
      const event = this.data.event as { id?: string, status?: string }
      this.triggerEvent('select', { id: event.id || '', status: event.status || '' })
    },
    handleShare() {},

    /** Recap cards open the event's first video recap; without one, the detail page. */
    handleRecap() {
      const event = this.data.event as { id?: string, status?: string, videoRecaps?: RecapEntry[] }
      const recap = event.videoRecaps?.[0]
      if (recap) {
        void openWechatChannelsDestination(recap.destination)
        return
      }
      this.triggerEvent('select', { id: event.id || '', status: event.status || '' })
    },

    handleAction() {
      const event = this.data.event as { id?: string, action?: string }
      this.triggerEvent('action', { id: event.id || '', action: event.action || '' })
    },
  },
})
