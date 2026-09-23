import { getCloudMediaGeneration, peekCloudFileUrls, resolveCloudFileUrls } from './cloud-media'

interface MediaTarget {
  setData: (patch: Record<string, unknown>) => void
}

const bindings = new WeakMap<MediaTarget, Map<string, object>>()

/** Images hydrate independently of the card's business data and lifecycle. */
export function updateComponentMedia(target: MediaTarget, field: string, value: unknown) {
  let fields = bindings.get(target)
  if (!fields) {
    fields = new Map()
    bindings.set(target, fields)
  }
  const token = {}
  const generation = getCloudMediaGeneration()
  fields.set(field, token)
  target.setData({ [field]: peekCloudFileUrls(value) })
  void resolveCloudFileUrls(value, undefined, true).then((resolved) => {
    if (generation === getCloudMediaGeneration() && bindings.get(target)?.get(field) === token) {
      target.setData({ [field]: resolved })
    }
  }).catch(() => {
    // Keep the existing placeholder when the cloud client is unavailable.
  })
}

export function clearComponentMedia(target: MediaTarget) {
  bindings.delete(target)
}

/** Pages use the same guarded hydration without binding CloudBase file IDs into Page.data. */
export const updatePageMedia = updateComponentMedia
export const clearPageMedia = clearComponentMedia
