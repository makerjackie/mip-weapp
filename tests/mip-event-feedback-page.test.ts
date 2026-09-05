import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

describe('MIP event feedback page', () => {
  const page = read('src/packages/member/mip-events/feedback/index.ts')
  const view = read('src/packages/member/mip-events/feedback/index.wxml')

  it('uses the dedicated Figma feedback frame and route', () => {
    const app = read('src/app.json')
    const project = read('config/project.json')
    const runtime = read('config/runtime-pages.json')
    const figmaMap = read('docs/mip/FIGMA_MAP.md')
    const detail = read('src/packages/member/mip-events/detail/index.ts')
    const detailView = read('src/packages/member/mip-events/detail/index.wxml')
    const mine = read('src/packages/member/mip-events/mine/index.ts')

    for (const source of [app, project, runtime]) {
      expect(source).toContain('mip-events/feedback/index')
    }
    expect(figmaMap).toMatch(/1818:17374[^\n]+mip-events\/feedback/)
    expect(detail).toContain('openFeedback()')
    expect(detail).toContain('/packages/member/mip-events/feedback/index?eventId=')
    expect(detailView).toContain('bind:tap="openFeedback">\u6D3B\u52A8\u53CD\u9988')
    expect(detail.indexOf('event.registrationStatus === \'ATTENDED\''))
      .toBeLessThan(detail.indexOf('event.status === \'ENDED\''))
    expect(detail).toContain('return { key: \'interact\', label: \'\u4E0E\u4F60\u4E92\u52A8\' }')
    expect(mine).toContain('/packages/member/mip-events/detail/index?eventId=')
    expect(mine).not.toContain('/packages/member/mip-events/interaction/index?eventId=')
  })

  it('keeps feedback separate from the two heart views', () => {
    const interaction = read('src/packages/member/mip-events/interaction/index.ts')
    const interactionView = read('src/packages/member/mip-events/interaction/index.wxml')

    expect(interaction).toContain('type InteractionView = \'SENT\' | \'RECEIVED\'')
    expect(interaction).not.toContain('\'FEEDBACK\'')
    expect(interaction).not.toContain('saveFeedback')
    expect(interactionView).not.toContain('\u6D3B\u52A8\u53CD\u9988')
  })

  it('implements every field from the Figma form without prototype data', () => {
    expect(view).toContain('id="mip-event-feedback-event-summary"')
    expect(view).toContain('\u672C\u573A\u6D3B\u52A8\u4F53\u9A8C\u8BC4\u5206')
    expect(view).toContain('\u5411\u8EAB\u8FB9\u4EBA\u63A8\u8350 MIP \u7684\u610F\u613F')
    expect(view).toContain('\u7B26\u5408\u4F60\u7684\u80FD\u529B\u89D2\u8272')
    expect(view).toContain('maxlength="300"')
    expect(view).toContain('{{bodyLength}}/300')
    expect(view).toContain('\u52A0\u5165 MIP \u7684\u610F\u613F')
    expect(view).toContain('\u6DF1\u5165\u4E86\u89E3 MIP \u7684\u65B9\u5F0F')
    expect(view).toContain('\u82B1\u540D\u518C\u4FE1\u606F\u4F7F\u7528\u65B9\u5F0F')
    expect(view).toContain('id="mip-event-feedback-save"')
    expect(page).toContain('\'connector\',\n  \'strategist\',\n  \'capital_operator\',\n  \'visual_designer\',\n  \'business_builder\',\n  \'delivery_lead\'')
  })

  it('loads only for an authenticated attendee and keeps all recoverable states visible', () => {
    expect(page).toContain('action: \'INTERACT\'')
    expect(page).toContain('consumePendingResume(PAGE_ROUTE)')
    expect(page).toContain('error.code === \'FORBIDDEN\'')
    expect(page).toContain('\u5B8C\u6210\u7B7E\u5230\u540E\u53EF\u586B\u5199\u672C\u573A\u6D3B\u52A8\u53CD\u9988')
    expect(page).not.toMatch(/event\.status\s*===\s*['"]ENDED/)
    expect(view).toContain('id="mip-event-feedback-loading-state"')
    expect(view).toContain('id="mip-event-feedback-access-state"')
    expect(view).toContain('id="mip-event-feedback-blocked-state"')
    expect(view).toContain('id="mip-event-feedback-error-state"')
    expect(view).toContain('id="mip-event-feedback-conflict-state"')
    expect(view).toContain('disabled="{{saving}}"')
    expect(view).not.toContain('disabled="{{saving || !rating || !recommendation')
    expect(view).toContain('id="feedback-field-rating"')
    expect(view).toContain('id="feedback-field-roster-consent"')
    expect(view).toContain('validationErrorMessage')
  })

  it('saves structured answers with optimistic locking and preserves drafts on failure', () => {
    expect(page).toContain('answers: EventFeedbackAnswers')
    expect(page).toContain('expectedVersion: this.data.feedback?.version || 0')
    expect(page).toContain('...(body ? { body } : {})')
    expect(page).toContain('const feedback = await mipEventsModule.getFeedback(this.data.eventId)')
    expect(page).toContain('state: \'conflict\'')
    expect(page).toContain('\u5F53\u524D\u586B\u5199\u5185\u5BB9\u5DF2\u4FDD\u7559')
    expect(page).toContain('const savedAnswers = feedback.answers || answers')
  })
})
