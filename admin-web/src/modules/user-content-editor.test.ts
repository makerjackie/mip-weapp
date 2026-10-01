import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { it } from 'node:test'
import { userContentEditorFields, userContentEditorValues } from './user-content-editor.ts'
import { getContentMutationForm, validateContentMutation } from './content-mutation-forms.ts'
import { contentFormValues } from './content-form-values.ts'
const require = createRequire(import.meta.url)
const { createAdminUserContentRepository } = require('../../../cloudfunctions/mip-admin-api/domain/repositories/user-content.js')
it('round trips a nonempty repository card response preserving zero scores and immutable ownership', async () => {
  const repository = createAdminUserContentRepository({
    one: async () => ({ id: 'card-1', owner_user_id: 'owner-1', owner_nickname: '测试用户', status: 'PUBLISHED', version: 4,
      role_key: 'connector', positioning: '定位', target_summary: '目标', role_fields_json: JSON.stringify({ circles: '圈层', resources: '资源', target: '目标' }),
      ability_scores_json: JSON.stringify({ business_development: 0, resource_integration: 1, capital_operation: 2, strategy_planning: 3, visual_design: 4, delivery_management: 5 }) }),
    query: async () => [],
  }, { assertMutationScope() {}, lockMutationAuthorization() {}, writeAudit() {} })
  const dto = await repository.getUserContent('test', { platform: true }, 'COOPERATION_CARD', 'card-1')
  const values = userContentEditorValues(dto)
  const result = validateContentMutation('mip.admin.userContent.save', contentFormValues('mip.admin.userContent.save', values, 'test'))
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.input.expectedVersion, 4)
  assert.equal(result.input.ownerUserId, 'owner-1')
  const draft = result.input.draft as { kind: string; abilityScores: Record<string, number> }
  assert.equal(draft.kind, 'COOPERATION_CARD')
  assert.equal(draft.abilityScores.business_development, 0)
  const fields = userContentEditorFields(getContentMutationForm('mip.admin.userContent.save').fields, true)
  assert.equal(fields.find(f => f.key === 'ownerUserId')?.readOnly, true)
  assert.equal(fields.find(f => f.key === 'kind')?.readOnly, true)
  assert.equal(fields.find(f => f.key === 'expectedVersion')?.hidden, true)
  assert.equal(userContentEditorValues({ ...dto, status: 'ARCHIVED' })._canSave, false)
  assert.throws(() => userContentEditorValues({ ...dto, version: undefined }), /详情字段不完整/)
})
