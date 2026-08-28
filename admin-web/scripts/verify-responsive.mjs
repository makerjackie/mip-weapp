import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const index = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const assets = path.join(dist, 'assets')
const assetFiles = fs.readdirSync(assets)
const antDesignChunks = assetFiles.filter(file => /^ant-design-.*\.js$/.test(file))
const css = fs.readdirSync(assets)
  .filter(file => file.endsWith('.css'))
  .map(file => fs.readFileSync(path.join(assets, file), 'utf8'))
  .join('\n')
const sourceCss = fs.readFileSync(path.join(root, 'src/styles/app.css'), 'utf8')
const sourceShell = fs.readFileSync(path.join(root, 'src/shared/ui/responsive-app-shell.tsx'), 'utf8')

const checks = [
  [index.includes('src/main.ts'), 'legacy DOM entry remains in production HTML'],
  [!index.includes('/assets/'), 'production HTML does not reference built assets'],
  [antDesignChunks.length !== 1, 'Ant Design must stay in one production chunk to preserve module initialization order'],
  [!sourceCss.includes('overflow-x: hidden'), 'root horizontal overflow guard is missing'],
  [!sourceCss.includes('@media (max-width: 767px)'), 'mobile breakpoint is missing'],
  [!sourceCss.includes('.admin-main { width: 100%; margin-left: 0; }'), 'mobile layout does not release desktop sidebar width'],
  [!sourceCss.includes('.detail-drawer .ant-drawer-content-wrapper { width: 100%'), 'mobile detail drawer is not full width'],
  [!sourceShell.includes('mobile-navigation'), 'responsive navigation drawer is missing'],
  [!sourceShell.includes('aria-label="打开导航"'), 'mobile navigation control has no accessible label'],
  [!css.includes('--mip-sidebar-width'), 'built CSS is missing the shared sidebar token'],
]

const failed = checks.filter(([condition]) => condition).map(([, message]) => message)
if (failed.length) throw new Error(`Responsive contract failed:\n${failed.join('\n')}`)

console.log('Responsive source and production asset contract passed')
