import { cooperationRoleCardView } from './model'

Component({
  properties: {
    roleKey: { type: String, value: '' },
    positioning: { type: String, value: '' },
    targetSummary: { type: String, value: '' },
    compact: { type: Boolean, value: false },
    showDetails: { type: Boolean, value: true },
  },

  data: {
    view: cooperationRoleCardView({ roleKey: '' }),
    densityClass: '',
  },

  observers: {
    'roleKey, positioning, targetSummary, compact': function (
      roleKey: string,
      positioning: string,
      targetSummary: string,
      compact: boolean,
    ) {
      this.setData({
        view: cooperationRoleCardView({ roleKey, positioning, targetSummary }),
        densityClass: compact ? 'cooperation-role-card--compact' : '',
      })
    },
  },
})
