import { CopyOutlined, DeleteOutlined, InboxOutlined, UploadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Image, Input, Select, Space, Typography, Upload } from 'antd'
import type { UploadFile } from 'antd'
import {
  ADMIN_MEDIA_MAX_IMAGE_BYTES,
  validateAdminMediaFileMetadata,
  type AdminMediaFile,
  type AdminMediaPurpose,
  type AdminMediaUploadResult,
} from '../../modules/admin-media-upload'
import { PageHeader } from '../../shared/ui'
import './operations-pages.css'

export interface MediaUploadPageProps {
  purposeOptions: ReadonlyArray<{ value: AdminMediaPurpose; label: string }>
  selectedPurpose: AdminMediaPurpose | ''
  file: AdminMediaFile | null
  previewUrl: string
  busy?: boolean
  error?: string
  result?: AdminMediaUploadResult | null
  copied?: boolean
  demoMode?: boolean
  onPurposeChange: (purpose: AdminMediaPurpose) => void
  onFileChange: (file: AdminMediaFile | null) => void
  onValidationError?: (message: string) => void
  onUpload: (file: AdminMediaFile, purpose: AdminMediaPurpose) => void
  onCopyAssetId?: (assetId: string) => void
}

export function MediaUploadPage({
  purposeOptions,
  selectedPurpose,
  file,
  previewUrl,
  busy,
  error,
  result,
  copied,
  demoMode,
  onPurposeChange,
  onFileChange,
  onValidationError,
  onUpload,
  onCopyAssetId,
}: MediaUploadPageProps) {
  const uploadFiles: UploadFile[] = file
    ? [{ uid: file.name, name: file.name, size: file.size, type: file.type, status: 'done' }]
    : []
  const unavailable = purposeOptions.length === 0

  return (
    <>
      <PageHeader
        title="素材上传"
        description="上传运营页面使用的图片，并获取可复制的素材 ID"
        eyebrow={demoMode ? '演示模式' : undefined}
      />
      <div className="media-upload-layout">
        <Card title="上传图片" className="media-upload-card">
          <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <label>
              <Typography.Text>素材用途</Typography.Text>
              <Select<AdminMediaPurpose>
                aria-label="素材用途"
                value={selectedPurpose || undefined}
                options={[...purposeOptions]}
                disabled={busy || unavailable}
                onChange={onPurposeChange}
                style={{ width: '100%', marginTop: 8 }}
              />
            </label>
            <Upload.Dragger
              accept="image/png,image/jpeg"
              disabled={busy || unavailable}
              fileList={uploadFiles}
              maxCount={1}
              multiple={false}
              beforeUpload={(next) => {
                try {
                  validateAdminMediaFileMetadata(next)
                  onFileChange(next)
                }
                catch (reason) {
                  onValidationError?.(reason instanceof Error ? reason.message : '图片无效')
                }
                return Upload.LIST_IGNORE
              }}
              onRemove={() => { onFileChange(null); return true }}
              showUploadList={false}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">选择或拖入图片</p>
              <p className="ant-upload-hint">支持 PNG、JPEG，文件不超过 1MB</p>
            </Upload.Dragger>
            {file ? (
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text>{file.name} · {formatBytes(file.size)}</Typography.Text>
                <Button aria-label="移除图片" icon={<DeleteOutlined />} onClick={() => onFileChange(null)} />
              </Space>
            ) : null}
            {previewUrl ? <Image src={previewUrl} alt="本地待上传图片预览" preview={false} /> : null}
            {unavailable ? <Alert type="error" showIcon title="当前账号没有可上传的素材用途。" /> : null}
            {demoMode ? <Alert type="info" showIcon title="演示模式不会向服务端上传文件。" /> : null}
            {error ? <Alert type="error" showIcon title={error} /> : null}
            <Button
              type="primary"
              icon={<UploadOutlined />}
              block
              loading={busy}
              disabled={busy || demoMode || unavailable || !file || !selectedPurpose}
              onClick={() => file && selectedPurpose && onUpload(file, selectedPurpose)}
            >
              上传图片
            </Button>
          </Space>
        </Card>
        <Card title="使用说明" className="media-upload-card">
          <Space orientation="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Paragraph>
              图片由服务端执行格式、尺寸、内容安全和权限校验。上传成功不代表相关内容已经发布。
            </Typography.Paragraph>
            <dl className="detail-fields">
              <div><dt>文件格式</dt><dd>PNG、JPEG</dd></div>
              <div><dt>文件大小</dt><dd>不超过 {formatBytes(ADMIN_MEDIA_MAX_IMAGE_BYTES)}</dd></div>
              <div><dt>浏览器预览</dt><dd>仅显示当前本地文件</dd></div>
            </dl>
            {result ? (
              <section aria-live="polite">
                <Alert type="success" showIcon title="素材已保存" />
                <Typography.Text>素材 ID</Typography.Text>
                <Space.Compact block style={{ marginTop: 8 }}>
                  <Input aria-label="素材 ID" value={result.assetId} readOnly />
                  <Button
                    icon={<CopyOutlined />}
                    disabled={!onCopyAssetId}
                    onClick={() => onCopyAssetId?.(result.assetId)}
                  >{copied ? '已复制' : '复制'}</Button>
                </Space.Compact>
                <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>
                  保存 Banner、活动、机会、案例或任务时，将素材 ID 填入对应字段。
                </Typography.Paragraph>
              </section>
            ) : null}
          </Space>
        </Card>
      </div>
    </>
  )
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`
}
