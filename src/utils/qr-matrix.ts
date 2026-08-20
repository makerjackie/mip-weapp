import {
  Ecc,
  QrCode,
  QrSegment,
} from 'tdesign-miniprogram/common/shared/qrcode/qrcodegen'

/**
 * Reuse TDesign's standards-compliant QR encoder while drawing with the page's
 * own Canvas 2D node. This avoids the component-host sizing race that can leave
 * a conditionally mounted `t-qrcode` canvas blank.
 */
export function createQrMatrix(value: string): boolean[][] {
  const segments = QrSegment.makeSegments(value)
  return QrCode.encodeSegments(segments, Ecc.MEDIUM).getModules()
}
