/**
 * NavBar — the reference chrome includes the simulator status bar and capsule.
 * The native page supplies the platform bar outside the rendered frame, so the
 * component accepts fixture-only controls to reproduce the 176rpx reference.
 */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    title: { type: String, value: '' },
    back: { type: Boolean, value: true },
    capsule: { type: Boolean, value: true },
    time: { type: String, value: '9:41' },
    showStatusBar: { type: Boolean, value: false },
    showCapsule: { type: Boolean, value: false },
    absolute: { type: Boolean, value: false },
  },
  methods: {
    handleBack() {
      this.triggerEvent('back')
    },
  },
})
