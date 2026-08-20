import { getCustomNavigationStatusBarHeight } from '@weapp/platform/navigation'
import { leaveCase } from '../../modules/platform/case-navigation'

const statusBarHeight = getCustomNavigationStatusBarHeight()

Component({
  data: {
    statusBarHeight,
  },
  methods: {
    leaveCase,
  },
})
