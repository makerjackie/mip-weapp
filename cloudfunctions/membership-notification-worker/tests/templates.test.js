'use strict'

const assert = require('node:assert/strict')
const { describe, it } = require('node:test')
const {
  parseTemplateConfig,
  renderTemplateData,
} = require('../domain/templates')

describe('subscription message templates', () => {
  it('accepts a configured logical template and maps safe keyword values', () => {
    const templates = parseTemplateConfig(JSON.stringify({
      event_reminder: {
        templateId: 'template-1',
        fields: {
          title: 'thing1',
          time: 'time2',
          location: 'thing3',
        },
      },
    }))
    assert.equal(templates.event_reminder.templateId, 'template-1')
    assert.deepEqual(renderTemplateData(templates.event_reminder, {
      title: '一场标题很长但会被消费者消息安全截断的活动',
      time: '7月26日 09:30',
      location: '上海市静安区',
    }), {
      thing1: { value: '一场标题很长但会被消费者消息安全截断的活' },
      time2: { value: '7月26日 09:30' },
      thing3: { value: '上海市静安区' },
    })
  })

  it('fails closed for malformed configuration', () => {
    assert.throws(
      () => parseTemplateConfig('{"event_update":{"templateId":"","fields":{}}}'),
      /SUBSCRIBE_TEMPLATE_CONFIG_INVALID/,
    )
  })
})
