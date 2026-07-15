import { homedir } from 'node:os'
import type {
  SessionListResponse,
  SessionLoadRequest,
  SessionLoadResponse,
  SessionSearchResponse,
} from '../../src/lib/api/contracts'
import {
  sessionLoadRequestSchema,
  sessionRenderRequestSchema,
  sessionSearchRequestSchema,
} from '../../src/lib/api/schemas'
import { renderReplayDocument, sanitizeDownloadName } from '../export/render-replay-document'
import { ApiError } from './errors'
import { createCorsHeaders, errorResponse, jsonResponse, readJsonBody } from './http'
import { API_HEALTH_PATH, API_SESSIONS_PATH, API_SESSIONS_REFRESH_PATH } from './routes'
import { assertLocalRequest, assertPathInsideHome, normalizeAllowedOrigins } from './security'
import { createEmptySessionSource, type SessionSource } from './session-source'

/**
 * Immutable runtime dependencies for the local replay API.
 */
export interface ApiHandlerOptions {
  allowedOrigins?: readonly string[]
  homeDirectory?: string
  sessionSource?: SessionSource
}

const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
] as const

/**
 * Creates the request handler used by the Bun HTTP server and tests.
 */
export function createApiHandler(options: ApiHandlerOptions = {}): (request: Request) => Promise<Response> {
  const sessionSource = options.sessionSource ?? createEmptySessionSource()
  const homeDirectory = options.homeDirectory ?? homedir()
  const allowedOrigins = [...normalizeAllowedOrigins(options.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS)]

  return async (request) => {
    let corsHeaders: Headers | undefined

    try {
      const origin = assertLocalRequest(request, allowedOrigins)
      corsHeaders = createCorsHeaders(origin)

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: corsHeaders,
          status: 204,
        })
      }

      const { pathname } = new URL(request.url)

      if ((request.method === 'GET' || request.method === 'HEAD') && pathname === API_HEALTH_PATH) {
        return new Response(null, {
          headers: corsHeaders,
          status: 204,
        })
      }

      if (request.method === 'GET' && pathname === API_SESSIONS_PATH) {
        const response = createSessionListResponse(sessionSource, await sessionSource.listSessions())

        return jsonResponse(response, { status: 200 }, corsHeaders)
      }

      if (request.method === 'POST' && pathname === API_SESSIONS_REFRESH_PATH) {
        const response = createSessionListResponse(sessionSource, await sessionSource.refreshSessions())

        return jsonResponse(response, { status: 200 }, corsHeaders)
      }

      if (request.method === 'POST' && pathname === '/api/load') {
        const body = await readJsonBody(request, sessionLoadRequestSchema)
        const resolvedRequest = normalizeLoadRequest(body, homeDirectory)
        const response: SessionLoadResponse = {
          session: await sessionSource.loadSession(resolvedRequest),
        }

        return jsonResponse(response, { status: 200 }, corsHeaders)
      }

      if (request.method === 'POST' && pathname === '/api/search') {
        const body = await readJsonBody(request, sessionSearchRequestSchema)
        const query = body.query.trim()

        if (!query) {
          throw new ApiError(400, 'invalid_query', 'Search query must not be empty')
        }

        const response: SessionSearchResponse = {
          results: [...(await sessionSource.searchSessions({ ...body, query }))],
        }

        return jsonResponse(response, { status: 200 }, corsHeaders)
      }

      if (request.method === 'POST' && pathname === '/api/export') {
        const body = await readJsonBody(request, sessionRenderRequestSchema)
        const html = renderReplayDocument(body.session, body.options)
        const { searchParams } = new URL(request.url)
        const fileName = sanitizeDownloadName(
          searchParams.get('fileName') ?? body.options?.exportTitle ?? body.session.title,
        )
        const headers = new Headers({
          'Content-Disposition': `attachment; filename="${fileName}.html"`,
          'Content-Type': 'text/html; charset=utf-8',
        })

        corsHeaders.forEach((value, key) => {
          headers.set(key, value)
        })

        return new Response(html, {
          headers,
          status: 200,
        })
      }

      throw new ApiError(404, 'not_found', 'Route not found')
    } catch (error) {
      return errorResponse(error, corsHeaders)
    }
  }
}

function createSessionListResponse(
  sessionSource: SessionSource,
  sessions: readonly SessionListResponse['sessions'][number][],
): SessionListResponse {
  const catalog = sessionSource.getCatalogStatus?.()
  const warnings = sessionSource.listCatalogWarnings?.() ?? []

  const response: SessionListResponse = {
    sessions: [...sessions],
  }

  if (catalog) {
    response.catalog = catalog
  }

  if (warnings.length > 0) {
    response.warnings = [...warnings]
  }

  return response
}

/**
 * Accepts either a session id or an explicit path and rejects paths outside the
 * user home directory before provider load logic runs.
 */
function normalizeLoadRequest(
  body: SessionLoadRequest,
  homeDirectory: string,
): SessionLoadRequest {
  if (!body.path && !body.sessionId) {
    throw new ApiError(400, 'invalid_request', 'Load request requires a sessionId or path')
  }

  return body.path
    ? {
        ...body,
        path: assertPathInsideHome(body.path, homeDirectory),
      }
    : body
}
