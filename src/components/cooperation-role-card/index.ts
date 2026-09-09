import { cooperationRoleCardView } from './model'

/** 合作卡（CooperationCard，references/wechat-component-contracts.md 烘焙卡规则）。 */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    roleKey: { type: String, value: '' },
    name: { type: String, value: '' },
    positioning: { type: String, value: '' },
    targetSummary: { type: String, value: '' },
    goalLabel: { type: String, value: '我的目标' },
    referralLabel: { type: String, value: '需要引荐' },
    compact: { type: Boolean, value: false },
    showDetails: { type: Boolean, value: true },
  },

  data: {
    view: cooperationRoleCardView({ roleKey: '' }),
  },

  observers: {
    'roleKey, name, positioning, targetSummary': function (
      roleKey: string,
      name: string,
      positioning: string,
      targetSummary: string,
    ) {
      this.setData({ view: cooperationRoleCardView({ roleKey, name, positioning, targetSummary }) })
    },
  },
})
