import { opportunityModule } from '../../../../modules/mip-opportunities'
import { CITY_DIRECTORY, filterCityDirectory, groupCityDirectory, HOT_CITY_LABELS } from './city-directory'

// figma 2215_4618 超级案例详情-选择城市：搜索 + 热门城市 + 字母分组 + 右侧索引条。
// 城市字典是前端 UI 数据；城市标签 id 以服务端标签库（getCatalogs().cityTags）为准，
// 选中后通过 EventChannel 把 label（含尽力解析的 tagId）回传给编辑页。
interface CityChip {
  label: string
  selected: boolean
}

interface CityLetterGroup {
  letter: string
  cities: CityChip[]
}

interface IndexLetter {
  letter: string
  available: boolean
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    message: '',
    skeletonRows: [2, 1, 2, 1, 2],
    searchTerm: '',
    searchResults: [] as CityChip[],
    hotCities: [] as CityChip[],
    groups: [] as CityLetterGroup[],
    indexLetters: [] as IndexLetter[],
    scrollAnchor: '',
    selectedLabel: '',
  },
  cityTagIds: {} as Record<string, string>,

  onLoad(options: Record<string, string | undefined>) {
    let selectedLabel = ''
    try {
      selectedLabel = decodeURIComponent(String(options.selected || ''))
    }
    catch {
      selectedLabel = String(options.selected || '')
    }
    this.setData({ selectedLabel })
    void this.load()
  },

  async load() {
    this.setData({ state: 'loading', message: '' })
    try {
      const catalog = await opportunityModule.getCatalogs()
      this.cityTagIds = Object.fromEntries(catalog.cityTags.map(tag => [tag.label, tag.id]))
      this.render()
      this.setData({ state: 'ready' })
    }
    catch (error) {
      this.setData({ state: 'error', message: error instanceof Error ? error.message : '城市列表加载失败' })
    }
  },

  render() {
    const selected = this.data.selectedLabel
    const chip = (label: string): CityChip => ({ label, selected: label === selected })
    const groups = groupCityDirectory(CITY_DIRECTORY)
    this.setData({
      hotCities: HOT_CITY_LABELS.map(chip),
      groups: groups.map(group => ({
        letter: group.letter,
        cities: group.cities.map(entry => chip(entry.label)),
      })),
      indexLetters: groups.map(group => ({ letter: group.letter, available: true })),
    })
  },

  onSearchInput(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const term = String(event.detail.value || '').trim()
    if (!term) {
      this.setData({ searchTerm: '', searchResults: [] })
      return
    }
    this.setData({
      searchTerm: term,
      searchResults: filterCityDirectory(term)
        .map(entry => ({ label: entry.label, selected: entry.label === this.data.selectedLabel })),
    })
  },

  onJumpLetter(event: WechatMiniprogram.TouchEvent) {
    const letter = String(event.currentTarget.dataset.letter || '')
    if (event.currentTarget.dataset.available !== true && event.currentTarget.dataset.available !== 'true') {
      return
    }
    const anchor = `city-letter-${letter}`
    if (this.data.scrollAnchor === anchor) {
      return
    }
    // scroll-into-view 对同值不重播，先清空再跳，保证重复点同一字母也能回位。
    this.setData({ scrollAnchor: '' })
    wx.nextTick(() => {
      this.setData({ scrollAnchor: anchor })
    })
  },

  onPickCity(event: WechatMiniprogram.TouchEvent) {
    const label = String(event.currentTarget.dataset.label || '')
    if (!label) {
      return
    }
    const opener = this as unknown as { getOpenerEventChannel?: () => WechatMiniprogram.IAnyObject }
    const channel = typeof opener.getOpenerEventChannel === 'function' ? opener.getOpenerEventChannel() : undefined
    channel?.emit?.('citySelected', { label, tagId: this.cityTagIds[label] || '' })
    wx.navigateBack()
  },

  retry() {
    void this.load()
  },
})
