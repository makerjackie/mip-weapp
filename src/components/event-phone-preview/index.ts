Component({
  properties: {
    visible: { type: Boolean, value: false },
    model: { type: Object, value: null },
  },

  methods: {
    close() {
      this.triggerEvent('close')
    },

    stopPropagation() {},
  },
})
