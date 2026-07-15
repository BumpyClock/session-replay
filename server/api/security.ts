import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { ApiError } from './errors'

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

/**
 * Validates allowed editor origins and request hosts.
 */
export function assertLocalRequest(
  request: Request,
  allowedOrigins: readonly string[],
): string | null {
  const canonicalAllowedOrigins = normalizeAllowedOrigins(allowedOrigins)
  const requestUrl = new URL(request.url)

  if (!LOCAL_HOSTS.has(requestUrl.hostname)) {
    throw new ApiError(403, 'host_not_allowed', 'Request host must be localhost')
  }

  const origin = request.headers.get('origin')

  if (!origin) {
    return null
  }

  let originUrl: URL

  try {
    originUrl = new URL(origin)
  } catch {
    throw new ApiError(403, 'origin_not_allowed', 'Origin is not an allowed editor origin')
  }

  if (origin === 'null' || !canonicalAllowedOrigins.has(originUrl.origin)) {
    throw new ApiError(403, 'origin_not_allowed', 'Origin is not an allowed editor origin')
  }

  return originUrl.origin
}

export function normalizeAllowedOrigins(allowedOrigins: readonly string[]): ReadonlySet<string> {
  return new Set(allowedOrigins.map(normalizeConfiguredOrigin))
}

function normalizeConfiguredOrigin(origin: string): string {
  let url: URL

  try {
    url = new URL(origin)
  } catch {
    throw invalidOriginConfig()
  }

  if (
    url.origin === 'null' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw invalidOriginConfig()
  }

  return url.origin
}

function invalidOriginConfig(): ApiError {
  return new ApiError(
    500,
    'invalid_origin_config',
    'Allowed editor origins must be exact HTTP origins',
  )
}

/**
 * Resolves a user-provided path and ensures it stays under the configured home directory.
 */
export function assertPathInsideHome(pathValue: string, homeDirectory = homedir()): string {
  let expandedPath: string

  if (pathValue === '~') {
    expandedPath = resolve(homeDirectory)
  } else if (pathValue.startsWith('~/')) {
    expandedPath = resolve(homeDirectory, pathValue.slice(2))
  } else if (pathValue.startsWith('~')) {
    throw new ApiError(400, 'invalid_path', 'Path uses unsupported tilde syntax')
  } else {
    expandedPath = resolve(pathValue)
  }
  const safeHomePath = toComparablePath(expandIfExists(resolve(homeDirectory)))
  const safeCandidatePath = toComparablePath(expandIfExists(expandedPath))

  if (
    safeCandidatePath !== safeHomePath &&
    !safeCandidatePath.startsWith(`${safeHomePath}/`)
  ) {
    throw new ApiError(403, 'path_not_allowed', 'Path must stay under the user home directory')
  }

  return expandedPath
}

function expandIfExists(pathValue: string): string {
  try {
    return realpathSync(pathValue)
  } catch {
    return pathValue
  }
}

function toComparablePath(pathValue: string): string {
  return pathValue.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
}
