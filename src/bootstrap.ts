import { initializeCloudbase } from './platform/cloudbase/client'

let prepared = false

export function prepareApp() {
  if (prepared) {
    return
  }
  prepared = true
  initializeCloudbase()
}
