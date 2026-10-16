// MIW-119：支付模式热切换的纯决策层。
// 唯一权威键集来源是 deploy-functions.mjs 的 environmentForRole 与
// deploy-payment-function.mjs 的 commonEnvironment；本文件镜像其中支付相关键
// （MIP_PAYMENT_MODE / MIP_CATALOG_STAGE / MIP_TEST_MEMBERSHIP_HMAC_SECRET）
// 的分发规则与部署门禁，供 scripts/switch-payment-mode.mjs 在不重发函数代码的
// 前提下收敛现网环境。非支付键由调用方原样保留（读-改-写）。

export const PAYMENT_MODES = Object.freeze(['disabled', 'test', 'live'])
export const CATALOG_STAGES = Object.freeze(['TEST', 'LIVE'])
export const TEST_MEMBERSHIP_DEPLOYMENT_STAGES = Object.freeze(['development', 'test', 'staging'])

// role → 支付相关键。镜像 environmentForRole（events/commerce/community/admin/ledger）
// 与 deploy-payment-function.mjs 的 commonEnvironment/refundEnvironment（pay/callback/refund）。
export const PAYMENT_SWITCH_ROLES = Object.freeze({
  events: Object.freeze(['MIP_PAYMENT_MODE']),
  commerce: Object.freeze(['MIP_PAYMENT_MODE', 'MIP_CATALOG_STAGE']),
  community: Object.freeze(['MIP_CATALOG_STAGE']),
  admin: Object.freeze(['MIP_CATALOG_STAGE']),
  ledger: Object.freeze(['MIP_PAYMENT_MODE', 'MIP_CATALOG_STAGE', 'MIP_TEST_MEMBERSHIP_HMAC_SECRET']),
  pay: Object.freeze(['MIP_PAYMENT_MODE']),
  callback: Object.freeze(['MIP_PAYMENT_MODE']),
  refund: Object.freeze(['MIP_PAYMENT_MODE']),
})

// 镜像 environmentForRole 的 ledger 条件：本地部署阶段 + TEST 目录 + 非 live 支付
// 时维护测试会员 HMAC；离开条件时部署不再下发该键，切换同样移除。
export function testMembershipHmacRequired({ deploymentStage, catalogStage, paymentMode }) {
  return TEST_MEMBERSHIP_DEPLOYMENT_STAGES.includes(deploymentStage)
    && catalogStage === 'TEST'
    && ['disabled', 'test'].includes(paymentMode)
}

// 镜像 deploy-functions.mjs 的部署门禁（MIP_TEST_MEMBERSHIP_HMAC_SECRET 的强制校验
// 在 plan 时进行：现网已有稳定密钥时切换不要求本地配置，比部署门禁更宽松且安全）。
export function assertPaymentModeSwitchGates({ paymentMode, catalogStage, confirmLive }) {
  if (!PAYMENT_MODES.includes(paymentMode)) {
    throw new Error('MIP_PAYMENT_MODE must be disabled, test, or live')
  }
  if (!CATALOG_STAGES.includes(catalogStage)) {
    throw new Error('MIP_CATALOG_STAGE must be TEST or LIVE')
  }
  if ((paymentMode === 'live' || catalogStage === 'LIVE') && !confirmLive) {
    throw new Error('Live payment or catalog switch requires --confirm-live')
  }
  if (catalogStage === 'LIVE' && paymentMode !== 'live') {
    throw new Error('LIVE catalog requires MIP_PAYMENT_MODE=live')
  }
}

// 稳定密钥语义与 resolveMipStableSecrets 一致：现网已部署值优先；本地与现网不一致
// 直接报错；切换永不生成密钥（生成是 cloud:deploy 的职责）。
function resolveLedgerTestMembershipHmac({ currentEnvironment, required, localHmac }) {
  const deployed = typeof currentEnvironment.MIP_TEST_MEMBERSHIP_HMAC_SECRET === 'string'
    ? currentEnvironment.MIP_TEST_MEMBERSHIP_HMAC_SECRET
    : ''
  if (!required) {
    return deployed ? { change: { from: '<configured>', to: null } } : { change: null }
  }
  if (deployed) {
    if (localHmac && localHmac !== deployed) {
      throw new Error('MIP_TEST_MEMBERSHIP_HMAC_SECRET differs from the deployed MIP value')
    }
    return { change: null }
  }
  if (localHmac.length < 32 || /[\r\n]/.test(localHmac)) {
    throw new Error('Staging TEST membership maintenance requires a configured MIP_TEST_MEMBERSHIP_HMAC_SECRET with at least 32 single-line characters (switching never generates secrets; run cloud:deploy first)')
  }
  return { value: localHmac, change: { from: null, to: '<configured>' } }
}

// 返回 { environment, changes }：environment 是覆写支付键后的完整 env map，
// changes 仅记录实际变化的键（from/to 用于展示；hmac 一律脱敏为 <configured>）。
export function planPaymentModeEnvironment({
  role,
  currentEnvironment,
  paymentMode,
  catalogStage,
  deploymentStage,
  testMembershipHmac = '',
}) {
  const keys = PAYMENT_SWITCH_ROLES[role]
  if (!keys) {
    throw new Error(`Unsupported payment switch role: ${role}`)
  }
  const environment = { ...currentEnvironment }
  const changes = []
  for (const key of keys) {
    if (key === 'MIP_TEST_MEMBERSHIP_HMAC_SECRET') {
      const resolved = resolveLedgerTestMembershipHmac({
        currentEnvironment,
        required: testMembershipHmacRequired({ deploymentStage, catalogStage, paymentMode }),
        localHmac: testMembershipHmac,
      })
      if (resolved.change) {
        changes.push({ key, ...resolved.change })
      }
      if (resolved.value !== undefined) {
        environment[key] = resolved.value
      }
      else if (resolved.change) {
        delete environment[key]
      }
      continue
    }
    const value = key === 'MIP_PAYMENT_MODE' ? paymentMode : catalogStage
    if (environment[key] !== value) {
      changes.push({ key, from: environment[key] ?? null, to: value })
      environment[key] = value
    }
  }
  return { environment, changes }
}
