/// <reference types="miniprogram-api-typings" />

declare const __APP_NAME__: string
declare const __APP_NAMESPACE__: string
declare const __APP_VERSION__: string
declare const __BUILD_SHA__: string
declare const __CLOUDBASE_ENV_ID__: string
declare const __CLOUDBASE_RESOURCE_APP_ID__: string
declare const __MEMBERSHIP_FUNCTION_NAME__: string
declare const __ADMIN_FUNCTION_NAME__: string
declare const __PAY_FUNCTION_NAME__: string
declare const __PAYMENT_MODE__: string
declare const __SUBSCRIBE_TEMPLATES_JSON__: string
interface SharedWxCloud extends WxCloud {
  init: () => Promise<void>
}

interface WxCloud {
  Cloud: new (options: {
    resourceAppid: string
    resourceEnv: string
  }) => SharedWxCloud
}

declare module 'tdesign-miniprogram/common/shared/qrcode/qrcodegen' {
  export class Ecc {
    static MEDIUM: Ecc
  }

  export class QrSegment {
    static makeSegments(value: string): QrSegment[]
  }

  export class QrCode {
    static encodeSegments(segments: QrSegment[], level: Ecc): QrCode
    getModules(): boolean[][]
  }
}
