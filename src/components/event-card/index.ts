Component({
  properties: {
    event: { type: Object, value: {} },
    showAction: { type: Boolean, value: false },
    actionLoading: { type: Boolean, value: false },
    compact: { type: Boolean, value: false },
  },

  methods: {
    handleSelect() {
      const event = this.data.event as { id?: string }
      this.triggerEvent('select', { id: event.id || '' })
    },

    handleAction() {
      const event = this.data.event as { id?: string, action?: string }
      this.triggerEvent('action', { id: event.id || '', action: event.action || '' })
    },
  },
})
