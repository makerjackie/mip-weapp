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
    valueLabel: { type: String, value: '最大价值' },
    compact: { type: Boolean, value: false },
    showDetails: { type: Boolean, value: true },
    /** 详情页四条黑条形态（figma 2058_12247）：角色引荐语 + 目标/引荐/最大价值，卡高 560rpx。 */
    tall: { type: Boolean, value: false },
    showQuote: { type: Boolean, value: false },
    maxValue: { type: String, value: '' },
  },

  data: {
    view: cooperationRoleCardView({ roleKey: '' }),
  },

  observers: {
    'roleKey, name, positioning, targetSummary, maxValue': function (
      roleKey: string,
      name: string,
      positioning: string,
      targetSummary: string,
      maxValue: string,
    ) {
      this.setData({ view: cooperationRoleCardView({ roleKey, name, positioning, targetSummary, maxValue }) })
    },
  },
})
