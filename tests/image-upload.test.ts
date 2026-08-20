import { describe, expect, it } from 'vitest'
import {
  estimateBase64Bytes,
  IMAGE_UPLOAD_POLICIES,
} from '../src/modules/platform/image-upload'

describe('image upload policy', () => {
  it('estimates padded base64 payload size exactly', () => {
    expect(estimateBase64Bytes('TQ==')).toBe(1)
    expect(estimateBase64Bytes('TWE=')).toBe(2)
    expect(estimateBase64Bytes('TWFu')).toBe(3)
  })

  it('keeps every client policy within the server half-megabyte gate', () => {
    for (const policy of Object.values(IMAGE_UPLOAD_POLICIES)) {
      expect(policy.maximumBytes).toBe(512 * 1024)
      expect(policy.steps.length).toBeGreaterThanOrEqual(3)
      expect(policy.steps.every(step => step.width <= 2048)).toBe(true)
      expect(policy.steps.every(step => step.quality >= 40 && step.quality <= 85)).toBe(true)
    }
  })
})
