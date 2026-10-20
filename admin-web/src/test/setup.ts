import '@testing-library/jest-dom/vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { cleanup } from '@testing-library/react'
import { afterAll } from 'vitest'

afterAll(async () => {
  cleanup()
  // Ant Design's Form useDebounce schedules 0/10 ms updates through Node
  // timers. Let them execute while jsdom still exists, including after the
  // final unmount; otherwise React can access window after environment teardown.
  // Errors are still captured by Vitest; no timer or exception is suppressed.
  await delay(20)
})

// jsdom logs for pseudo-element styles that Ant Design probes, but returns the
// same element style. Ignore that unsupported argument in the test environment.
const getComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = (element: Element) => getComputedStyle(element)

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub })

// Router scroll restoration is a browser feature absent in jsdom.
Object.defineProperty(window, 'scrollTo', { writable: true, value: () => undefined })
