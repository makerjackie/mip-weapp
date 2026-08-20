import path from 'node:path'
import { defineConfig } from 'vitest/config'

const root = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: {
      '@weapp/shared/cache': path.join(root, 'src/shared/cache.ts'),
      '@weapp/shared/retry': path.join(root, 'src/shared/retry.ts'),
      '@weapp/shared/admin-list': path.join(root, 'src/shared/admin-list.ts'),
      '@weapp/shared/presenter': path.join(root, 'src/shared/presenter.ts'),
      '@weapp/shared/haptics': path.join(root, 'src/shared/haptics.ts'),
      '@weapp/platform/runtime-config': path.join(root, 'src/platform/runtime/config.ts'),
      '@weapp/platform/media-urls': path.join(root, 'src/platform/storage/media-urls.ts'),
      '@weapp/platform/tab-bar': path.join(root, 'src/platform/navigation/tab-bar.ts'),
      '@weapp/platform/navigation': path.join(root, 'src/platform/navigation/status-bar.ts'),
      '@weapp/platform/cloudbase': path.join(root, 'src/platform/cloudbase/runtime.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
