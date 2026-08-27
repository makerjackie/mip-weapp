Component({
  properties: {
    event: { type: Object, value: {} },
    variant: { type: String, value: 'default' },
    showAction: { type: Boolean, value: false },
    showShare: { type: Boolean, value: false },
    actionLoading: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
    showCancel: { type: Boolean, value: false },
    cancelLoading: { type: Boolean, value: false },
    cancelRetry: { type: Boolean, value: false },
    registrationId: { type: String, value: '' },
    version: { type: Number, value: 0 },
  },

  methods: {
    handleSelect() {
      const event = this.data.event as { id?: string, status?: string }
      this.triggerEvent('select', { id: event.id || '', status: event.status || '' })
    },
    handleShare() {},

    handleAction() {
      const event = this.data.event as { id?: string, action?: string }
      this.triggerEvent('action', { id: event.id || '', action: event.action || '' })
    },

    handleCancel() {
      const event = this.data.event as { id?: string }
      this.triggerEvent('cancel', {
        eventId: event.id || '',
        registrationId: this.data.registrationId,
        version: this.data.version,
        refundRetry: this.data.cancelRetry,
      })
    },
  },
})
