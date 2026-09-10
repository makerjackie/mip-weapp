/**
 * FormFieldRow — editable-looking 46px primitive. The contract uses a tap
 * action rather than embedding a control, so callers can own picker/input UX.
 */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    label: { type: String, value: '' },
    value: { type: String, value: '' },
    placeholder: { type: String, value: '' },
    trailing: { type: String, value: '' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) {
        return
      }
      this.triggerEvent('tap', { label: this.data.label })
    },
  },
})
