import { spawn } from 'node:child_process'
import path from 'node:path'
import {
  resolveCliPath,
} from 'weapp-ide-cli'

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function runWechatCli(command, projectPath, options = {}) {
  const timeoutMs = options.timeoutMs ?? 20000
  const { cliPath } = await resolveCliPath()
  if (!cliPath) {
    throw new Error('WECHAT_DEVTOOLS_CLI_NOT_FOUND')
  }
  const args = command === 'open'
    ? ['open', '--project', projectPath, '--trust-project']
    : [command]
  await new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let settled = false
    let timer
    const finish = (error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
      }
      else {
        resolve()
      }
    }
    child.stdout.on('data', chunk => output += chunk)
    child.stderr.on('data', chunk => output += chunk)
    child.once('error', finish)
    child.once('exit', (code) => {
      if (code === 0) {
        finish()
        return
      }
      finish(new Error(`WECHAT_DEVTOOLS_${command.toUpperCase()}_FAILED: ${output.trim() || `exit ${code}`}`))
    })
    timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish()
    }, timeoutMs)
  })
}

function openWechatProject({ projectPath }) {
  return runWechatCli('open', projectPath)
}

function closeFocusedWechatProject() {
  return runWechatCli('close')
}

/**
 * Opens the isolated local host before starting `cli auto`.
 *
 * WeChat DevTools can expose the Tool websocket before the Mini Program App
 * domain has compiled. Prewarming makes runtime readiness deterministic. The
 * recovery path focuses the intended project before calling the global `close`
 * command, so other project windows remain open.
 */
export async function warmWechatDevtoolsProject(options) {
  const projectPath = path.resolve(options.projectPath)
  const restart = options.restart === true
  const settleMs = options.settleMs ?? 15000
  const openProject = options.openProject || openWechatProject
  const closeProject = options.closeProject || closeFocusedWechatProject
  const wait = options.wait || delay

  if (restart) {
    await openProject({ projectPath, trustProject: true })
    await wait(750)
    await closeProject()
    await wait(750)
  }
  await openProject({ projectPath, trustProject: true })
  await wait(settleMs)
}
