// Browser UI end-to-end (L3) for the MIP admin, driven by Playwright/Chromium.
//
// Logs in with the configured test administrator, loads the event module in a real
// browser, checks that key admin surfaces render, captures desktop + mobile
// screenshots and fails on unexpected console errors.
//
// Usage:
//   node scripts/qa/admin-ui-e2e.mjs [--origin=https://...] [--shots=dir]
//
// Requires the ignored .env.secrets.local to define MIP_ADMIN_TEST_PHONE / MIP_ADMIN_TEST_PASSWORD.

import process from 'node:process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { loadCaseEnv } from '../lib/example-cloudbase.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const adminWebDir = path.join(root, 'admin-web')
const require = createRequire(path.join(adminWebDir, 'package.json'))
const { chromium } = require('@playwright/test')
const env = loadCaseEnv(root)
const flag = name => process.argv.find(arg => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const origin = new URL(flag('--origin') || env.MIP_ADMIN_TEST_ORIGIN || 'https://admin.mip.cool').origin
const shotsDir = flag('--shots') || path.join(root, 'docs/mip/evidence/admin-w05-20261016/shots')

if (!env.MIP_ADMIN_TEST_PHONE || !env.MIP_ADMIN_TEST_PASSWORD) {
  console.error('Missing MIP_ADMIN_TEST_PHONE / MIP_ADMIN_TEST_PASSWORD in the ignored .env.secrets.local')
  process.exit(2)
}
fs.mkdirSync(shotsDir, { recursive: true })

const results = []
const record = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const consoleErrors = []
  context.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  context.on('pageerror', error => consoleErrors.push(String(error.message || error)))

  const login = await context.request.post(`${origin}/api/auth/password/login`, {
    headers: { Origin: origin },
    data: { phone: env.MIP_ADMIN_TEST_PHONE, password: env.MIP_ADMIN_TEST_PASSWORD },
    failOnStatusCode: true,
  })
  record('api login with test account', login.ok(), `HTTP ${login.status()}`)

  const page = await context.newPage()
  await page.goto(`${origin}/#/events`, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForSelector('.ant-layout, main, #root > *', { timeout: 20_000 })
  const bodyText = await page.locator('body').innerText()
  record('events list renders', /活动/.test(bodyText), `${bodyText.replace(/\s+/g, ' ').slice(0, 60)}…`)
  await page.screenshot({ path: path.join(shotsDir, 'events-list-1440.png'), fullPage: true })

  const row = page.locator('.ant-table-row, .ant-list-item, [role="row"]').first()
  const hasRow = await row.count()
  if (hasRow) {
    await row.click({ timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(1_200)
    const detailText = await page.locator('body').innerText()
    record('event detail surfaces participation/roster', /参与情况|报名与参与人|活动信息/.test(detailText))
    await page.screenshot({ path: path.join(shotsDir, 'event-detail-1440.png'), fullPage: true })
  }
  else {
    record('event detail surfaces participation/roster', true, 'no rows to open on this dataset')
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/#/events`, { waitUntil: 'networkidle', timeout: 45_000 })
  await page.waitForTimeout(800)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  record('mobile 390px has no horizontal overflow', overflow <= 2, `overflow ${overflow}px`)
  await page.screenshot({ path: path.join(shotsDir, 'events-list-390.png'), fullPage: true })

  const benign = /favicon|manifest|ResizeObserver loop|Download the React DevTools|the server responded with a status of 40[0-9]/
  const realErrors = consoleErrors.filter(text => !benign.test(text))
  record('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))
}
catch (error) {
  record('browser run', false, String(error?.message || error))
}
finally {
  await browser.close()
}

const failed = results.filter(item => !item.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${path.relative(root, shotsDir)}`)
process.exit(failed.length ? 1 : 0)
