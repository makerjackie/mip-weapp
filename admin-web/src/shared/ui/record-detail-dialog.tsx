import { Descriptions, Modal } from 'antd'
import type { RecordDetail } from '../../modules/admin-record-detail'
import { OVERLAY_Z_INDEX } from './overlay-z-index'

export function RecordDetailDialog({ open, detail, onClose }: {
  open: boolean
  detail: RecordDetail | null
  onClose: () => void
}) {
  return (
    <Modal
      zIndex={OVERLAY_Z_INDEX.confirmation}
      open={open}
      title={detail?.title || '记录详情'}
      footer={null}
      width={640}
      onCancel={onClose}
    >
      <Descriptions
        column={1}
        size="small"
        bordered
        items={(detail?.entries ?? []).map(entry => ({
          key: entry.label,
          label: entry.label,
          children: <span className="record-detail__value">{entry.value || '—'}</span>,
        }))}
      />
    </Modal>
  )
}
