import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

export function isLocalPortListening(port, { timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const finish = (listening) => {
      socket.destroy()
      resolve(listening)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('timeout', () => finish(false))
  })
}

/**
 * Remove only a dead weapp-ide-cli port lease. A live listener or owner process
 * always wins: runtime verification must attach to it or stop, never kill
 * another worktree's DevTools session.
 */
export async function clearStaleAutomatorPortLease(
  port,
  {
    leaseRoot = path.join(os.tmpdir(), 'weapp-vite-automator-port-leases'),
    processAlive = (pid) => {
      try {
        process.kill(pid, 0)
        return true
      }
      catch (error) {
        return error?.code !== 'ESRCH'
      }
    },
  } = {},
) {
  const leasePath = path.join(leaseRoot, `${port}.lock`)
  if (!fs.existsSync(leasePath) || await isLocalPortListening(port)) {
    return false
  }
  let ownerPid = 0
  try {
    ownerPid = Number(JSON.parse(fs.readFileSync(leasePath, 'utf8')).pid)
  }
  catch {
    // Malformed leases have no live owner and are safe to remove.
  }
  if (Number.isInteger(ownerPid) && ownerPid > 0 && processAlive(ownerPid)) {
    return false
  }
  fs.rmSync(leasePath)
  return true
}
