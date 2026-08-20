Component({
  properties: {
    member: { type: Object, value: {} },
    compact: { type: Boolean, value: false },
    grid: { type: Boolean, value: false },
  },
  methods: {
    handleSelect() {
      const member = this.data.member as { id?: string }
      this.triggerEvent('select', { id: member.id || '' })
    },
  },
})
