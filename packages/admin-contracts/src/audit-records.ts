/**
 * 审计事件类型词表（MIW-131 登录记录）。
 *
 * 服务端 `mip.admin.audit.list` 当前只产出操作审计事件（OPERATION），也没有
 * `type` 筛选；登录审计事件（LOGIN，含 IP、设备与失败原因）的服务端事实待联调。
 * 先在契约层固定词表与登录记录字段，供 BFF 过滤映射与 Web 登录记录列装配共用。
 */
export const ADMIN_AUDIT_EVENT_TYPES = ['OPERATION', 'LOGIN'] as const

export type AdminAuditEventType = (typeof ADMIN_AUDIT_EVENT_TYPES)[number]

/** type=LOGIN 的审计事件在「登录记录」列表展示所需的最小字段。 */
export interface AdminLoginAuditRecord {
  loginAccount: string
  createdAt: string
  result: 'SUCCESS' | 'FAILURE'
  ip: string
  device: string
  failureReason?: string
}
