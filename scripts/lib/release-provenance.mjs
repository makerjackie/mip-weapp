import { execFileSync } from 'node:child_process'

export function readReleaseSource(root) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return {
    sha: git(['rev-parse', 'HEAD']),
    mainSha: git(['rev-parse', 'origin/main']),
    branch: git(['branch', '--show-current']),
    dirty: Boolean(git(['status', '--porcelain'])),
  }
}

export function assertReleaseSource(source, { channel, expectedSha } = {}) {
  if (source.dirty) {
    throw new Error('发布源码必须已提交且工作区干净。')
  }
  if (channel === 'prod' && (source.branch !== 'main' || source.sha !== source.mainSha)) {
    throw new Error('生产包必须从与 origin/main 一致的 main 构建；先 fetch 并整合、推送代码。')
  }
  if (expectedSha && source.sha !== expectedSha) {
    throw new Error('门禁或构建期间源码提交发生变化，停止上传。')
  }
  if (!/^[0-9a-f]{40}$/.test(source.sha)) {
    throw new Error('无法取得可追溯的 Git 提交号。')
  }
  return source.sha
}

export function assertReleaseBuildMarker(common, sha) {
  if (!common.includes(`buildSha:\`${sha}\``) && !common.includes(`buildSha:"${sha}"`)) {
    throw new Error('产物源码标记与发布提交不一致，停止上传。')
  }
}
