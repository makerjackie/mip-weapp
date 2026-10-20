import { getCloudMediaGeneration, resolveCloudFileUrls } from '../../platform/storage/cloud-media'
import { eventRichTextNodes, extractRichTextCloudImageIds } from './rich-content'

interface RichContentTarget {
  setData: (patch: Record<string, unknown>) => void
}

const bindings = new WeakMap<RichContentTarget, Map<string, object>>()

/** The same safe HTML/Markdown rendering for activity and checkout surfaces. */
export function updateEventRichContent(target: RichContentTarget, field: string, content: string) {
  let fields = bindings.get(target)
  if (!fields) {
    fields = new Map()
    bindings.set(target, fields)
  }
  const token = {}
  fields.set(field, token)
  target.setData({ [field]: eventRichTextNodes(content) })
  const fileIds = extractRichTextCloudImageIds(content)
  if (!fileIds.length) {
    return
  }
  const generation = getCloudMediaGeneration()
  void resolveCloudFileUrls(fileIds, undefined, true).then((resolved) => {
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

export function clearEventRichContent(target: RichContentTarget) {
  bindings.delete(target)
}
