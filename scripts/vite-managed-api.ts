import { spawn, type ChildProcess } from 'node:child_process'
import process from 'node:process'
import type { Plugin } from 'vite'
import { API_HEALTH_PATH } from '../server/api/routes'

const API_READY_TIMEOUT_MS = 30_000
const API_READY_POLL_MS = 300

interface ManagedApiState {
  child: ChildProcess
  cleanup: () => Promise<void>
  owned: true
}

interface ExternalApiState {
  cleanup: () => Promise<void>
  owned: false
}

type ApiState = ManagedApiState | ExternalApiState

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function canReachApi(healthUrl: string): Promise<boolean> {
  try {
    const response = await fetch(healthUrl, { method: 'GET' })
    return response.ok
  } catch {
    return false
  }
}

function getApiCommand(): [string, string[]] {
  if (process.versions.bun) {
    return [process.execPath, ['run', 'server/dev.ts']]
  }

  return ['bun', ['run', 'server/dev.ts']]
}

async function stopManagedChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  child.kill('SIGTERM')

  const terminated = await Promise.race([
    new Promise<boolean>((resolve) => {
      child.once('exit', () => resolve(true))
    }),
    wait(1_500).then(() => false),
  ])

  if (terminated) {
    return
  }

  child.kill('SIGKILL')
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    }),
    wait(500),
  ])
}

async function waitForApiReady(healthUrl: string, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + API_READY_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (await canReachApi(healthUrl)) {
      return
    }

    if (child && child.exitCode !== null) {
      throw new Error(`[vite-api] API exited with code ${child.exitCode} before becoming ready`)
    }

    await wait(API_READY_POLL_MS)
  }

  throw new Error(`[vite-api] API did not become ready within ${API_READY_TIMEOUT_MS}ms (${healthUrl})`)
}

async function ensureApiState(apiBaseUrl: string): Promise<ApiState> {
  const healthUrl = new URL(API_HEALTH_PATH, apiBaseUrl).toString()

  if (await canReachApi(healthUrl)) {
    console.log(`[vite-api] reusing API at ${healthUrl}`)
    return {
      owned: false,
      cleanup: async () => {},
    }
  }

  const [command, args] = getApiCommand()
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: {
      ...process.env,
      SESSION_REPLAY_MANAGED_BY_VITE: '1',
    },
  })

  child.once('exit', (code, signal) => {
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGKILL') {
      return
    }

    console.error(`[vite-api] managed API exited unexpectedly (code=${code}, signal=${signal})`)
  })

  console.log(`[vite-api] starting local API at ${healthUrl}`)
  await waitForApiReady(healthUrl, child)
  console.log(`[vite-api] API ready at ${healthUrl}`)

  return {
    owned: true,
    child,
    cleanup: async () => {
      await stopManagedChild(child)
    },
  }
}

export function managedApiPlugin(apiBaseUrl: string): Plugin {
  let apiStatePromise: Promise<ApiState> | null = null
  let cleanupPromise: Promise<void> | null = null

  async function cleanupApi(): Promise<void> {
    if (!apiStatePromise) {
      return
    }

    if (!cleanupPromise) {
      cleanupPromise = apiStatePromise.then((state) => state.cleanup())
    }

    await cleanupPromise
  }

  return {
    name: 'session-replay-managed-api',
    apply: 'serve',
    async configureServer(server) {
      if (!apiStatePromise) {
        apiStatePromise = ensureApiState(apiBaseUrl)
      }

      await apiStatePromise

      server.httpServer?.once('close', () => {
        void cleanupApi()
      })
    },
  }
}
