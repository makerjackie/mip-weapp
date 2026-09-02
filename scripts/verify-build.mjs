#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import {
  assertCompiledTDesignRegistrations,
  assertOfficialCustomTabBar,
} from './lib/ui-contracts.mjs'

const root = path.resolve(import.meta.dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function walk(relativePath) {
  const absolute = path.join(root, relativePath)
  if (!fs.existsSync(absolute)) {
    return []
  }
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relativePath, entry.name)
    return entry.isDirectory() ? walk(child) : [child]
  })
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function resolveBuiltComponent(jsonFile, reference) {
  if (/^(?:plugin|dynamicLib):\/\//.test(reference)) {
    return null
  }
  const basePath = reference.startsWith('/')
    ? path.join(root, 'dist', reference.slice(1))
    : reference.startsWith('.')
      ? path.resolve(path.dirname(path.join(root, jsonFile)), reference)
      : path.join(root, 'dist', 'miniprogram_npm', reference)
  const buildRoot = path.join(root, 'dist')
  assert(basePath === buildRoot || basePath.startsWith(`${buildRoot}${path.sep}`), `${jsonFile} component escapes dist: ${reference}`)
  return basePath.replace(/\.json$/, '')
}

function assertBuiltComponentTargets() {
  for (const jsonFile of walk('dist').filter(file => file.endsWith('.json'))) {
    const definition = JSON.parse(read(jsonFile))
    for (const referenceValue of Object.values(definition.usingComponents || {})) {
      const reference = String(referenceValue)
      const target = resolveBuiltComponent(jsonFile, reference)
      if (!target) {
        continue
      }
      for (const extension of ['.json', '.js', '.wxml']) {
        assert(fs.existsSync(`${target}${extension}`), `Compiled component target is missing: ${jsonFile} -> ${reference}${extension}`)
      }
    }
  }
}

const appWxss = read('dist/app.wxss')
const membershipWxml = read('dist/pages/membership/index.wxml')
const homeWxml = read('dist/pages/index/index.wxml')
const adminWxml = read('dist/packages/admin/dashboard/index.wxml')
const privacyWxml = read('dist/packages/member/privacy/index.wxml')
const privacyPolicyWxml = read('dist/packages/member/privacy-policy/index.wxml')
const badgeCollectionJs = read('dist/packages/member/mip-badges/index.js')
const memberProfileJs = read('dist/packages/member/mip-profile/index.js')
const checkInJs = read('dist/packages/member/mip-events/check-in/index.js')
const checkInWxml = read('dist/packages/member/mip-events/check-in/index.wxml')
const eventFunction = read('cloudfunctions/mip-events-api/index.js')
const eventService = read('cloudfunctions/mip-events-api/domain/event-service.js')
const tabBarWxml = read('dist/custom-tab-bar/index.wxml')
const tabBarWxss = read('dist/custom-tab-bar/index.wxss')
const tabBarJson = JSON.parse(read('dist/custom-tab-bar/index.json'))
const appJson = JSON.parse(read('dist/app.json'))
const membershipJson = JSON.parse(read('dist/pages/membership/index.json'))
const homeJson = JSON.parse(read('dist/pages/index/index.json'))
const components = { ...membershipJson.usingComponents, ...homeJson.usingComponents }

assertBuiltComponentTargets()
assert(appWxss.includes('.bg-canvas'), 'MIP design tokens did not reach WXSS')
assert(appWxss.includes('.grid-cols-2'), 'Tailwind grid utilities did not reach WXSS')
for (const tab of appJson.tabBar?.list || []) {
  const tabPageJson = JSON.parse(read(`dist/${tab.pagePath}.json`))
  assert(
    tabPageJson.backgroundColorContent === '#040404',
    `MIP Tab page container background is not opaque: ${tab.pagePath}`,
  )
}
for (const subPackage of appJson.subPackages || appJson.subpackages || []) {
  if (subPackage.independent !== true) {
    assert(
      !fs.existsSync(path.join(root, 'dist', subPackage.root, 'miniprogram_npm')),
      `Subpackage ${subPackage.root} must reuse main-package npm dependencies to stay below the WeChat 2 MB limit`,
    )
    for (const jsonFile of walk(path.join('dist', subPackage.root)).filter(file => file.endsWith('.json'))) {
      const json = JSON.parse(read(jsonFile))
      for (const reference of Object.values(json.usingComponents || {})) {
        assert(
          !String(reference).includes('../miniprogram_npm/'),
          `Subpackage npm component must use a main-package absolute path: ${jsonFile} -> ${reference}`,
        )
      }
    }
  }
}
assert(
  !walk('dist/packages/member').some(file => file.includes('/packages_admin.') || file.includes('/packages/admin/')),
  'Member subpackage must not include admin runtime output',
)
assert(
  fs.existsSync(path.join(root, 'dist/modules/mip-identity/profile-options.js'))
  && fs.existsSync(path.join(root, 'dist/modules/mip-growth/badge-presentation.js')),
  'Member runtime presentation modules were not emitted as source-path chunks',
)
assert(
  badgeCollectionJs.includes('../../../modules/mip-growth/badge-presentation.js')
  && memberProfileJs.includes('../../../modules/mip-identity/profile-options.js'),
  'Member pages must load presentation seams directly instead of relying on a subpackage common export',
)
assert(!membershipWxml.includes('pb-[calc('), 'Tailwind arbitrary safe-area class was not transformed')
assert(homeWxml.includes('mip-home-page'), 'Runtime-stable MIP home selector is missing')
assert(membershipWxml.includes('mip-membership-page'), 'Runtime-stable MIP membership selector is missing')
assert(adminWxml.includes('admin-dashboard-page'), 'Runtime-stable admin selector is missing')
assert(privacyWxml.includes('privacy-account-page'), 'Runtime-stable privacy selector is missing')
assert(privacyPolicyWxml.includes('mip-privacy-policy-page'), 'Runtime-stable privacy policy selector is missing')
assert(Object.values(components).some(value => String(value).includes('tdesign-miniprogram/button')), 'TDesign button was not auto-imported')
assert(Object.values(components).some(value => String(value).includes('tdesign-miniprogram/skeleton')), 'TDesign cold-start skeleton was not auto-imported')
assert(Object.values(tabBarJson.usingComponents).some(value => String(value).includes('tdesign-miniprogram/icon')), 'TDesign custom TabBar icons were not built')
const tabConfig = read('src/config/tabs.ts')
for (const icon of ['compass-filled', 'calendar-event-filled', 'work-filled', 'user-filled']) {
  assert(tabConfig.includes(`'${icon}'`), `Built TabBar TDesign icon ${icon} is missing`)
}
assertOfficialCustomTabBar(tabBarWxml, appJson, assert, 'MIP built custom TabBar', { compiled: true, wxss: tabBarWxss })
assert(
  checkInWxml.includes('id="mip-event-check-in-page"') && checkInWxml.includes('bind:tap="scanCode"'),
  'Built MIP check-in page must expose its runtime root and scan action',
)
assert(
  checkInJs.includes('wx.scanCode')
  && checkInJs.includes('qrCode')
  && checkInJs.includes('mipEventsModule.checkIn'),
  'Built MIP check-in page must scan a QR code and submit the token through the events module',
)
assert(
  eventFunction.includes(`case 'mip.events.checkIn'`)
  && eventFunction.includes('service.checkIn(mysqlDatabase()'),
  'MIP events function must route check-in to the MySQL-backed domain service',
)
assert(
  eventService.includes('mip_event_checkin_credentials')
  && eventService.includes('token_hash = ?')
  && eventService.includes(`presented.kind === 'SCAN'`)
  && eventService.includes('checkInCredentialQuery(presented.parsed, { lock: true })')
  && eventService.includes('checkInResumeRef(presented.credentialKind, presented.credentialRef, { lock: true })')
  && eventService.includes('credential.event_id !== presented.eventId')
  && eventService.includes('sha256(secret)')
  && eventService.includes('assertCheckInAllowed')
  && eventService.includes(`SET status = 'ATTENDED', version = version + 1`),
  'MIP check-in must validate the server credential and registration before recording attendance',
)
assert(walk('dist').some(file => !file.startsWith('dist/miniprogram_npm/') && file.endsWith('.wxml') && read(file).includes('<t-icon')), 'Built MIP pages must retain TDesign interface icons')
assertCompiledTDesignRegistrations({
  buildRoot: path.join(root, 'dist'),
  assert,
  label: 'MIP compiled UI',
})
assert(tabBarWxss.includes('safe-area-inset-bottom'), 'Custom TabBar must handle the device safe area')

console.log('MIP build contract passed')
