import assert from 'node:assert/strict'
import { it } from 'node:test'
import { loadUserBadgeSelection, userBadgeChanges } from './user-badge-selection.ts'
it('loads only the selected user awards and separates selection from committed grants', async () => {
  const calls: unknown[] = []
  const selection = await loadUserBadgeSelection('user-a', async (action, input) => {
    calls.push({ action, input })
    return (action === 'mip.admin.badges.list' ? { items: [{ id: 'old', name: '已获得', status: 'INACTIVE' }, { id: 'new', name: '新勋章', status: 'ACTIVE' }] }
      : { items: [{ id: 'award-a', userId: 'user-a', badgeId: 'old', version: 3, equipped: false }] }) as never
  })
  assert.deepEqual(calls[1], { action: 'mip.admin.badges.awards', input: { userId: 'user-a', status: 'ACTIVE', limit: 100 } })
  assert.deepEqual(userBadgeChanges(selection, ['old', 'new', 'new']), { additions: ['new'], removals: [] })
  assert.deepEqual(userBadgeChanges(selection, []), { additions: [], removals: selection.awards })
  assert.throws(() => userBadgeChanges(selection, ['unknown']), /已停用/)
  assert.throws(() => userBadgeChanges({ ...selection, awards: [{ ...selection.awards[0], equipped: true }] }, []), /正在佩戴/)
})
it('rejects a cross-user award response before displaying or submitting selection', async () => {
  await assert.rejects(() => loadUserBadgeSelection('user-a', async action => (action === 'mip.admin.badges.list' ? { items: [] }
    : { items: [{ id: 'award-b', userId: 'user-b', badgeId: 'badge-a', version: 1 }] }) as never), /不匹配/)
})
