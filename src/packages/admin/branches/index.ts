import type { AdminBranch, AdminBranchBlockers } from '../../../modules/mip-admin'
import type { AdminPageState } from '../shared/page-state'
import { hasCapability, MipAdminError, mipAdminModule } from '../../../modules/mip-admin'
import { adminLoadFailure, isAdminVersionConflict } from '../shared/page-state'

type BranchView = AdminBranch & { statusText: string }

function branchView(branch: AdminBranch): BranchView {
  return {
    ...branch,
    statusText: branch.status === 'ACTIVE' ? '启用' : '停用',
  }
}

function blockerCount(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0
}

function blockersFromError(error: MipAdminError): AdminBranchBlockers | null {
  const source = error.details?.blockers
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return null
  }
  const blockers = source as Record<string, unknown>
  return {
    activeMemberships: blockerCount(blockers.activeMemberships),
    activeBranchAdmins: blockerCount(blockers.activeBranchAdmins),
    publishedEvents: blockerCount(blockers.publishedEvents),
    publishedOpportunities: blockerCount(blockers.publishedOpportunities),
  }
}

function blockerMessage(blockers: AdminBranchBlockers) {
  return `当前仍有关联记录：成员 ${blockers.activeMemberships}，城市管理员 ${blockers.activeBranchAdmins}，已发布活动 ${blockers.publishedEvents}，已发布机会 ${blockers.publishedOpportunities}。`
}

Page({
  data: {
    state: 'loading' as AdminPageState,
    branches: [] as BranchView[],
    canManage: false,
    editorId: '',
    editorVersion: 0,
    branchKey: '',
    name: '',
    cityName: '',
    summary: '',
    processing: false,
    message: '',
  },

  onShow() {
    void this.loadBranches()
  },

  async onPullDownRefresh() {
    try {
      await this.loadBranches(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadBranches(force = false) {
    const hasContent = this.data.branches.length > 0
    if (!hasContent) {
      this.setData({ state: 'loading', message: '' })
    }
    try {
      const session = await mipAdminModule.getSession(force)
      const canManage = hasCapability(session.capabilities, 'branches.manage')
      if (!canManage) {
        this.setData({ state: 'forbidden', canManage: false, branches: [], message: '' })
        return
      }
      const response = await mipAdminModule.listBranches(force)
      this.setData({
        state: 'ready',
        canManage: true,
        branches: response.items.map(branchView),
        message: '',
      })
    }
    catch (error) {
      this.setData(adminLoadFailure(error, { hasContent, fallbackMessage: '城市分会加载失败' }))
    }
  },

  updateField(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const field = String(event.currentTarget.dataset.field || '')
    if (['branchKey', 'name', 'cityName', 'summary'].includes(field)) {
      this.setData({ [field]: event.detail.value })
    }
  },

  editBranch(event: WechatMiniprogram.TouchEvent) {
    const branch = this.data.branches.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!branch || this.data.processing) {
      return
    }
    this.setData({
      editorId: branch.id,
      editorVersion: branch.version,
      branchKey: branch.branchKey,
      name: branch.name,
      cityName: branch.cityName,
      summary: branch.summary,
      message: '',
    })
  },

  resetEditor() {
    this.setData({
      editorId: '',
      editorVersion: 0,
      branchKey: '',
      name: '',
      cityName: '',
      summary: '',
    })
  },

  async saveBranch() {
    if (!this.data.canManage || this.data.processing) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      if (this.data.editorId) {
        await mipAdminModule.mutate(() => mipAdminModule.gateway.updateBranch({
          branchId: this.data.editorId,
          expectedVersion: this.data.editorVersion,
          name: this.data.name,
          cityName: this.data.cityName,
          summary: this.data.summary,
        }))
      }
      else {
        await mipAdminModule.mutate(() => mipAdminModule.gateway.createBranch({
          branchKey: this.data.branchKey,
          name: this.data.name,
          cityName: this.data.cityName,
          summary: this.data.summary,
        }))
      }
      wx.showToast({ title: '分会已保存', icon: 'success' })
      this.resetEditor()
      await this.loadBranches(true)
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.resetEditor()
        this.setData({ state: 'conflict', message: '分会信息已更新，请重新加载后再编辑。' })
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '分会保存失败' })
      }
    }
    finally {
      this.setData({ processing: false })
    }
  },

  async changeStatus(event: WechatMiniprogram.TouchEvent) {
    const branch = this.data.branches.find(item => item.id === String(event.currentTarget.dataset.id || ''))
    if (!branch || !this.data.canManage || this.data.processing) {
      return
    }
    const status = branch.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    const confirmation = await wx.showModal({
      title: status === 'INACTIVE' ? '停用城市分会' : '启用城市分会',
      content: status === 'INACTIVE'
        ? `停用前将检查 ${branch.name} 的成员、管理员、活动和机会。`
        : `确认启用 ${branch.name}。`,
      confirmText: status === 'INACTIVE' ? '停用' : '启用',
    }).catch(() => null)
    if (!confirmation?.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      await mipAdminModule.mutate(() => mipAdminModule.gateway.changeBranchStatus({
        branchId: branch.id,
        status,
        expectedVersion: branch.version,
      }))
      wx.showToast({ title: status === 'INACTIVE' ? '分会已停用' : '分会已启用', icon: 'success' })
      await this.loadBranches(true)
    }
    catch (error) {
      if (isAdminVersionConflict(error)) {
        this.setData({ state: 'conflict', message: '分会状态已更新，请重新加载后再操作。' })
      }
      else if (error instanceof MipAdminError && error.code === 'BRANCH_DEACTIVATION_BLOCKED') {
        const blockers = blockersFromError(error)
        if (blockers) {
          this.setData({
            branches: this.data.branches.map(item => item.id === branch.id ? branchView({ ...item, blockers }) : item),
            message: blockerMessage(blockers),
          })
        }
        else {
          this.setData({ message: error.message })
        }
      }
      else {
        this.setData({ message: error instanceof Error ? error.message : '分会状态更新失败' })
      }
    }
    finally {
      this.setData({ processing: false })
    }
  },
})
