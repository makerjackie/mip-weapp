import type { BranchId } from '../../../modules/mip'
import { mipAccessPageUrl } from '../../../modules/mip-identity'
import { mipBranchesModule, mipIdentityModule } from '../../../modules/mip-identity/client'
import { caseNavigateTo } from '../../../platform/navigation/client'

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
    // BUG-04.4（审计 2026-10-12）：selectingId 原先到 applyPrimaryBranch 才置位，
    // beginProtectedAction 的身份快照往返窗口内无锁，双击并发两次 setPrimaryBranch →
    // 先「主分会已更新」toast 又弹版本冲突失败横幅。锁提前到入口（按钮已绑
    // loading="{{selectingId === item.id}}"），转交 access 页与身份检查失败的早退路径都要复位；
    // applyPrimaryBranch 自身的 finally 负责成功路径复位。
    this.setData({ selectingId: branchId })
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
        this.setData({ selectingId: '' })
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return
      }
    }
    catch {
      this.setData({ selectingId: '', message: '身份状态暂时无法确认，请稍后重试。' })
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
