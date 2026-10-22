import { useAdminSession } from '../../app/session-provider'
import { normalizeRichTextToHtml, richTextIsEmpty } from '../../modules/rich-text-html'
import { substituteRichTextCloudImages } from '../../modules/event-detail-preview'
import { useCloudImageTempUrls } from './cloud-image-temp-urls'
import { sanitizeRichTextHtml } from './rich-text-sanitize'
import './rich-text-content.css'

function useOptionalSession() {
  try { return useAdminSession() }
  catch { return null }
}

/** Read-only rich content uses the editor's allowlist; stable cloud refs never become persisted URLs. */
export function RichTextContent({ value }: { value: string }) {
  const session = useOptionalSession()
  const urls = useCloudImageTempUrls(value, session?.client, session?.demoMode ?? false)
  if (richTextIsEmpty(value)) return <p className="rich-text-content__empty">暂无内容</p>
  const html = substituteRichTextCloudImages(
    sanitizeRichTextHtml(normalizeRichTextToHtml(value)),
    id => /^https:\/\/[^\s]+$/.test(urls[id] || '') ? urls[id] : '',
    '图片暂不可预览，请稍后重试',
  )
  return <div className="rich-text-content" dangerouslySetInnerHTML={{ __html: html }} />
}
