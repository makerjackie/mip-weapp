import { Modal } from 'antd'

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
      open={open}
      title={title}
      okText={confirmText}
      cancelText="取消"
      okButtonProps={{ danger, loading }}
      onOk={onConfirm}
      onCancel={onCancel}
      maskClosable={!loading}
      keyboard={!loading}
    >
      <p>{description}</p>
    </Modal>
  )
}
