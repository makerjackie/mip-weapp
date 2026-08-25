import { brand } from '../../../../config/brand'
import { mipAdminModule } from '../../../../modules/mip-admin'
import {
  buildAdminWorkspaceNavigation,
  redirectToAdminWorkspace,
} from './model'

function currentAdminRoute() {
  const pages = getCurrentPages()
  return pages[pages.length - 1]?.route || ''
}

Component({
  data: {
    brandMark: brand.markText,
    productName: brand.productName,
    groups: [] as ReturnType<typeof buildAdminWorkspaceNavigation>,
  },

  lifetimes: {
    attached() {
      void this.refreshNavigation()
    },
  },

  pageLifetimes: {
    show() {
      void this.refreshNavigation()
    },
  },

  methods: {
    async refreshNavigation() {
      try {
        const session = await mipAdminModule.getSession()
        this.setData({
          groups: session.enabled
            ? buildAdminWorkspaceNavigation(session.capabilities, currentAdminRoute())
            : [],
        })
      }
      catch {
        this.setData({ groups: [] })
      }
    },

    navigate(event: WechatMiniprogram.TouchEvent) {
      const targetRoute = String(event.currentTarget.dataset.route || '')
      redirectToAdminWorkspace(currentAdminRoute(), targetRoute, wx)
    },
  },
})
