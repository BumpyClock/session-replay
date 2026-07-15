import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../server/api/errors'
import { assertLocalRequest, assertPathInsideHome } from '../../server/api/security'

describe('assertLocalRequest', () => {
  const allowedOrigins = ['http://127.0.0.1:5173']

  it('returns the canonical exact origin when configured', () => {
    const request = new Request('http://127.0.0.1:4848/api/sessions', {
      headers: { Origin: 'http://127.0.0.1:5173/' },
    })

    expect(assertLocalRequest(request, allowedOrigins)).toBe('http://127.0.0.1:5173')
  })

  it('allows requests without an Origin header', () => {
    expect(
      assertLocalRequest(new Request('http://127.0.0.1:4848/api/health'), allowedOrigins),
    ).toBeNull()
  })

  it.each([
    ['hostile port', 'http://127.0.0.1:6666'],
    ['host alias', 'http://localhost:5173'],
    ['scheme mismatch', 'https://127.0.0.1:5173'],
    ['serialized null', 'null'],
    ['malformed value', 'not an origin'],
  ])('rejects %s', (_label, origin) => {
    expect.hasAssertions()
    const request = new Request('http://127.0.0.1:4848/api/sessions', {
      headers: { Origin: origin },
    })

    expectApiError(() => assertLocalRequest(request, allowedOrigins), 403, 'origin_not_allowed')
  })

  it.each([
    'http://user:secret@127.0.0.1:5173',
    'http://127.0.0.1:5173/editor',
    'http://127.0.0.1:5173/?mode=dev',
    'http://127.0.0.1:5173/#editor',
    'null',
    'not an origin',
  ])('rejects invalid configured origin %s', (origin) => {
    expect.hasAssertions()
    expectApiError(
      () => assertLocalRequest(new Request('http://127.0.0.1:4848/api/health'), [origin]),
      500,
      'invalid_origin_config',
    )
  })
})

describe.runIf(process.platform !== 'win32')('assertPathInsideHome', () => {
  let aliasHome: string
  let outsidePath: string
  let insidePath: string
  let realHome: string
  let rootDir: string

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'session-replay-security-'))
    realHome = join(rootDir, 'real-home')
    aliasHome = join(rootDir, 'alias-home')
    outsidePath = join(rootDir, 'outside.txt')
    insidePath = join(aliasHome, 'notes', 'inside.txt')

    await mkdir(join(realHome, 'notes'), { recursive: true })
    await writeFile(join(realHome, 'notes', 'inside.txt'), 'inside', 'utf8')
    await writeFile(outsidePath, 'outside', 'utf8')
    await symlink(realHome, aliasHome)
  })

  afterEach(async () => {
    await rm(rootDir, { force: true, recursive: true })
  })

  it('accepts files under a symlinked home directory', () => {
    expect(assertPathInsideHome(insidePath, aliasHome)).toBe(insidePath)
  })

  it('expands a bare tilde to the configured home', () => {
    expect(assertPathInsideHome('~', aliasHome)).toBe(resolve(aliasHome))
  })

  it('expands a tilde path under a symlinked home', () => {
    expect(assertPathInsideHome('~/notes/inside.txt', aliasHome)).toBe(insidePath)
  })

  it.each(['~user/file', '~other', '~\\notes\\inside.txt'])(
    'rejects unsupported tilde syntax %s',
    (pathValue) => {
      expect.hasAssertions()
      expectApiError(
        () => assertPathInsideHome(pathValue, aliasHome),
        400,
        'invalid_path',
      )
    },
  )

  it.each(['~/../outside.txt', '~//../outside.txt'])(
    'rejects tilde traversal %s',
    (pathValue) => {
      expect.hasAssertions()
      expectApiError(
        () => assertPathInsideHome(pathValue, aliasHome),
        403,
        'path_not_allowed',
      )
    },
  )

  it('rejects files outside a symlinked home directory', () => {
    expect(() => assertPathInsideHome(outsidePath, aliasHome)).toThrow(
      'Path must stay under the user home directory',
    )
  })
})

function expectApiError(fn: () => unknown, status: number, code: string): void {
  try {
    fn()
    throw new Error('Expected ApiError')
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code, status })
  }
}
