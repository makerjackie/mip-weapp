/// <reference types="miniprogram-api-typings" />

declare const __APP_NAME__: string
declare const __APP_NAMESPACE__: string
declare const __APP_VERSION__: string
declare const __BUILD_SHA__: string
declare const __CLOUDBASE_ENV_ID__: string
declare const __CLOUDBASE_RESOURCE_APP_ID__: string
declare const __MIP_IDENTITY_FUNCTION_NAME__: string
declare const __MIP_MEDIA_FUNCTION_NAME__: string
declare const __MIP_EVENTS_FUNCTION_NAME__: string
declare const __MIP_OPPORTUNITIES_FUNCTION_NAME__: string
declare const __MIP_COMMUNITY_FUNCTION_NAME__: string
declare const __MIP_COMMERCE_FUNCTION_NAME__: string
declare const __MIP_ADMIN_FUNCTION_NAME__: string
declare const __MIP_GROWTH_FUNCTION_NAME__: string
declare const __MIP_AI_FUNCTION_NAME__: string
declare const __MIP_NOTIFICATIONS_FUNCTION_NAME__: string
declare const __MIP_PAY_FUNCTION_NAME__: string
declare const __MIP_PAYMENT_MODE__: string
declare const __MIP_CATALOG_STAGE__: string
declare const __MIP_SUBSCRIBE_TEMPLATES_JSON__: string
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
