import { membershipModule } from './modules/membership/client'
import { initializeCloudbase } from './modules/platform/cloudbase'

let prepared = false

export function prepareApp() {
  if (prepared) {
    return
  }
  prepared = true
  initializeCloudbase()
  void membershipModule.load().catch(() => undefined)
}
