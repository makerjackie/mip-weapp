/**
 * 玩家等级黄卡（LevelBanner，references/wechat-component-contracts.md）。
 * 装饰簇烘焙为 level-banner-deco@3x.png，组件只叠文案与进度条；不接受 deco 属性。
 */
Component({
  options: {
    virtualHost: false,
  },
  properties: {
    level: { type: String, value: 'Lv.23' },
    current: { type: Number, value: 3000 },
    target: { type: Number, value: 40000 },
    // 进度条宽度覆盖值（设计 px）；0 表示按 current/target 推导。
    fillPx: { type: Number, value: 0 },
  },
})
