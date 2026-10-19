import {
  AlignCenterOutlined,
  AlignLeftOutlined,
  BoldOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  PictureOutlined,
  RedoOutlined,
  UnderlineOutlined,
  UndoOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { App, Button, Tooltip } from 'antd'
import type { Editor } from '@tiptap/core'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import TiptapImage from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import StarterKit from '@tiptap/starter-kit'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminMediaFile } from '../../modules/admin-media-upload'
import { useMediaPreview } from './media-preview-context'
import {
  normalizeRichTextToHtml,
  richTextIsEmpty,
  richTextSignature,
  richTextToPlainText,
} from '../../modules/rich-text-html'
import { sanitizeRichTextHtml } from './rich-text-sanitize'

/**
 * Safely access the admin session. Returns null outside a SessionProvider
 * (unit tests render the field without a full provider tree).
 */
function useOptionalSession() {
  try {
    return useAdminSession()
  }
  catch {
    return null
  }
}

/** 从剪贴板/拖拽的数据里挑出图片文件。 */
function imageFilesFromTransfer(transfer: DataTransfer | null): File[] {
  if (!transfer) return []
  if (transfer.files && transfer.files.length) {
    return Array.from(transfer.files).filter(file => file.type.startsWith('image/'))
  }
  const files: File[] = []
  for (const item of Array.from(transfer.items || [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  return files
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片无法读取')) }
    image.src = url
  })
}

const MAX_UPLOAD_EDGE = 1600
const DIRECT_UPLOAD_BYTES = 700 * 1024

/**
 * 大图先在前端等比缩到 1600px 内并转 JPEG（质量 0.85），把 1MB 原图压到几百 KB，
 * 避免经 BFF base64 传输时的 7–8 秒等待；小图原样上传。
 */
async function toUploadFile(file: File): Promise<{ media: AdminMediaFile; previewUrl: string }> {
  if (!file.type.startsWith('image/')) throw new Error('仅支持图片文件')
  const original = URL.createObjectURL(file)
  try {
    if (file.size <= DIRECT_UPLOAD_BYTES && (file.type === 'image/jpeg' || file.type === 'image/png')) {
      const image = await loadImageFile(file)
      if (image.width <= MAX_UPLOAD_EDGE && image.height <= MAX_UPLOAD_EDGE) {
        return { media: file, previewUrl: original }
      }
    }
    const image = await loadImageFile(file)
    const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('图片处理失败')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(result => resolve(result), 'image/jpeg', 0.85))
    if (!blob) throw new Error('图片处理失败')
    URL.revokeObjectURL(original)
    return {
      media: { name: `${file.name.replace(/\.[^.]+$/, '')}.jpg`, size: blob.size, type: 'image/jpeg', arrayBuffer: () => blob.arrayBuffer() },
      previewUrl: URL.createObjectURL(blob),
    }
  }
  catch (error) {
    URL.revokeObjectURL(original)
    throw error
  }
}

/** cloud:// fileID → 本会话上传时拿到的本地 blob 预览；节点视图用它把稳定引用渲染成图。 */
const RichTextImageResolver = createContext<Record<string, string>>({})

function RichTextImageView({ node }: NodeViewProps) {
  const resolved = useContext(RichTextImageResolver)
  const src = String(node.attrs.src || '')
  const preview = src.startsWith('cloud://') ? resolved[src] : src
  if (!preview) {
    return <NodeViewWrapper as="span" className="rich-text-editor__image-placeholder">图片（保存后在活动页显示）</NodeViewWrapper>
  }
  return <NodeViewWrapper as="span" className="rich-text-editor__image-wrap">
    <img src={preview} alt={String(node.attrs.alt || '')} className="rich-text-editor__image" />
  </NodeViewWrapper>
}

const RestrictedImage = TiptapImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RichTextImageView)
  },
})

function ToolButton({ active, disabled, loading, title, onClick, children }: {
  active?: boolean
  disabled?: boolean
  loading?: boolean
  title: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip title={title}>
      <Button
        size="small"
        type={active ? 'primary' : 'text'}
        disabled={disabled}
        loading={loading}
        aria-label={title}
        aria-pressed={active || undefined}
        // Keep the editor selection: clicking a toolbar button must not blur the contenteditable.
        onMouseDown={event => event.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tooltip>
  )
}

/**
 * 可见即所得的受限富文本编辑器（TipTap）。
 *
 * 工具栏与原型一致：加粗 / 斜体 / 下划线 / 列表 / 左对齐 / 居中 / 插图，另保留大、小标题
 * （存量内容与小程序解析器都在用，属有意增强）。插图支持三种入口：工具栏选择、剪贴板粘贴、
 * 拖拽文件；上传时立即给出反馈，大图前端先压缩再传。schema 只放白名单节点，输出再经
 * sanitizeRichTextHtml 净化后回写表单；插图走活动素材通道并持久化 cloud:// 稳定引用。
 */
export function RichTextArea({
  id,
  value = '',
  onChange,
  placeholder,
  maxLength,
  disabled,
  rows = 8,
}: {
  id?: string
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  maxLength?: number
  disabled?: boolean
  rows?: number
}) {
  const session = useOptionalSession()
  const client = session?.client
  const demoMode = session?.demoMode ?? false
  const { message } = App.useApp()
  // 上传成功的「稳定引用 → 本地预览」同时登记进表单级媒体映射，手机预览弹层据此刻换
  // 富文本里的 cloud:// 引用；不在 Provider 树内时 remember 是空实现，行为不变。
  const { remember } = useMediaPreview()
  const fileRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  // 忽略编辑器初始化时的那次 update，避免打开表单就被判「已修改」或把值改写成 HTML。
  const emitReady = useRef(false)
  const valueRef = useRef(value)
  const editorRef = useRef<Editor | null>(null)
  const uploadRef = useRef<(files: File[]) => void>(() => {})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [focused, setFocused] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})

  const uploadImages = (files: File[]) => {
    if (!files.length) return
    if (!client) { setUploadError('当前环境无法上传图片'); return }
    if (demoMode) { setUploadError('演示模式不会上传图片'); return }
    const feedbackKey = 'rich-text-image-upload'
    setUploading(true)
    setUploadError('')
    void message.loading({ content: files.length > 1 ? `正在上传 ${files.length} 张图片…` : '正在上传图片…', key: feedbackKey, duration: 0 })
    void (async () => {
      try {
        for (const file of files) {
          const prepared = await toUploadFile(file)
          const result = await client.uploadImage(prepared.media, 'EVENT_CONTENT')
          const stableRef = result.cloudFileId
          if (!stableRef) throw new Error('图片上传结果缺少稳定引用，请重试')
          setPreviews(current => ({ ...current, [stableRef]: prepared.previewUrl }))
          remember(stableRef, prepared.previewUrl)
          editorRef.current?.chain().focus().setImage({ src: stableRef, alt: '活动图片' }).run()
        }
        void message.success({ content: '图片已插入', key: feedbackKey, duration: 1.6 })
      }
      catch (reason) {
        void message.error({ content: reason instanceof Error ? reason.message : '图片上传失败，请重试', key: feedbackKey, duration: 2.6 })
      }
      finally {
        setUploading(false)
      }
    })()
  }

  const editor = useEditor({
    editable: !disabled,
    shouldRerenderOnTransaction: true,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: false,
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      RestrictedImage.configure({ inline: false, allowBase64: false }),
    ],
    content: normalizeRichTextToHtml(value),
    editorProps: {
      attributes: {
        ...(id ? { id } : {}),
        class: 'rich-text-editor__content',
        ...(placeholder ? { 'data-placeholder': placeholder } : {}),
        ...(maxLength ? { 'aria-label': placeholder || '富文本内容' } : {}),
      },
      handlePaste: (_view, event) => {
        const files = imageFilesFromTransfer(event.clipboardData)
        if (!files.length) return false
        event.preventDefault()
        uploadRef.current(files)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = imageFilesFromTransfer(event.dataTransfer)
        if (!files.length) return false
        event.preventDefault()
        uploadRef.current(files)
        return true
      },
    },
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    onUpdate: ({ editor }) => {
      const html = sanitizeRichTextHtml(editor.getHTML())
      // 与外部值等价（含存量 markdown 归一化）时不冒泡，避免把打开表单当成一次修改。
      if (!emitReady.current || richTextSignature(html) === richTextSignature(valueRef.current)) return
      onChangeRef.current?.(richTextIsEmpty(html) ? '' : html)
    },
  }, [])

  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
  }, [onChange, value])

  useEffect(() => { emitReady.current = true }, [])

  useEffect(() => {
    editorRef.current = editor
    uploadRef.current = uploadImages
  })

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  // 外部值（草稿恢复 / 冲突核对）变化时同步进编辑器，避免光标被无谓打断。
  useEffect(() => {
    if (!editor) return
    if (richTextSignature(editor.getHTML()) === richTextSignature(value)) return
    editor.commands.setContent(normalizeRichTextToHtml(value), { emitUpdate: false })
  }, [editor, value])

  // 本会话上传的本地 blob 预览只在编辑器最终卸载时回收；不能以 previews 为清理依赖，
  // 否则每传一张图就会把上一张的 blob 提前吊销（编辑器与预览弹层一起裂图）。
  const previewsRef = useRef(previews)
  useEffect(() => { previewsRef.current = previews }, [previews])
  useEffect(() => () => {
    for (const url of Object.values(previewsRef.current)) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [])

  const plainText = richTextToPlainText(value)
  const overLimit = Boolean(maxLength && plainText.length > maxLength)

  return (
    <div className="rich-text-area" data-disabled={disabled || undefined}>
      <div className="rich-text-area__toolbar" role="toolbar" aria-label="富文本工具栏">
        <ToolButton title="大标题" disabled={disabled} active={editor?.isActive('heading', { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>H1</ToolButton>
        <ToolButton title="小标题" disabled={disabled} active={editor?.isActive('heading', { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolButton>
        <span className="rich-text-area__divider" aria-hidden />
        <ToolButton title="加粗" disabled={disabled} active={editor?.isActive('bold')} onClick={() => editor?.chain().focus().toggleBold().run()}><BoldOutlined /></ToolButton>
        <ToolButton title="斜体" disabled={disabled} active={editor?.isActive('italic')} onClick={() => editor?.chain().focus().toggleItalic().run()}><ItalicOutlined /></ToolButton>
        <ToolButton title="下划线" disabled={disabled} active={editor?.isActive('underline')} onClick={() => editor?.chain().focus().toggleUnderline().run()}><UnderlineOutlined /></ToolButton>
        <ToolButton title="项目符号列表" disabled={disabled} active={editor?.isActive('bulletList')} onClick={() => editor?.chain().focus().toggleBulletList().run()}><UnorderedListOutlined /></ToolButton>
        <ToolButton title="编号列表" disabled={disabled} active={editor?.isActive('orderedList')} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><OrderedListOutlined /></ToolButton>
        <span className="rich-text-area__divider" aria-hidden />
        <ToolButton title="左对齐" disabled={disabled} active={editor?.isActive({ textAlign: 'left' })} onClick={() => editor?.chain().focus().setTextAlign('left').run()}><AlignLeftOutlined /></ToolButton>
        <ToolButton title="居中" disabled={disabled} active={editor?.isActive({ textAlign: 'center' })} onClick={() => editor?.chain().focus().setTextAlign('center').run()}><AlignCenterOutlined /></ToolButton>
        <ToolButton title="插入图片（也可直接粘贴或拖入图片）" disabled={disabled || uploading} loading={uploading} onClick={() => fileRef.current?.click()}><PictureOutlined /></ToolButton>
        <span className="rich-text-area__divider" aria-hidden />
        <ToolButton title="撤销" disabled={disabled || !editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}><UndoOutlined /></ToolButton>
        <ToolButton title="重做" disabled={disabled || !editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}><RedoOutlined /></ToolButton>
        <span className={`rich-text-area__count${overLimit ? ' is-over' : ''}`}>{plainText.length}{maxLength ? ` / ${maxLength}` : ''}</span>
      </div>
      {uploadError ? <div className="rich-text-area__error" role="alert">{uploadError}</div> : null}
      <RichTextImageResolver.Provider value={previews}>
        <div className="rich-text-editor" style={{ minHeight: `${rows * 24}px` }}>
          {!focused && richTextIsEmpty(value) && placeholder ? <span className="rich-text-editor__placeholder">{placeholder}</span> : null}
          <EditorContent editor={editor} />
        </div>
      </RichTextImageResolver.Provider>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" multiple hidden
        onChange={event => {
          const files = Array.from(event.target.files || [])
          event.target.value = ''
          uploadImages(files)
        }} />
    </div>
  )
}
