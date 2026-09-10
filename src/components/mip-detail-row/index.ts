/**
 * DetailRow — 46px surface row from the MIP primitive contract.
 */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    chevron: { type: Boolean, value: true },
    actionable: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      this.triggerEvent('tap', { label: this.data.label })
    },
  },
})
