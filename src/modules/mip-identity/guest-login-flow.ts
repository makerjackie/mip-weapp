import type {
  AccessSession,
  IdentityAccessSnapshot,
  PendingAccessResume,
  ProtectedActionIntent,
} from './contracts'
import type { MipIdentityModule } from './module'
import { caseNavigateTo } from '../../platform/navigation/client'
import { mipAccessPageUrl } from './access-flow'

/**
 * 通用游客登录引导流程（自 journey-review J0/J1 终审口径提取）。
 *
 * 微信小程序没有注册/登录概念：打开即有 OpenID，服务端据此决定账号状态。
 * 游客触发受保护操作（报名、分享、互动、进入受限页等）时按序补齐：
 * 1. 未登录或未绑手机号 → 本页弹出 `mip-login-sheet`（唯一弹窗授权项；MIW-20 起单主按钮）；
 * 2. 已绑手机号的退出账号 → 主按钮先按 OpenID 恢复会话直接完成登录，不重复授权手机号；
 *    服务端确认未绑时，主按钮切回「微信手机号授权」形态再弹原生授权；
 * 3. 新账号授权手机号后 → 跳「填写信息」（mip-profile）补昵称/头像，完成或关闭都回原页；
 * 4. 其余未完成项（协议等）→ 交给 mip-access 页自完成；
 * 5. 全部就绪 → 在原页就地继续受保护操作，不丢失上下文。
 *
 * 本控制器只负责身份决策与恢复；页面通过 `proceed` 定义原意图的就地执行，
 * 通过 WXML 里的 `mip-login-sheet` 呈现弹层（数据键 loginSheetOpen/Busy/RestoreFirst）。
 */

export interface MipGuestLoginSheetState {
  loginSheetOpen?: boolean
  loginSheetBusy?: boolean
  loginSheetRestoreFirst?: boolean
}

export interface MipGuestLoginProceedContext {
  /** 就绪时最新的身份快照，页面可用它同步登录态展示；极端冷启动下可能缺省。 */
  snapshot?: IdentityAccessSnapshot
  /** 经 mip-access 页完成、以 pendingResume 回到本页时携带；其余就绪路径为 null。 */
  resume: PendingAccessResume | null
}

export interface MipGuestLoginFlowHost {
  /** 页面路由（无前导斜杠），用于匹配返回本页的 pendingResume。 */
  route: string
  /** 待续身份意图 token 槽位；保留在页面上，跳转「填写信息」期间不丢失。 */
  getAuthToken: () => string
  setAuthToken: (token: string) => void
  /** 弹层是否仍活跃（loginSheetOpen 或 loginSheetBusy）：活跃时 onShow 恢复必须让位。 */
  isSheetActive: () => boolean
  /** 把弹层状态同步进页面 data。 */
  setSheetState: (state: MipGuestLoginSheetState) => void
  /** 身份就绪：在原页就地继续受保护操作。 */
  proceed: (context: MipGuestLoginProceedContext) => void | Promise<void>
  /** 可恢复提示（取消授权、绑定/登录失败）。缺省用 wx.showToast。 */
  notice?: (message: string) => void
  /** 恢复时身份无法确认的提示。缺省静默放弃。 */
  noticeUnavailable?: (message: string) => void
  /** 恢复放弃挂起意图后的页面收尾（如刷新我的页）。 */
  onAbandon?: () => void | Promise<void>
}

export type MipGuestLoginOutcome = 'ready' | 'sheet' | 'access' | 'unavailable'

export type MipGuestLoginBeginResult
  = | { outcome: 'ready', session: AccessSession }
    | { outcome: 'sheet' | 'access' | 'unavailable', session?: undefined }

export type MipGuestLoginResumeResult = 'resumed' | 'idle'

export interface MipGuestLoginFlowOptions {
  /** 恢复 pendingResume 前先刷新服务端身份快照（机会列表 B1 口径）。缺省不刷新。 */
  refreshBeforeResume?: boolean
}

/** 控制器只消费身份模块的这组能力；由页面注入（通常传 `mipIdentityModule`）。 */
type MipGuestLoginIdentity = Pick<
  MipIdentityModule,
  | 'beginProtectedAction'
  | 'bindWechatPhone'
  | 'signIn'
  | 'loadAccess'
  | 'loadSnapshot'
  | 'peekSnapshot'
  | 'complete'
  | 'cancel'
  | 'consumePendingResume'
  | 'isSignedOut'
>

const PHONE_CANCELLED_MESSAGE = '你已取消手机号授权，可以稍后再完成。'
const PHONE_NATIVE_ONLY_MESSAGE = '手机号授权必须在微信真机完成。'
const PHONE_BIND_FAILED_MESSAGE = '手机号绑定失败，请重试。'
const SIGN_IN_FAILED_MESSAGE = '登录失败，请稍后重试。'

export function createMipGuestLoginFlow(
  host: MipGuestLoginFlowHost,
  identity: MipGuestLoginIdentity,
  options: MipGuestLoginFlowOptions = {},
) {
  let busy = false

  function notice(message: string) {
    if (host.notice) {
      host.notice(message)
      return
    }
    wx.showToast({ title: message, icon: 'none' })
  }

  function clearIntent() {
    if (host.getAuthToken()) {
      identity.cancel(host.getAuthToken())
      host.setAuthToken('')
    }
    host.setSheetState({ loginSheetOpen: false, loginSheetBusy: false })
  }

  function isPhoneSessionIncomplete(snapshot: IdentityAccessSnapshot): boolean {
    return !snapshot.authenticated || !snapshot.phoneBound
  }

  async function proceedAfterMutation(session: AccessSession): Promise<MipGuestLoginOutcome> {
    host.setSheetState({ loginSheetOpen: false, loginSheetBusy: false })
    if (session.decision.ready) {
      const token = session.token
      host.setAuthToken('')
      try {
        await identity.complete(token)
      }
      catch (error) {
        notice(error instanceof Error && error.message ? error.message : SIGN_IN_FAILED_MESSAGE)
        return 'unavailable'
      }
      identity.consumePendingResume(host.route)
      await host.proceed({ snapshot: session.snapshot, resume: null })
      return 'ready'
    }
    if (session.decision.nextRequirement === 'PROFILE') {
      // journey-review J1-03：新账号完善资料；token 保留，完成或关闭回本页后继续原意图。
      caseNavigateTo({
        url: `/packages/member/mip-profile/index?token=${encodeURIComponent(session.token)}`,
      })
      return 'sheet'
    }
    // 协议等剩余项交给 access 页自完成，并经 pendingResume 回本页恢复意图。
    host.setAuthToken('')
    caseNavigateTo({ url: mipAccessPageUrl(session.token) })
    return 'access'
  }

  return {
    /** 游客触发受保护操作：就绪返回 ready 由调用方就地执行；否则弹层或转交对应页面。 */
    async begin(intent: ProtectedActionIntent): Promise<MipGuestLoginBeginResult> {
      if (host.getAuthToken()) {
        host.setSheetState({ loginSheetOpen: true, loginSheetBusy: false })
        return { outcome: 'sheet' }
      }
      try {
        const session = await identity.beginProtectedAction(intent)
        if (session.decision.ready) {
          return { outcome: 'ready', session }
        }
        if (session.decision.block !== 'FORBIDDEN'
          && isPhoneSessionIncomplete(session.snapshot)) {
          host.setAuthToken(session.token)
          host.setSheetState({
            loginSheetOpen: true,
            loginSheetBusy: false,
            // MIW-20 单按钮：退出过的老账号先恢复会话（已绑手机号免原生授权）；
            // 新游客直接进手机号授权形态。原生授权窗只能由真实点击调起，无法合并为一次点击。
            loginSheetRestoreFirst: identity.isSignedOut(),
          })
          return { outcome: 'sheet' }
        }
        caseNavigateTo({ url: mipAccessPageUrl(session.token) })
        return { outcome: 'access' }
      }
      catch {
        return { outcome: 'unavailable' }
      }
    },

    /** `mip-login-sheet` 的 getphonenumber 回调。 */
    async phone(event: { detail?: { code?: string, errMsg?: string } }): Promise<MipGuestLoginOutcome | null> {
      const token = host.getAuthToken()
      if (!token || busy) {
        return null
      }
      const code = String(event.detail?.code || '')
      if (!code) {
        const cancelled = /cancel|deny|denied/i.test(String(event.detail?.errMsg || ''))
        notice(cancelled ? PHONE_CANCELLED_MESSAGE : PHONE_NATIVE_ONLY_MESSAGE)
        return null
      }
      busy = true
      host.setSheetState({ loginSheetBusy: true })
      try {
        const session = await identity.bindWechatPhone(token, code)
        busy = false
        return await proceedAfterMutation(session)
      }
      catch (error) {
        notice(error instanceof Error && error.message ? error.message : PHONE_BIND_FAILED_MESSAGE)
        return null
      }
      finally {
        busy = false
        host.setSheetState({ loginSheetBusy: false })
      }
    },

    /** `mip-login-sheet` 的「使用当前微信账号重新登录」：已绑手机号的账号不重复授权。 */
    async signIn(): Promise<MipGuestLoginOutcome | null> {
      const token = host.getAuthToken()
      if (!token || busy) {
        return null
      }
      busy = true
      host.setSheetState({ loginSheetBusy: true })
      try {
        const session = await identity.signIn(token)
        if (session.snapshot.authenticated && !session.snapshot.phoneBound) {
          // 明确登录的账号还没手机号：主按钮切回手机号授权形态，下一步弹原生授权。
          host.setSheetState({ loginSheetRestoreFirst: false })
          return null
        }
        busy = false
        return await proceedAfterMutation(session)
      }
      catch (error) {
        notice(error instanceof Error && error.message ? error.message : SIGN_IN_FAILED_MESSAGE)
        return null
      }
      finally {
        busy = false
        host.setSheetState({ loginSheetBusy: false })
      }
    },

    /** 「暂不授权，返回原页面」：取消挂起意图并收起弹层。 */
    dismiss() {
      if (busy) {
        return
      }
      clearIntent()
    },

    /**
     * onShow 恢复：access 页经 pendingResume 回来，或从「填写信息」返回后完成原意图。
     * 弹层仍然活跃时不动挂起意图，等弹层先走完。
     */
    async resume(): Promise<MipGuestLoginResumeResult> {
      if (host.isSheetActive() || busy) {
        return 'idle'
      }
      const pending = identity.consumePendingResume(host.route)
      if (pending) {
        let snapshot = identity.peekSnapshot()
        if (options.refreshBeforeResume) {
          // 机会列表 B1 口径：恢复原意图前等登录态刷新完成，避免用过期快照跑完恢复。
          // 快照刷新失败不阻断恢复；后续业务请求仍会做服务端身份校验。
          snapshot = await identity.loadSnapshot().catch(() => undefined)
        }
        if (host.getAuthToken()) {
          identity.cancel(host.getAuthToken())
          host.setAuthToken('')
        }
        await host.proceed({ snapshot, resume: pending })
        return 'resumed'
      }
      if (!host.getAuthToken()) {
        return 'idle'
      }
      try {
        const session = await identity.loadAccess(host.getAuthToken())
        if (session.decision.ready) {
          const token = host.getAuthToken()
          host.setAuthToken('')
          await identity.complete(token)
          identity.consumePendingResume(host.route)
          await host.proceed({ snapshot: session.snapshot, resume: null })
          return 'resumed'
        }
      }
      catch {
        host.noticeUnavailable?.(SIGN_IN_FAILED_MESSAGE)
      }
      clearIntent()
      await host.onAbandon?.()
      return 'idle'
    },
  }
}

export type MipGuestLoginFlow = ReturnType<typeof createMipGuestLoginFlow>
