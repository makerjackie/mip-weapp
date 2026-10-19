import type { CatalogSelectorGroup } from '../catalog-selector/model'
import { catalogSelectorView, expandedCatalogGroup, toggleCatalogSelection } from '../catalog-selector/model'

/** 行业选择业务组件：填写信息(单选)、人才筛选(多选)、机会筛选(手风琴)共用。 */
Component({
  properties: {
    groups: { type: Array, value: [] as CatalogSelectorGroup[] },
    selectedIds: { type: Array, value: [] as string[] },
    multiple: { type: Boolean, value: false },
    maxCount: { type: Number, value: 1 },
    showPopular: { type: Boolean, value: true },
    accordion: { type: Boolean, value: false },
    plain: { type: Boolean, value: false },
    clearLabel: { type: String, value: '' },
  },

  data: {
    viewGroups: [] as ReturnType<typeof catalogSelectorView>['viewGroups'],
    popularOptions: [] as ReturnType<typeof catalogSelectorView>['popularOptions'],
    expandedGroupId: '',
    /**
     * BUG-10.6：受控回环里 selectedIds 要等宿主 setData 异步回写，快速连点时 props 仍是旧集合，
     * 第二次 onChipTap 基于旧集合整体覆盖会把第一次选择丢掉。镜像记录「最近一次对外发出的选择」：
     * tap 基于镜像计算、发出后立即更新；props observer 回写时同步为最新属性值。
     */
    emittedSelectedIds: [] as string[],
  },

  observers: {
    'groups, selectedIds, showPopular': function (groups: CatalogSelectorGroup[], selectedIds: string[], showPopular: boolean) {
      this.present(groups, selectedIds, showPopular)
    },
  },

  methods: {
    present(groups: CatalogSelectorGroup[], selectedIds: string[], showPopular = true) {
      const view = catalogSelectorView(Array.isArray(groups) ? groups : [], Array.isArray(selectedIds) ? selectedIds : [], showPopular)
      // BUG-10.6：observer 走到这说明宿主已回写 props，镜像同步为最新属性值（含宿主侧的清空/单选替换）。
      this.setData({
        viewGroups: view.viewGroups,
        popularOptions: view.popularOptions,
        emittedSelectedIds: (Array.isArray(selectedIds) ? selectedIds : []).slice(),
        expandedGroupId: expandedCatalogGroup(view.viewGroups, this.data.expandedGroupId),
      })
    },

    onClear() {
      this.emitChange([])
    },

    onGroupToggle(event: WechatMiniprogram.TouchEvent) {
      const groupId = String(event.currentTarget.dataset.groupId || '')
      this.setData({
        expandedGroupId: this.data.expandedGroupId === groupId ? '' : groupId,
      })
    },

    onChipTap(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      // BUG-10.6：基于镜像（最近一次发出的选择）计算，回写窗口内的连点不丢更新；单选/multiple 与 maxCount 语义不变。
      const result = toggleCatalogSelection(
        this.data.emittedSelectedIds,
        id,
        Boolean(this.data.multiple),
        this.data.maxCount,
      )
      this.emitChange(result.selectedIds, result.limited)
    },

    emitChange(selectedIds: string[], limited = false) {
      // BUG-10.6：发出后立刻更新镜像，宿主回写前再次 tap 以含本次结果的集合为基准。
      this.setData({ emittedSelectedIds: selectedIds.slice() })
      this.triggerEvent('change', { selectedIds, limited })
    },
  },
})
