import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminMediaFile } from '../../modules/admin-media-upload'
import type { AdminReadPage, AdminTableRow } from '../../modules/admin-read-pages'
import { GameManagementPage } from './game-management-page'
import { GrowthBadgesPage } from './growth-badges-page'
import { MediaUploadPage } from './media-upload-page'
import { OpportunitiesContentPage } from './opportunities-content-page'
import { TaskManagementPage } from './task-management-page'
import type { OperationsPageState } from './types'

vi.mock('../../shared/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/ui')>()
  return {
    ...actual,
    DataTable: ({ label, rows, onView, renderActions }: {
      label: string
      rows: AdminTableRow[]
      onView?: (row: AdminTableRow) => void
      renderActions?: (row: AdminTableRow) => React.ReactNode
    }) => (
      <div aria-label={label}>
        {rows.map((row, index) => (
          <div key={String(row.detailId || index)}>
            {onView && row.detailId ? <button onClick={() => onView(row)}>查看</button> : null}
            {renderActions?.(row)}
          </div>
        ))}
      </div>
    ),
  }
})

afterEach(cleanup)

function pageState(page: AdminReadPage, overrides: Partial<OperationsPageState> = {}): OperationsPageState {
  return {
    page,
    query: { query: '', status: '' },
    onFilterChange: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  }
}

describe('second-batch operations pages', () => {
  it('exposes task detail, create, and cursor pagination intents', async () => {
    const onWrite = vi.fn()
    const onOpenDetail = vi.fn()
    const onNextPage = vi.fn()
    render(
      <TaskManagementPage {...pageState({
        sections: [
          { title: '任务', rows: [{ detailId: 'task-1', name: '早会复盘', state: '已发布' }], columns: [{ key: 'name', label: '任务名称' }, { key: 'state', label: '状态' }] },
          { title: '近期完成记录', detailTarget: 'taskCompletions', rows: [{ detailId: 'completion-1', task: '早会复盘' }], columns: [{ key: 'task', label: '任务' }] },
        ],
        nextCursor: 'task-cursor-2',
      }, { onWrite, onOpenDetail, onNextPage })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /创建任务/ }))
    expect(onWrite).toHaveBeenCalledWith({ action: 'mip.admin.tasks.save' })
    fireEvent.click(screen.getAllByRole('button', { name: '查看' })[0])
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ route: 'tasks', id: 'task-1' }))
    fireEvent.click(screen.getByRole('button', { name: /下一页/ }))
    expect(onNextPage).toHaveBeenCalledWith('task-cursor-2')
  })

  it('forwards reviewed game row operations without rebuilding mutation input', async () => {
    const onWrite = vi.fn()
    render(
      <GameManagementPage {...pageState({
        sections: [{
          title: '赛季',
          detailTarget: 'gameSeasons',
          rows: [{
            detailId: 'season-1',
            name: '半年赛季',
            rowActions: [{
              action: 'mip.admin.game.seasons.changeStatus',
              label: '启用',
              targetId: 'season-1',
              values: { seasonId: 'season-1', expectedVersion: 2, status: 'ACTIVE' },
            }],
          }],
          columns: [{ key: 'name', label: '赛季' }],
        }],
        nextCursor: null,
      }, { onWrite })} />,
    )

    fireEvent.click(screen.getByRole('button', { name: '启用' }))
    expect(onWrite).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mip.admin.game.seasons.changeStatus',
      targetId: 'season-1',
      values: { seasonId: 'season-1', expectedVersion: 2, status: 'ACTIVE' },
    }))
  })

  it('keeps opportunity and growth write actions as exact service actions', async () => {
    const opportunityWrite = vi.fn()
    const { unmount } = render(
      <OpportunitiesContentPage {...pageState({ sections: [], nextCursor: null }, { onWrite: opportunityWrite })} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /创建机会/ }))
    expect(opportunityWrite).toHaveBeenCalledWith({ action: 'mip.admin.opportunities.save' })
    fireEvent.click(screen.getByRole('button', { name: /创建合作卡/ }))
    expect(opportunityWrite).toHaveBeenCalledWith({ action: 'mip.admin.userContent.save', values: { kind: 'COOPERATION_CARD' } })
    fireEvent.click(screen.getByRole('button', { name: /创建超级案例/ }))
    expect(opportunityWrite).toHaveBeenCalledWith({ action: 'mip.admin.userContent.save', values: { kind: 'SUPER_CASE' } })
    unmount()

    const growthWrite = vi.fn()
    render(<GrowthBadgesPage {...pageState({ sections: [], nextCursor: null }, { onWrite: growthWrite })} />)
    await userEvent.click(screen.getByRole('button', { name: /运营操作/ }))
    await userEvent.click(await screen.findByText('调整成长数据'))
    expect(growthWrite).toHaveBeenCalledWith({ action: 'mip.admin.growth.adjust' })
  })

  it('validates upload metadata and exposes upload and copy callbacks', async () => {
    const onFileChange = vi.fn()
    const onValidationError = vi.fn()
    const onUpload = vi.fn()
    const onCopyAssetId = vi.fn()
    const file = new File(['png'], 'banner.png', { type: 'image/png' }) as AdminMediaFile
    const { container, rerender } = render(
      <MediaUploadPage
        purposeOptions={[{ value: 'BANNER', label: 'Banner 图片' }]}
        selectedPurpose="BANNER"
        file={null}
        previewUrl=""
        onPurposeChange={vi.fn()}
        onFileChange={onFileChange}
        onValidationError={onValidationError}
        onUpload={onUpload}
        onCopyAssetId={onCopyAssetId}
      />,
    )
    const picker = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(picker, file as File)
    expect(onFileChange).toHaveBeenCalledWith(file)
    expect(onValidationError).not.toHaveBeenCalled()

    rerender(
      <MediaUploadPage
        purposeOptions={[{ value: 'BANNER', label: 'Banner 图片' }]}
        selectedPurpose="BANNER"
        file={file}
        previewUrl="blob:banner"
        result={{ assetId: '123e4567-e89b-42d3-a456-426614174000', imageUrl: 'cloud://env/banner.png' }}
        onPurposeChange={vi.fn()}
        onFileChange={onFileChange}
        onValidationError={onValidationError}
        onUpload={onUpload}
        onCopyAssetId={onCopyAssetId}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /上传图片/ }))
    expect(onUpload).toHaveBeenCalledWith(file, 'BANNER')
    fireEvent.click(screen.getByRole('button', { name: /复制/ }))
    expect(onCopyAssetId).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000')
  })
})
