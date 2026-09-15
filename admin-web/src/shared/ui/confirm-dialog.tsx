import { Modal } from 'antd'
import { OVERLAY_Z_INDEX } from './overlay-z-index'

export function ConfirmDialog({ open, title, description, confirmText = '确认', danger, loading, onConfirm, onCancel }: {
  open: boolean
  title: string
  description: React.ReactNode
  confirmText?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Modal
      zIndex={OVERLAY_Z_INDEX.confirmation}
      open={open}
      title={title}
      okText={confirmText}
      cancelText="取消"
      okButtonProps={{ danger, loading }}
      onOk={onConfirm}
      onCancel={onCancel}
      mask={{ closable: !loading }}
      keyboard={!loading}
    >
      <p>{description}</p>
    </Modal>
  )
}
