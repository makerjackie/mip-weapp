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

  document.documentElement.classList.add('reader-ready')
  syncHash()
})()
