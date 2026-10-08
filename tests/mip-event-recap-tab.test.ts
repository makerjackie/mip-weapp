import type { EventRecapCard } from '../src/modules/mip-events'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { presentRecapCard } from '../src/components/mip-activity-card/model'

const root = process.cwd()
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')

const recapCard: EventRecapCard = {
  id: '12',
  title: 'MIP 反人性早会第 328 场',
  coverUrl: 'cloud://cover-1.jpg',
  destination: {
    provider: 'WECHAT_CHANNELS',
    type: 'ACTIVITY',
    finderUserName: 'sphMIP2026',
    feedId: 'feed-token-1',
  },
}

describe('MIW-57 往期活动 tab 回顾条目', () => {
  it('maps configured recap entries onto the recap card with a channels destination', () => {
    const view = presentRecapCard(recapCard)
    expect(view).toEqual({
      id: '12',
      title: 'MIP 反人性早会第 328 场',
      coverUrl: 'cloud://cover-1.jpg',
      videoRecaps: [{
        id: '12',
        title: 'MIP 反人性早会第 328 场',
        summary: '',
        destination: recapCard.destination,
      }],
    })
  })

  it('loads the past view from configured recaps instead of the event feed', () => {
    const page = source('src/pages/events/index.ts')
    expect(page).toContain('if (this.data.view === \'PAST\')')
    expect(page).toContain('return this.loadRecaps(options)')
    expect(page).toContain('mipEventsModule.listRecaps({ force: options.force === true })')
    expect(page).toContain('recaps.items.map(presentRecapCard)')
  })

  it('renders recap cards and a dedicated empty state for the past tab', () => {
    const view = source('src/pages/events/index.wxml')
    expect(view).toContain('variant="{{view === \'PAST\' ? \'recap\' : \'feed\'}}"')
    expect(view).toContain('wx:if="{{view === \'PAST\'}}" title="暂无往期活动"')
  })

  it('keeps the recap card tap on the channels open ability with busy-state feedback', () => {
    const card = source('src/components/mip-activity-card/index.ts')
    expect(card).toContain('openWechatChannelsDestination(recap.destination)')
    expect(card).toContain('recapBusy')
    expect(card).toContain('wx.showToast({ title: \'视频回顾暂时无法打开，请稍后重试。\', icon: \'none\' })')
  })
})
