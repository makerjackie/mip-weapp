import type { DateTimeRangeField } from './model'
import { validateDateTimeRange } from './model'

Component({
  properties: {
    title: { type: String, value: '时间' },
    startDate: { type: String, value: '' },
    startTime: { type: String, value: '' },
    endDate: { type: String, value: '' },
    endTime: { type: String, value: '' },
    endEnabled: { type: Boolean, value: true },
    optionalEnd: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
    clearable: { type: Boolean, value: true },
    clearMode: { type: String, value: 'range' },
  },

  data: {
    validationMessage: '',
  },

  observers: {
    'startDate, startTime, endDate, endTime, endEnabled': function () {
      this.presentValidation()
    },
  },

  methods: {
    presentValidation() {
      const validation = validateDateTimeRange({
        startDate: this.properties.startDate,
        startTime: this.properties.startTime,
        endDate: this.properties.endDate,
        endTime: this.properties.endTime,
      }, this.properties.endEnabled)
      this.setData({ validationMessage: validation.valid ? '' : validation.message })
    },

    change(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      if (this.properties.disabled) {
        return
      }
      const field = String(event.currentTarget.dataset.field || '') as DateTimeRangeField
      if (!['startDate', 'startTime', 'endDate', 'endTime'].includes(field)) {
        return
      }
      this.triggerEvent('change', { field, value: event.detail.value })
    },

    toggleEnd(event: WechatMiniprogram.CustomEvent<{ value: boolean }>) {
      if (!this.properties.disabled && this.properties.optionalEnd) {
        this.triggerEvent('toggle', { enabled: event.detail.value === true })
      }
    },

    clear() {
      if (this.properties.disabled) {
        return
      }
      this.triggerEvent('clear', {
        scope: this.properties.clearMode === 'end' || this.properties.optionalEnd ? 'end' : 'range',
      })
    },
  },
})
