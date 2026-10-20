import { getCloudMediaGeneration, resolveEventRichTextImageUrls } from '../../platform/storage/cloud-media'
import { eventRichTextNodes, extractRichTextCloudImageIds } from './rich-content'

interface RichContentTarget {
  setData: (patch: Record<string, unknown>) => void
}

const bindings = new WeakMap<RichContentTarget, Map<string, { content: string }>>()

/** The same safe HTML/Markdown rendering for activity and checkout surfaces. */
export function updateEventRichContent(target: RichContentTarget, field: string, content: string) {
  let fields = bindings.get(target)
  if (!fields) {
    fields = new Map()
    bindings.set(target, fields)
  }
  const token = { content }
  fields.set(field, token)
  target.setData({ [field]: eventRichTextNodes(content) })
  const fileIds = extractRichTextCloudImageIds(content)
  if (!fileIds.length) {
    return
  }
  const generation = getCloudMediaGeneration()
  void resolveEventRichTextImageUrls(fileIds).then((resolved) => {
    if (generation !== getCloudMediaGeneration() || bindings.get(target)?.get(field) !== token) {
      return
    }
    let hydrated = content
    fileIds.forEach((fileId, index) => {
      if (resolved[index]) {
        hydrated = hydrated.replaceAll(fileId, resolved[index])
      }
    })
    target.setData({ [field]: eventRichTextNodes(hydrated) })
  }).catch(() => {
    // Preserve readable text if optional images cannot be loaded.
  })
}

/** A recreated tab needs fresh URLs after the signing TTL, not its old nodes. */
export function refreshEventRichContent(target: RichContentTarget, field: string) {
  const binding = bindings.get(target)?.get(field)
  if (binding) {
    updateEventRichContent(target, field, binding.content)
  }
}

export function clearEventRichContent(target: RichContentTarget) {
  bindings.delete(target)
}
