import type { AdminResponsivePanelPlacement } from './model'
import { createAdminResponsivePanelController } from './model'

type ResponsivePanelController = ReturnType<typeof createAdminResponsivePanelController>

const controllers = new WeakMap<object, ResponsivePanelController>()

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    title: {
      type: String,
      value: '',
    },
  },

  data: {
    placement: 'bottom' as AdminResponsivePanelPlacement,
  },

  lifetimes: {
    attached() {
      const controller = createAdminResponsivePanelController(wx, (placement) => {
        if (placement !== this.data.placement) {
          this.setData({ placement })
        }
      })
      controllers.set(this, controller)
      controller.attach()
    },
    detached() {
      controllers.get(this)?.detach()
      controllers.delete(this)
    },
  },

  methods: {
    handleClose() {
      this.triggerEvent('close', { trigger: 'close-button' })
    },
    handleVisibleChange(event: WechatMiniprogram.CustomEvent<{ visible?: boolean, trigger?: string }>) {
      this.triggerEvent('visible-change', {
        visible: event.detail.visible === true,
        trigger: event.detail.trigger || 'popup',
      })
    },
  },
})
