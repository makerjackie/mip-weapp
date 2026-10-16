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
import { Button, Tooltip } from 'antd'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import Image from '@tiptap/extension-image'
import TextAlign from '@tiptap/extension-text-align'
import StarterKit from '@tiptap/starter-kit'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useAdminSession } from '../../app/session-provider'
import type { AdminMediaFile } from '../../modules/admin-media-upload'
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

const RestrictedImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(RichTextImageView)
  },
})

function ToolButton({ active, disabled, title, onClick, children }: {
  active?: boolean
  disabled?: boolean
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
 * （存量内容与小程序解析器都在用，属有意增强）。schema 只放白名单节点，输出再经
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
  const fileRef = useRef<HTMLInputElement>(null)
  const onChangeRef = useRef(onChange)
  // 忽略编辑器初始化时的那次 update，避免打开表单就被判「已修改」或把值改写成 HTML。
  const emitReady = useRef(false)
  const valueRef = useRef(value)
  useEffect(() => {
    onChangeRef.current = onChange
    valueRef.current = value
  }, [onChange, value])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [focused, setFocused] = useState(false)
  const [previews, setPreviews] = useState<Record<string, string>>({})

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

  useEffect(() => { emitReady.current = true }, [])

  useEffect(() => {
    editor?.setEditable(!disabled)
  }, [editor, disabled])

  // 外部值（草稿恢复 / 冲突核对）变化时同步进编辑器，避免光标被无谓打断。
  useEffect(() => {
    if (!editor) return
    if (richTextSignature(editor.getHTML()) === richTextSignature(value)) return
    editor.commands.setContent(normalizeRichTextToHtml(value), { emitUpdate: false })
  }, [editor, value])

  // 本会话上传的本地 blob 预览在卸载时回收。
  useEffect(() => () => {
    for (const url of Object.values(previews)) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [previews])

  const handlePickImage = async (file: File) => {
    if (!client) { setUploadError('当前环境无法上传图片'); return }
    if (demoMode) { setUploadError('演示模式不会上传图片'); return }
    setUploading(true)
    setUploadError('')
    try {
      const mediaFile: AdminMediaFile = {
        name: file.name, size: file.size, type: file.type, arrayBuffer: () => file.arrayBuffer(),
      }
      const result = await client.uploadImage(mediaFile, 'EVENT_CONTENT')
      const stableRef = result.cloudFileId
      if (!stableRef) {
        setUploadError('图片上传结果缺少稳定引用，请重试')
        return
      }
      const previewUrl = URL.createObjectURL(file)
      setPreviews(current => ({ ...current, [stableRef]: previewUrl }))
      editor?.chain().focus().setImage({ src: stableRef, alt: '活动图片' }).run()
    }
    catch {
      setUploadError('图片上传失败，请重试')
    }
    finally {
      setUploading(false)
    }
  }

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
        <ToolButton title="插入图片" disabled={disabled || uploading} onClick={() => fileRef.current?.click()}><PictureOutlined /></ToolButton>
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
      <input ref={fileRef} type="file" accept="image/png,image/jpeg" hidden
        onChange={event => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void handlePickImage(file)
        }} />
    </div>
  )
}
