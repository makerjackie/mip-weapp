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
      this.setData({
        ...catalogSelectorView(Array.isArray(groups) ? groups : [], normalizedSelectedIds),
        normalizedSelectedIds,
        message: '',
      })
    },

    clear() {
      if (!this.data.normalizedSelectedIds.length) {
        return
      }
      this.triggerEvent('change', { selectedIds: [] })
    },

    toggle(event: WechatMiniprogram.TouchEvent) {
      const id = String(event.currentTarget.dataset.id || '')
      const result = toggleCatalogSelection(
        this.data.normalizedSelectedIds,
        id,
        this.properties.multiple,
        this.properties.maxSelections,
      )
      if (result.limited) {
        this.setData({ message: `最多选择 ${Math.max(1, this.properties.maxSelections)} 项。` })
        return
      }
      this.setData({ message: '' })
      this.triggerEvent('change', { selectedIds: result.selectedIds })
    },
  },
})
