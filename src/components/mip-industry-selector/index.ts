import type { CatalogSelectorGroup } from '../catalog-selector/model'
import { catalogSelectorView, toggleCatalogSelection } from '../catalog-selector/model'

/** 行业选择业务组件：填写信息(单选)、人才筛选(多选)、机会筛选(手风琴)共用。 */
Component({
  properties: {
    groups: { type: Array, value: [] as CatalogSelectorGroup[] },
    selectedIds: { type: Array, value: [] as string[] },
    multiple: { type: Boolean, value: false },
    maxCount: { type: Number, value: 1 },
    showPopular: { type: Boolean, value: true },
    accordion: { type: Boolean, value: false },
    clearLabel: { type: String, value: '' },
  },

  data: {
    viewGroups: [] as ReturnType<typeof catalogSelectorView>['viewGroups'],
    popularOptions: [] as ReturnType<typeof catalogSelectorView>['popularOptions'],
    expandedGroupId: '',
  },

  observers: {
    'groups, selectedIds': function (groups: CatalogSelectorGroup[], selectedIds: string[]) {
      this.present(groups, selectedIds)
    },
  },

  methods: {
    present(groups: CatalogSelectorGroup[], selectedIds: string[]) {
      const view = catalogSelectorView(Array.isArray(groups) ? groups : [], Array.isArray(selectedIds) ? selectedIds : [])
      this.setData({
        viewGroups: view.viewGroups,
        popularOptions: view.popularOptions,
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
      const result = toggleCatalogSelection(
        this.data.selectedIds,
        id,
        Boolean(this.data.multiple),
        this.data.maxCount,
      )
      this.emitChange(result.selectedIds, result.limited)
    },

    emitChange(selectedIds: string[], limited = false) {
      this.triggerEvent('change', { selectedIds, limited })
    },
  },
})
