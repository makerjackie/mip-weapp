import { describe, expect, it } from 'vitest'
import { parseDevtoolsLoginResult } from '../scripts/lib/runtime-preflight.mjs'

describe('DevTools login result', () => {
  it('requires an explicit positive CLI result', () => {
    expect(parseDevtoolsLoginResult('{"login":true}')).toBe(true)
    expect(parseDevtoolsLoginResult('islogin\n{ login: true }')).toBe(true)
  })

  it('fails closed for logged out, missing, or contradictory results', () => {
    for (const output of ['{"login":false}', '', 'command exited successfully', '{login:true}\n{login:false}', '{"login":"true"}']) {
      expect(parseDevtoolsLoginResult(output)).toBe(false)
    }
  })
})
