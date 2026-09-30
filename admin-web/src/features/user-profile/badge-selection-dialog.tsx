import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, App, Button, Input, Modal, Select, Space, Typography } from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAdminSession } from '../../app/session-provider'
import { loadUserBadgeSelection, userBadgeChanges } from '../../modules/user-badge-selection'
import { humanizeError } from '../../shared/ui/humanize-error'

export function BadgeSelectionDialog({ userId, open, onClose }: { userId: string; open: boolean; onClose: () => void }) {
  const { request, session, sessionBoundary, demoMode } = useAdminSession()
  const { message } = App.useApp()
  const cache = useQueryClient()
  const [selected, setSelected] = useState<string[]>([]), [reason, setReason] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false)
  const lock = useRef(false), keys = useRef(new Map<string, string>()), mounted = useRef(true)
  const identity = `${session?.actor?.id}:${sessionBoundary}:${userId}`
  const currentIdentity = useRef(identity)
  useLayoutEffect(() => { currentIdentity.current = identity }, [identity])
  const query = useQuery({ queryKey: ['admin', 'user-badges', session?.actor?.id, sessionBoundary, userId], enabled: open && Boolean(session?.enabled), queryFn: () => loadUserBadgeSelection(userId, request) })
  const initialized = useRef('')
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!open) { initialized.current = ''; keys.current.clear(); return }
    if (query.data && initialized.current !== identity) {
      keys.current.clear()
      initialized.current = identity
      queueMicrotask(() => { if (mounted.current && currentIdentity.current === identity) { setSelected(query.data.awards.map(award => award.badgeId)); setReason(''); setError('') } })
    }
  }, [open, query.data, identity])
  const save = async () => {
    if (lock.current || !query.data || query.error) return
    if (!reason.trim()) { setError('请填写本次调整原因'); return }
    if (demoMode) { setError('演示模式不会发放或撤销勋章'); return }
    lock.current = true; setSaving(true); setError('')
    const assertCurrentIdentity = () => { if (!mounted.current || currentIdentity.current !== identity) throw new Error('登录身份已变化，请重新打开用户勋章') }
    const readBack = async () => { const result = await query.refetch(); assertCurrentIdentity(); if (!result.isSuccess || !result.data) throw result.error || new Error('勋章结果读取失败'); return result.data }
    const keyFor = (body: object) => { const fingerprint = JSON.stringify(body); if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, `web-user-badges-${crypto.randomUUID()}`); return keys.current.get(fingerprint)! }
    try {
      const changes = userBadgeChanges(query.data, selected)
      for (const badgeId of changes.additions) { assertCurrentIdentity(); const input = { userId, badgeId, reason: reason.trim() }; await request('mip.admin.badges.grant', { ...input, idempotencyKey: keyFor(input) }) }
      for (const award of changes.removals) { assertCurrentIdentity(); const input = { awardId: award.id, expectedVersion: award.version, reason: reason.trim() }; await request('mip.admin.badges.revoke', { ...input, idempotencyKey: keyFor(input) }) }
      await readBack(); await cache.invalidateQueries({ queryKey: ['admin', 'user-profile'] })
      assertCurrentIdentity()
      if (mounted.current) { void message.success('用户勋章已保存并回读'); onClose() }
    } catch (failure) {
      // Refresh committed parts; retry only the remaining difference with stable request keys.
      if (mounted.current && currentIdentity.current === identity) {
        try { await readBack(); setError(`${humanizeError(failure)}；已重新读取获授记录，请核对后保存剩余修改。`) }
        catch (readFailure) { setError(`${humanizeError(failure)}；结果尚未确认：${humanizeError(readFailure)}。请重新读取记录后再保存。`) }
      }
    } finally { lock.current = false; if (mounted.current) setSaving(false) }
  }
  const awarded = new Set(query.data?.awards.map(award => award.badgeId))
  return <Modal open={open} title="管理用户勋章" okText="保存勋章" cancelText="取消" confirmLoading={saving} okButtonProps={{ disabled: query.isPending || Boolean(query.error) }}
    mask={{ closable: !saving }} keyboard={!saving} onCancel={() => { if (!lock.current) onClose() }} onOk={() => void save()}>
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Typography.Paragraph>已获得的勋章默认选中。保存才会授予或撤销，正在佩戴的勋章需先取消佩戴。</Typography.Paragraph>
      <Select aria-label="用户勋章" mode="multiple" style={{ width: '100%' }} value={selected} loading={query.isPending} disabled={saving || !query.data} onChange={setSelected}
        options={query.data?.options.map(option => ({ value: option.id, label: `${option.name}${option.status === 'ACTIVE' ? '' : '（已停用）'}`, disabled: option.status !== 'ACTIVE' && !awarded.has(option.id) || query.data.awards.some(award => award.badgeId === option.id && award.equipped) }))} />
      <Input.TextArea aria-label="勋章调整原因" placeholder="填写调整原因" maxLength={300} value={reason} disabled={saving} onChange={event => setReason(event.target.value)} />
      {query.error || error ? <Alert type="error" showIcon title={error || humanizeError(query.error)} /> : null}
      {query.error ? <Button loading={query.isFetching} disabled={saving} onClick={() => void query.refetch()}>重新读取勋章记录</Button> : null}
    </Space>
  </Modal>
}
