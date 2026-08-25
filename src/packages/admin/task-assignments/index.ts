import type { AssignableTaskMember } from '../../../modules/mip-tasks'
import { mipTasksModule } from '../../../modules/mip-tasks'

interface MemberView extends AssignableTaskMember {
  selected: boolean
  statusText: string
  cardStyle: string
}

function memberView(member: AssignableTaskMember, selectedRefs: string[]): MemberView {
  return {
    ...member,
    selected: selectedRefs.includes(member.memberRef),
    statusText: member.assignmentStatus === 'ACTIVE' ? '已派发' : member.assignmentStatus === 'REVOKED' ? '已撤销' : '未派发',
    cardStyle: selectedRefs.includes(member.memberRef)
      ? 'border-color: var(--color-brand); background-color: var(--color-brand-soft);'
      : 'border-color: var(--color-line); background-color: var(--color-panel);',
  }
}

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'empty' | 'error' | 'forbidden' | 'conflict',
    taskId: '',
    expectedVersion: 0,
    taskName: '',
    query: '',
    members: [] as MemberView[],
    nextCursor: '',
    selectedRefs: [] as string[],
    selectedOnly: false,
    loadingMore: false,
    processing: false,
    message: '',
  },

  onLoad(options: Record<string, string | undefined>) {
    this.setData({ taskId: String(options.taskId || ''), expectedVersion: Number(options.version || 0) })
    void this.loadPage()
  },

  async onPullDownRefresh() {
    try {
      await this.loadMembers(true)
    }
    finally {
      wx.stopPullDownRefresh()
    }
  },

  async loadPage() {
    this.setData({ state: 'loading', message: '' })
    try {
      const task = await mipTasksModule.query.getAdminTask(this.data.taskId, true)
      if (task.assignmentMode !== 'SELECTED') {
        throw new Error('当前任务不是指定成员任务')
      }
      this.setData({ taskName: task.name, expectedVersion: task.version })
      await this.loadMembers(true)
    }
    catch (error) {
      this.handleError(error, '任务派发加载失败')
    }
  },

  async loadMembers(force = false) {
    try {
      const page = await mipTasksModule.query.listAssignableMembers({
        taskId: this.data.taskId,
        query: this.data.query,
      }, undefined, 30, force)
      const members = page.items.map(item => memberView(item, this.data.selectedRefs))
      this.setData({
        state: members.length ? 'ready' : 'empty',
        members,
        nextCursor: page.nextCursor || '',
        message: '',
      })
    }
    catch (error) {
      this.handleError(error, '成员列表加载失败')
    }
  },

  async loadMore() {
    if (!this.data.nextCursor || this.data.loadingMore) {
      return
    }
    this.setData({ loadingMore: true, message: '' })
    try {
      const page = await mipTasksModule.query.listAssignableMembers({
        taskId: this.data.taskId,
        query: this.data.query,
      }, this.data.nextCursor, 30, true)
      this.setData({
        members: this.data.members.concat(page.items.map(item => memberView(item, this.data.selectedRefs))),
        nextCursor: page.nextCursor || '',
      })
    }
    catch (error) {
      this.setData({ message: error instanceof Error ? error.message : '更多成员加载失败' })
    }
    finally {
      this.setData({ loadingMore: false })
    }
  },

  updateQuery(event: WechatMiniprogram.CustomEvent<{ value: string }>) { this.setData({ query: event.detail.value }) },
  searchMembers() {
    this.clearSelection()
    this.setData({ selectedOnly: false })
    void this.loadMembers(true)
  },
  toggleSelectedOnly() { this.setData({ selectedOnly: !this.data.selectedOnly }) },

  toggleMember(event: WechatMiniprogram.TouchEvent) {
    const memberRef = String(event.currentTarget.dataset.ref || '')
    if (!memberRef) {
      return
    }
    if (!this.data.selectedRefs.includes(memberRef) && this.data.selectedRefs.length >= 100) {
      this.setData({ message: '每次最多选择 100 名成员' })
      return
    }
    const selectedRefs = this.data.selectedRefs.includes(memberRef)
      ? this.data.selectedRefs.filter(item => item !== memberRef)
      : this.data.selectedRefs.concat(memberRef)
    this.setData({ selectedRefs, members: this.data.members.map(item => memberView(item, selectedRefs)) })
  },

  clearSelection() {
    this.setData({ selectedRefs: [], members: this.data.members.map(item => memberView(item, [])) })
  },

  async changeAssignments(event: WechatMiniprogram.TouchEvent) {
    const action = String(event.currentTarget.dataset.action || '')
    if (!['assign', 'revoke'].includes(action) || !this.data.selectedRefs.length || this.data.processing) {
      return
    }
    const label = action === 'assign' ? '派发' : '撤销'
    const modal = await wx.showModal({
      title: `确认${label}任务`,
      content: `本次选择 ${this.data.selectedRefs.length} 名成员。已有记录会保留。`,
    })
    if (!modal.confirm) {
      return
    }
    this.setData({ processing: true, message: '' })
    try {
      const result = action === 'assign'
        ? await mipTasksModule.mutation.assignMembers(
            this.data.taskId,
            this.data.expectedVersion,
            this.data.selectedRefs,
          )
        : await mipTasksModule.mutation.revokeMembers(
            this.data.taskId,
            this.data.expectedVersion,
            this.data.selectedRefs,
          )
      wx.showToast({ title: `${label}完成 ${result.changedCount} 人`, icon: 'none' })
      this.clearSelection()
      await this.loadMembers()
    }
    catch (error) { this.handleError(error, `任务${label}失败`) }
    finally { this.setData({ processing: false }) }
  },

  handleError(error: unknown, fallback: string) {
    const code = (error as { code?: string })?.code
    this.setData({
      state: code === 'FORBIDDEN' ? 'forbidden' : code === 'CONFLICT' ? 'conflict' : 'error',
      message: error instanceof Error ? error.message : fallback,
    })
  },
})
