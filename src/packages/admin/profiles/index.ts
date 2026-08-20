import type { AdminListSnapshot, AdminListState } from '@weapp/shared/admin-list'
import type { AdminProfileItem } from '../../../modules/admin/types'
import { createAdminListController } from '@weapp/shared/admin-list'
import { adminModule } from '../../../modules/admin/client'
import { adminLoadFailure } from '../shared/page-state'

type ProfileView = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED'

const emptyCopy: Record<ProfileView, { title: string, description: string }> = {
  PENDING: { title: '所有资料都处理完了', description: '新提交的资料会出现在这里。' },
  APPROVED: { title: '还没有公开成员', description: '审核通过的成员会出现在这里。' },
  SUSPENDED: { title: '没有暂停展示的成员', description: '需要暂时隐藏的资料会集中在这里。' },
  REJECTED: { title: '还没有驳回记录', description: '用户重新提交后会回到待审核。' },
}

const profileList = createAdminListController<AdminProfileItem, ProfileView, string>({
  getId: profile => profile.id,
  getQueryKey: view => view,
  async loadPage({ query, force }) {
    const items = await adminModule.listProfiles(query, { force })
    return { items, nextCursor: null, totalCount: items.length }
  },
  mapError(error, context) {
    const failure = adminLoadFailure(error, {
      hasContent: context.hasContent,
      fallbackMessage: '资料队列加载失败',
    })
    return {
      message: failure.message,
      state: failure.state === 'forbidden' ? 'forbidden' : 'error',
    }
  },
})

function listData(snapshot: AdminListSnapshot<AdminProfileItem, string>) {
  return {
    state: snapshot.state,
    profiles: snapshot.items,
    message: snapshot.message,
  }
}

Page({
  data: {
    state: 'loading' as AdminListState,
    view: 'PENDING' as ProfileView,
    profiles: [] as AdminProfileItem[],
    processingId: '',
    emptyTitle: emptyCopy.PENDING.title,
    emptyDescription: emptyCopy.PENDING.description,
    message: '',
  },

  onShow() {
    void this.loadProfiles()
  },

  changeView(event: WechatMiniprogram.CustomEvent<{ value: ProfileView }>) {
    const view = event.detail.value
    this.setData({
      view,
      emptyTitle: emptyCopy[view].title,
      emptyDescription: emptyCopy[view].description,
    })
    void this.loadProfiles()
  },

  async loadProfiles(force = false) {
    this.setData(listData(await profileList.refresh(this.data.view, { force })))
  },

  async onPullDownRefresh() {
    try {
      await this.loadProfiles(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async review(event: WechatMiniprogram.TouchEvent) {
    const profileId = String(event.currentTarget.dataset.profileId || '')
    const decision = String(event.currentTarget.dataset.decision || '') as 'approve' | 'reject'
    if (!profileId || !['approve', 'reject'].includes(decision)) {
      return
    }
    if (this.data.processingId) {
      return
    }
    // Confirm latch before showModal so stacked taps cannot open parallel dialogs.
    this.setData({ processingId: profileId, message: '' })
    try {
      const modal = await wx.showModal({
        title: decision === 'approve' ? '通过资料' : '驳回资料',
        content: decision === 'approve' ? '通过后资料会进入成员推荐。' : '驳回后资料不会公开，用户可修改后再次提交。',
        confirmColor: decision === 'approve' ? '#235B43' : '#B8453E',
      })
      if (!modal.confirm) {
        return
      }
      await adminModule.reviewProfile(profileId, decision)
      wx.showToast({ title: decision === 'approve' ? '已通过' : '已驳回', icon: 'success' })
      await this.loadProfiles()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '审核失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },

  async setVisibility(event: WechatMiniprogram.TouchEvent) {
    const profileId = String(event.currentTarget.dataset.profileId || '')
    const status = String(event.currentTarget.dataset.status || '') as 'APPROVED' | 'SUSPENDED'
    if (!profileId || !['APPROVED', 'SUSPENDED'].includes(status)) {
      return
    }
    if (this.data.processingId) {
      return
    }
    const restoring = status === 'APPROVED'
    // Confirm latch before showModal so stacked taps cannot open parallel dialogs.
    this.setData({ processingId: profileId, message: '' })
    try {
      const modal = await wx.showModal({
        title: restoring ? '恢复公开' : '暂停展示',
        content: restoring ? '恢复后该成员会重新进入公开推荐。' : '暂停后资料立即从成员推荐中隐藏，后续可以恢复。',
        confirmText: restoring ? '恢复' : '暂停',
        confirmColor: restoring ? '#235B43' : '#B8453E',
      })
      if (!modal.confirm) {
        return
      }
      await adminModule.setProfileStatus(profileId, status)
      wx.showToast({ title: restoring ? '已恢复' : '已暂停', icon: 'success' })
      await this.loadProfiles()
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '状态更新失败' })
    }
    finally {
      this.setData({ processingId: '' })
    }
  },
})
