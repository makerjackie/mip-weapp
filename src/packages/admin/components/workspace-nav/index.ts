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
    activeItemTarget: '',
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
        const groups = session.enabled
          ? buildAdminWorkspaceNavigation(session.capabilities, currentAdminRoute())
          : []
        const activeItem = groups
          .flatMap(group => group.items)
          .find(item => item.active)
        this.setData({
          groups,
          activeItemTarget: activeItem ? `admin-nav-${activeItem.key}` : '',
        })
      }
      catch {
        this.setData({ groups: [], activeItemTarget: '' })
      }
    },

    navigate(event: WechatMiniprogram.TouchEvent) {
      const targetRoute = String(event.currentTarget.dataset.route || '')
      redirectToAdminWorkspace(currentAdminRoute(), targetRoute, wx)
    },
  },
})
