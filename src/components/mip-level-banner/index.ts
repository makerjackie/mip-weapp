/**
 * 玩家等级黄卡（LevelBanner，references/wechat-component-contracts.md）。
 * 原图左侧含示例文字与进度条，只展示右半部分装饰，业务数值由组件绘制。
 */
Component({
  options: {
    virtualHost: false,
    styleIsolation: 'apply-shared',
  },
  properties: {
    level: { type: String, value: 'Lv.23' },
    current: { type: Number, value: 3000 },
    target: { type: Number, value: 40000 },
    // 进度条宽度覆盖值（设计 px）；0 表示按 current/target 推导。
    fillPx: { type: Number, value: 0 },
  },
})
