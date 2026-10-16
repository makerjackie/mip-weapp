import { UploadOutlined } from '@ant-design/icons'
import { Button, Tag, Upload, message as staticMessage } from 'antd'
import { useEffect, useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { AdminMediaUploadError, type AdminMediaFile, type AdminMediaPurpose } from '../../modules/admin-media-upload'
import { humanizeError } from './humanize-error'
import { useMediaPreview } from './media-preview-context'

type CustomRequestOption = { file: unknown; onSuccess?: (response: unknown) => void; onError?: (error: Error) => void }

function asFile(file: unknown): File | null {
  return file instanceof File ? file : null
}

/**
 * Safely access the admin session. Returns null when outside a SessionProvider
 * (e.g. in unit tests that render MutationDialog without a full provider tree).
 */
function useOptionalSession() {
  try {
    return useAdminSession()
  }
  catch {
    return null
  }
}

const msg = {
  success: (text: string) => staticMessage.success(text),
  error: (text: string) => staticMessage.error(text),
  info: (text: string) => staticMessage.info(text),
}

const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg']
const MAX_IMAGE_BYTES = 1024 * 1024

/**
 * A single-asset field that lets the operator upload an image and auto-fills the assetId.
 * Replaces manual UUID entry with a point-and-click upload + preview.
 * Designed to work inside Ant Design Form.Item (receives value/onChange from form).
 */
export function AssetUploader({
  purpose,
  value = '',
  onChange,
  placeholder = '上传图片后自动填入',
  disabled,
}: {
  purpose: AdminMediaPurpose
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const session = useOptionalSession()
  const client = session?.client
  const demoMode = session?.demoMode ?? false
  const [uploading, setUploading] = useState(false)
  const [uploadedAsset, setUploadedAsset] = useState<{ id: string; url: string } | null>(null)
  const media = useMediaPreview()
  const previewUrl = uploadedAsset?.id === value ? uploadedAsset.url : media.urls[value] || ''
  useEffect(() => {
    const current = uploadedAsset
    // 服务端返回 cloud:// 文件 id，浏览器无法加载；预览一律用本地 blob，替换或卸载时回收。
    return () => {
      if (current?.url.startsWith('blob:')) URL.revokeObjectURL(current.url)
      if (current) media.forget(current.id)
    }
  }, [uploadedAsset, media])

  const handleUpload = async (option: CustomRequestOption) => {
    const file = asFile(option.file)
    if (!file) return
    if (!client) {
      msg.error('当前环境无法上传图片')
      option.onError?.(new Error('无上传通道'))
      return
    }
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      msg.error('仅支持 PNG 或 JPEG 格式的图片')
      option.onError?.(new Error('格式无效'))
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      msg.error('图片大小不能超过 1MB')
      option.onError?.(new Error('图片过大'))
      return
    }
    if (demoMode) {
      msg.info('演示模式不会上传图片')
      option.onSuccess?.({})
      return
    }
    setUploading(true)
    try {
      const mediaFile: AdminMediaFile = {
        name: file.name,
        size: file.size,
        type: file.type,
        arrayBuffer: () => file.arrayBuffer(),
      }
      const result = await client.uploadImage(mediaFile, purpose)
      const localPreviewUrl = URL.createObjectURL(file)
      onChange?.(result.assetId)
      setUploadedAsset({ id: result.assetId, url: localPreviewUrl })
      media.remember(result.assetId, localPreviewUrl)
      msg.success('图片已上传')
      option.onSuccess?.(result)
    }
    catch (error) {
      const text = error instanceof AdminMediaUploadError ? error.message : humanizeError(error)
      msg.error(text)
      option.onError?.(error instanceof Error ? error : new Error(text))
    }
    finally {
      setUploading(false)
    }
  }

  const uploadTrigger = (labelText: string) => (
    <Upload
      accept=".png,.jpg,.jpeg"
      showUploadList={false}
      customRequest={handleUpload}
      disabled={disabled || uploading}
    >
      <Button icon={<UploadOutlined />} size="small" loading={uploading} disabled={disabled}>
        {uploading ? '上传中…' : labelText}
      </Button>
    </Upload>
  )

  return (
    <div className="asset-uploader">
      {previewUrl ? (
        <div className="asset-uploader__cover">
          <img src={previewUrl} alt="预览" />
          <div className="asset-uploader__cover-actions">
            {uploadTrigger('重新上传')}
            <Button size="small" type="text" danger disabled={disabled || uploading} onClick={() => { onChange?.(''); setUploadedAsset(null) }}>移除</Button>
          </div>
        </div>
      ) : value ? (
        <div className="asset-uploader__cover asset-uploader__cover--saved">
          <span className="asset-uploader__saved">已保存封面，可重新上传覆盖</span>
          <div className="asset-uploader__cover-actions">
            {uploadTrigger('重新上传')}
            <Button size="small" type="text" danger disabled={disabled || uploading} onClick={() => { onChange?.(''); setUploadedAsset(null) }}>清除</Button>
          </div>
        </div>
      ) : (
        <Upload.Dragger
          accept=".png,.jpg,.jpeg"
          showUploadList={false}
          customRequest={handleUpload}
          disabled={disabled || uploading}
          className="asset-dragger"
        >
          <p className="asset-dragger__icon"><UploadOutlined /></p>
          <p className="asset-dragger__text">{uploading ? '上传中…' : (placeholder || '点击或拖拽上传图片')}</p>
          <p className="asset-dragger__hint">支持 JPG、PNG，单张不超过 1MB</p>
        </Upload.Dragger>
      )}
    </div>
  )
}

/**
 * A multi-asset field for asset lists (e.g. event content media).
 * Lets the operator upload multiple images; each upload auto-appends an assetId entry.
 */
export function AssetListUploader({
  purpose,
  value = '',
  onChange,
  disabled,
  maxCount = 12,
}: {
  purpose: AdminMediaPurpose
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  maxCount?: number
}) {
  const session = useOptionalSession()
  const client = session?.client
  const demoMode = session?.demoMode ?? false
  const [uploading, setUploading] = useState(false)
  const [previews, setPreviews] = useState<Array<{ assetId: string; imageUrl: string }>>([])
  const media = useMediaPreview()
  useEffect(() => {
    const current = previews
    // 同 AssetUploader：预览使用本地 blob，条目移除或组件卸载时回收。
    return () => {
      for (const item of current) {
        if (item.imageUrl.startsWith('blob:')) URL.revokeObjectURL(item.imageUrl)
        media.forget(item.assetId)
      }
    }
  }, [previews, media])

  const lines = value.split('\n').filter(Boolean)
  const canAddMore = lines.length < maxCount

  const handleUpload = async (option: CustomRequestOption) => {
    const file = asFile(option.file)
    if (!file) return
    if (!client) {
      msg.error('当前环境无法上传图片')
      option.onError?.(new Error('无上传通道'))
      return
    }
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      msg.error('仅支持 PNG 或 JPEG 格式的图片')
      option.onError?.(new Error('格式无效'))
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      msg.error('图片大小不能超过 1MB')
      option.onError?.(new Error('图片过大'))
      return
    }
    if (demoMode) {
      msg.info('演示模式不会上传图片')
      option.onSuccess?.({})
      return
    }
    setUploading(true)
    try {
      const mediaFile: AdminMediaFile = {
        name: file.name,
        size: file.size,
        type: file.type,
        arrayBuffer: () => file.arrayBuffer(),
      }
      const result = await client.uploadImage(mediaFile, purpose)
      const localPreviewUrl = URL.createObjectURL(file)
      const next = [...lines, result.assetId].join('\n')
      onChange?.(next)
      setPreviews(prev => [...prev, { assetId: result.assetId, imageUrl: localPreviewUrl }])
      media.remember(result.assetId, localPreviewUrl)
      msg.success(`图片已上传（${lines.length + 1}/${maxCount}）`)
      option.onSuccess?.(result)
    }
    catch (error) {
      const text = error instanceof AdminMediaUploadError ? error.message : humanizeError(error)
      msg.error(text)
      option.onError?.(error instanceof Error ? error : new Error(text))
    }
    finally {
      setUploading(false)
    }
  }

  const removeAsset = (assetId: string) => {
    const next = lines.filter(id => id !== assetId).join('\n')
    onChange?.(next)
    setPreviews(prev => prev.filter(item => item.assetId !== assetId))
  }

  const visiblePreviews = lines.flatMap(assetId => {
    const imageUrl = previews.find(item => item.assetId === assetId)?.imageUrl || media.urls[assetId]
    return imageUrl ? [{ assetId, imageUrl }] : []
  })
  const savedWithoutPreview = lines.filter(id => !visiblePreviews.some(item => item.assetId === id))

  return (
    <div className="asset-uploader">
      {visiblePreviews.length > 0 ? (
        <div className="asset-uploader__grid">
          {visiblePreviews.map(item => (
            <div key={item.assetId} className="asset-uploader__thumb">
              <img src={item.imageUrl} alt="素材预览" />
              <Button size="small" type="link" danger disabled={disabled || uploading} onClick={() => removeAsset(item.assetId)}>移除</Button>
            </div>
          ))}
        </div>
      ) : null}
      {savedWithoutPreview.length > 0 ? (
        <div className="asset-uploader__saved-list">
          {savedWithoutPreview.map((assetId, index) => (
            <Tag key={assetId} closable={!disabled && !uploading} onClose={() => removeAsset(assetId)}>
              已保存图片 {index + 1}
            </Tag>
          ))}
        </div>
      ) : null}
      {canAddMore ? (
        <Upload
          accept=".png,.jpg,.jpeg"
          showUploadList={false}
          customRequest={handleUpload}
          disabled={disabled || uploading}
        >
          <Button icon={<UploadOutlined />} loading={uploading} disabled={disabled}>
            {uploading ? '上传中…' : `添加图片（${lines.length}/${maxCount}）`}
          </Button>
        </Upload>
      ) : (
        <span className="asset-uploader__full">已达上限 {maxCount} 张</span>
      )}
    </div>
  )
}
