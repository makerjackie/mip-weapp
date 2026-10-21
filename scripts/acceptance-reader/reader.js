(() => {
  const reader = document.querySelector('[data-reader]')
  if (!reader) {
    return
  }
  const links = [...reader.querySelectorAll('[data-toc-link]')]
  const targets = links.map(link => document.getElementById(link.hash.slice(1)))
  const select = reader.querySelector('.mobile-toc select')
  const status = document.querySelector('.reader-status')
  let statusTimer

  function activate(id) {
    for (const link of links) {
      if (link.hash === `#${id}`) {
        link.setAttribute('aria-current', 'location')
      }
      else {
        link.removeAttribute('aria-current')
      }
    }
    select.value = id
  }

  function syncHash() {
    let id
    try {
      id = decodeURIComponent(window.location.hash.slice(1))
    }
    catch {
      return
    }
    let node = document.getElementById(id)
    while (node && !targets.includes(node)) {
      node = node.parentElement
    }
    if (node) {
      activate(node.id)
    }
    else if (!id && targets[0]) {
      activate(targets[0].id)
    }
  }

  select.addEventListener('change', () => {
    window.location.hash = select.value
  })
  window.addEventListener('hashchange', syncHash)
  window.addEventListener('pageshow', syncHash)

  let scrollFrame = false
  window.addEventListener('scroll', () => {
    if (scrollFrame) {
      return
    }
    scrollFrame = true
    window.requestAnimationFrame(() => {
      scrollFrame = false
      const offset = (Number.parseFloat(window.getComputedStyle(targets[0]).scrollMarginTop) || 28) + 8
      let current = targets[0]
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= offset) {
          current = target
        }
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) {
        current = targets.at(-1)
      }
      if (current) {
        activate(current.id)
      }
    })
  }, { passive: true })

  reader.addEventListener('click', async (event) => {
    const link = event.target.closest('[data-copy-link]')
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
      return
    }
    event.preventDefault()
    const url = new URL(link.href)
    window.history.replaceState(null, '', url.hash)
    syncHash()
    try {
      await navigator.clipboard.writeText(url.href)
      status.textContent = '链接已复制，可直接分享这一项'
    }
    catch {
      status.textContent = '已定位此项，可复制浏览器地址栏链接'
    }
    status.hidden = false
    window.clearTimeout(statusTimer)
    statusTimer = window.setTimeout(() => status.hidden = true, 3500)
  })

  const viewer = document.createElement('dialog')
  viewer.className = 'image-viewer'
  viewer.setAttribute('aria-labelledby', 'image-viewer-caption')
  viewer.innerHTML = '<div class="image-viewer-toolbar"><p id="image-viewer-caption"></p><button type="button" data-image-close aria-label="关闭图片预览">关闭</button><button type="button" data-image-zoom aria-pressed="false">放大</button></div><p class="image-viewer-message" role="status"></p><button type="button" data-image-retry hidden>重试</button><div class="image-viewer-stage" tabindex="0" aria-label="图片，可滚动查看"><img alt=""></div>'
  document.body.append(viewer)
  const viewerImage = viewer.querySelector('img')
  const viewerStage = viewer.querySelector('.image-viewer-stage')
  const viewerMessage = viewer.querySelector('[role="status"]')
  const zoom = viewer.querySelector('[data-image-zoom]')
  const retry = viewer.querySelector('[data-image-retry]')
  let opener
  let fullSource

  function loadImage() {
    viewerImage.hidden = true
    viewerMessage.textContent = '正在加载原图…'
    retry.hidden = true
    zoom.disabled = true
    viewerImage.src = fullSource
  }
  function closeImage() {
    viewer.close()
  }
  viewerImage.addEventListener('load', () => {
    viewerImage.hidden = false
    viewerMessage.textContent = ''
    zoom.disabled = false
  })
  viewerImage.addEventListener('error', () => {
    viewerMessage.textContent = '原图加载失败，请重试'
    retry.hidden = false
  })
  retry.addEventListener('click', loadImage)
  zoom.addEventListener('click', () => {
    const enlarged = viewer.classList.toggle('image-viewer-zoomed')
    viewerImage.style.width = enlarged ? `${Math.max(viewerImage.naturalWidth, viewerStage.clientWidth * 2)}px` : ''
    viewerStage.scrollTo(0, 0)
    zoom.setAttribute('aria-pressed', String(enlarged))
    zoom.textContent = enlarged ? '适应屏幕' : '放大'
  })
  viewer.querySelector('[data-image-close]').addEventListener('click', closeImage)
  viewer.addEventListener('click', (event) => {
    const bounds = viewer.getBoundingClientRect()
    if (event.target === viewer && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) {
      closeImage()
    }
  })
  viewer.addEventListener('close', () => {
    document.documentElement.classList.remove('image-viewer-open')
    viewer.classList.remove('image-viewer-zoomed')
    zoom.setAttribute('aria-pressed', 'false')
    zoom.textContent = '放大'
    viewerImage.removeAttribute('src')
    viewerImage.style.width = ''
    opener?.focus({ preventScroll: true })
  })
  for (const image of reader.querySelectorAll('img')) {
    const trigger = image.closest('a, button') || image
    trigger.setAttribute('aria-haspopup', 'dialog')
    if (trigger === image) {
      image.tabIndex = 0
      image.setAttribute('role', 'button')
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          image.click()
        }
      })
    }
  }
  reader.addEventListener('click', (event) => {
    const image = event.target.closest('img') || event.target.closest('a, button')?.querySelector('img')
    if (!image || typeof viewer.showModal !== 'function') {
      return
    }
    event.preventDefault()
    opener = image.closest('a, button') || image
    fullSource = image.dataset.fullSrc || image.closest('a')?.href || image.src
    viewerImage.alt = image.alt
    viewer.querySelector('#image-viewer-caption').textContent = image.alt || '图片预览'
    viewer.showModal()
    document.documentElement.classList.add('image-viewer-open')
    loadImage()
  })

  document.documentElement.classList.add('reader-ready')
  syncHash()
})()
