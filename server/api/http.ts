import type { ApiErrorResponse } from '../../src/lib/api/contracts'
import { ApiError } from './errors'

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
}

/**
 * Echoes safe localhost origins for the browser editor shell.
 */
export function createCorsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  })

  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
  }

  return headers
}

/**
 * Serializes JSON responses with optional CORS headers.
 */
export function jsonResponse(
  payload: unknown,
  init: ResponseInit = {},
  corsHeaders?: Headers,
): Response {
  const headers = new Headers(init.headers)

  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    headers.set(key, value)
  })

  corsHeaders?.forEach((value, key) => {
    headers.set(key, value)
  })

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  })
}

/**
 * Builds a stable API error payload from thrown errors.
 */
export function errorResponse(error: unknown, corsHeaders?: Headers): Response {
  if (error instanceof ApiError) {
    return jsonResponse<ApiErrorResponse>(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
      corsHeaders,
    )
  }

  return jsonResponse<ApiErrorResponse>(
    {
      error: {
        code: 'internal_error',
        message: 'Unexpected server error',
      },
    },
    { status: 500 },
    corsHeaders,
  )
}

/**
 * Parses JSON request bodies with 400-level failures.
 */
export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be valid JSON')
  }
}
