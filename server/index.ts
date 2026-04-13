import type { Server } from 'bun'
import { serve } from 'bun'
import { homedir } from 'node:os'
import { createApiHandler, type ApiHandlerOptions } from './api/handler'

/**
 * HTTP server options for local replay development.
 */
export interface ApiServerOptions extends ApiHandlerOptions {
  hostname?: string
  port?: number
}

/**
 * Starts the local replay HTTP server.
 */
export function createApiServer(options: ApiServerOptions = {}): Server {
  const hostname = options.hostname ?? '127.0.0.1'
  const port = options.port ?? 4848
  const fetch = createApiHandler({
    homeDirectory: options.homeDirectory ?? homedir(),
    sessionSource: options.sessionSource,
  })

  return serve({
    fetch,
    hostname,
    port,
  })
}

export * from './api/handler'
export * from './api/session-source'
export * from './export/render-replay-document'
