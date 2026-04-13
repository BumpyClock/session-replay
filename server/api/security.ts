import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { ApiError } from './errors'

const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost'])

/**
 * Validates allowed editor origins and request hosts.
 */
export function assertLocalRequest(request: Request): string | null {
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
    throw new ApiError(403, 'origin_not_allowed', 'Origin must be localhost')
  }

  if (!LOCAL_HOSTS.has(originUrl.hostname)) {
    throw new ApiError(403, 'origin_not_allowed', 'Origin must be localhost')
  }

  return origin
}

/**
 * Resolves a user-provided path and ensures it stays under the configured home directory.
 */
export function assertPathInsideHome(pathValue: string, homeDirectory = homedir()): string {
  const expandedPath = pathValue.startsWith('~')
    ? resolve(homeDirectory, pathValue.slice(1))
    : resolve(pathValue)
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
