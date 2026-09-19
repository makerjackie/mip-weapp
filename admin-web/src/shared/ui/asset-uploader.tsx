import { UploadOutlined } from '@ant-design/icons'
import { Button, Input, Upload, message as staticMessage } from 'antd'
import { useState } from 'react'
import { useAdminSession } from '../../app/session-provider'
import { AdminMediaUploadError, type AdminMediaFile, type AdminMediaPurpose } from '../../modules/admin-media-upload'
import { humanizeError } from './humanize-error'

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

const VALID_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
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
  const [previewUrl, setPreviewUrl] = useState('')

  const handleUpload = async (option: CustomRequestOption) => {
    const file = asFile(option.file)
    if (!file) return
    if (!client) {
      msg.error('当前环境无法上传图片')
      option.onError?.(new Error('无上传通道'))
      return
    }
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      msg.error('仅支持 PNG、JPEG 或 WebP 格式的图片')
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
      onChange?.(result.assetId)
      setPreviewUrl(result.imageUrl)
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

  return (
    <div className="asset-uploader">
      <Input
        value={value}
        placeholder={placeholder}
        readOnly
        disabled={disabled || uploading}
        addonAfter={
          <Upload
            accept=".png,.jpg,.jpeg,.webp"
            showUploadList={false}
            customRequest={handleUpload}
            disabled={disabled || uploading}
          >
            <Button icon={<UploadOutlined />} size="small" type="text" loading={uploading} disabled={disabled}>
              {uploading ? '上传中' : '上传'}
            </Button>
          </Upload>
        }
      />
      {previewUrl ? (
        <div className="asset-uploader__preview">
          <img src={previewUrl} alt="预览" style={{ maxWidth: 200, maxHeight: 120, borderRadius: 8 }} />
          <Button size="small" type="link" danger onClick={() => { onChange?.(''); setPreviewUrl('') }}>移除</Button>
        </div>
      ) : null}
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
      msg.error('仅支持 PNG、JPEG 或 WebP 格式的图片')
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
      const next = [...lines, result.assetId].join('\n')
      onChange?.(next)
      setPreviews(prev => [...prev, { assetId: result.assetId, imageUrl: result.imageUrl }])
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

  return (
    <div className="asset-uploader">
      {previews.length > 0 ? (
        <div className="asset-uploader__grid">
          {previews.map(item => (
            <div key={item.assetId} className="asset-uploader__thumb">
              <img src={item.imageUrl} alt="素材预览" />
              <Button size="small" type="link" danger onClick={() => removeAsset(item.assetId)}>移除</Button>
            </div>
          ))}
        </div>
      ) : null}
      {canAddMore ? (
        <Upload
          accept=".png,.jpg,.jpeg,.webp"
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
