import type { BranchId } from '../../../modules/mip'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../modules/platform/case-navigation'

Page({
  resumeBranchId: '' as BranchId | '',

  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error',
    branches: [] as Array<{
      id: string
      name: string
      cityName: string
      selected: boolean
    }>,
    selectingId: '',
    message: '',
  },

  onLoad(query: Record<string, string | undefined>) {
    const branchId = String(query.branchId || '') as BranchId | ''
    this.resumeBranchId = query.mipResume === 'EDIT_PROFILE' ? branchId : ''
    void this.initialize()
  },

  async initialize() {
    await this.loadBranches()
    if (this.resumeBranchId) {
      const branchId = this.resumeBranchId
      this.resumeBranchId = ''
      await this.applyPrimaryBranch(branchId)
    }
  },

  async loadBranches() {
    this.setData({ state: 'loading', message: '' })
    try {
      const snapshot = mipIdentityModule.peekSnapshot()
      const result = await mipBranchesModule.load(snapshot?.primaryBranchId, snapshot?.userVersion)
      const branches = result.branches.map(branch => ({
        ...branch,
        selected: branch.id === result.primaryBranchId,
      }))
      this.setData({ state: branches.length ? 'ready' : 'empty', branches })
    }
    catch (error) {
      this.setData({
        state: 'error',
        message: error instanceof Error ? error.message : '城市分会加载失败',
      })
    }
  },

  async selectBranch(event: WechatMiniprogram.TouchEvent) {
    const branchId = String(event.currentTarget.dataset.id || '') as BranchId
    if (!branchId || this.data.selectingId) {
      return
    }
    try {
      const session = await mipIdentityModule.beginProtectedAction({
        action: 'EDIT_PROFILE',
        source: {
          navigation: 'redirectTo',
          route: '/packages/member/mip-branches/index',
          query: { branchId },
        },
      })
      if (!session.decision.ready) {
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
    }
    catch {
      this.setData({ message: '身份状态暂时无法确认，请稍后重试。' })
      return
    }
    await this.applyPrimaryBranch(branchId)
  },

  async applyPrimaryBranch(branchId: BranchId) {
    const snapshot = mipIdentityModule.peekSnapshot() || await mipIdentityModule.loadSnapshot()
    this.setData({ selectingId: branchId, message: '' })
    try {
      const result = await mipBranchesModule.setPrimaryBranch(branchId, snapshot.userVersion)
      this.setData({
        branches: this.data.branches.map(branch => ({
          ...branch,
          selected: branch.id === result.primaryBranchId,
        })),
      })
      wx.showToast({ title: '主分会已更新', icon: 'success' })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '主分会更新失败，请重试。' })
    }
    finally {
      this.setData({ selectingId: '' })
    }
  },
})
