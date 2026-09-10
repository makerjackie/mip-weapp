/**
 * OrderCard — native mapping of the reference 702rpx order card. The pixel
 * fixture uses the documented reference metrics; production data can supply the
 * same structured rows and payment fields.
 */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    image: { type: String, value: '' },
    title: { type: String, value: '' },
    rows: { type: Array, value: [] },
    status: { type: String, value: '' },
    statusBrand: { type: Boolean, value: false },
    paymentLabel: { type: String, value: '' },
    payment: { type: null, value: '' },
    radius: { type: String, value: '16rpx' },
  },
  methods: {
    handleTap() {
      this.triggerEvent('tap')
    },
  },
})
