import type { CatalogSelectorGroup } from './model'
import {
  catalogSelectorView,
  selectedCatalogIds,
  toggleCatalogSelection,
} from './model'

Component({
  properties: {
    title: { type: String, value: '' },
    groups: { type: Array, value: [] },
    selectedIds: { type: Array, value: [] },
    multiple: { type: Boolean, value: true },
    maxSelections: { type: Number, value: 8 },
    clearLabel: { type: String, value: '不限' },
  },

  data: {
    viewGroups: [] as ReturnType<typeof catalogSelectorView>['viewGroups'],
    popularOptions: [] as ReturnType<typeof catalogSelectorView>['popularOptions'],
    normalizedSelectedIds: [] as string[],
    /**
     * BUG-10.6：受控回环里 selectedIds 要等宿主 setData 异步回写，快速连点时 props 仍是旧集合，
     * 第二次 toggle 基于旧集合整体覆盖会把第一次选择丢掉。镜像记录「最近一次对外发出的选择」：
     * tap 基于镜像计算、发出后立即更新；props observer 回写时同步为最新属性值。
     */
    emittedSelectedIds: [] as string[],
    message: '',
  },

  observers: {
    'groups, selectedIds, multiple, maxSelections': function (
      groups: CatalogSelectorGroup[],
      selectedIds: string[],
      multiple: boolean,
      maxSelections: number,
    ) {
      this.present(groups, selectedIds, multiple, maxSelections)
    },
  },

  methods: {
    present(
      groups: CatalogSelectorGroup[],
      selectedIds: string[],
      multiple: boolean,
      maxSelections: number,
    ) {
      const normalizedSelectedIds = selectedCatalogIds(
        Array.isArray(groups) ? groups : [],
        Array.isArray(selectedIds) ? selectedIds : [],
        Boolean(multiple),
        maxSelections,
      )
      // BUG-10.6：observer 走到这说明宿主已回写 props，镜像同步为最新属性值（含宿主侧的收窄/清空）。
      this.setData({
        ...catalogSelectorView(Array.isArray(groups) ? groups : [], normalizedSelectedIds),
        normalizedSelectedIds,
        emittedSelectedIds: normalizedSelectedIds.slice(),
        message: '',
      })
    },

    clear() {
      if (!this.data.normalizedSelectedIds.length && !this.data.emittedSelectedIds.length) {
        return
      }
      this.setData({ emittedSelectedIds: [] })
      this.triggerEvent('change', { selectedIds: [] })
    },

    toggle(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      const result = toggleCatalogSelection(
        this.data.emittedSelectedIds,
        id,
        this.properties.multiple,
        this.properties.maxSelections,
      )
      if (result.limited) {
        this.setData({ message: `最多选择 ${Math.max(1, this.properties.maxSelections)} 项。` })
        return
      }
      // BUG-10.6：发出后立刻更新镜像，回写窗口内的下一次 tap 基于含本次结果的集合计算。
      this.setData({ message: '', emittedSelectedIds: result.selectedIds })
      this.triggerEvent('change', { selectedIds: result.selectedIds })
    },
  },
})
