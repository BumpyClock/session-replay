import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertPathInsideHome } from '../../server/api/security'

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

  it('rejects files outside a symlinked home directory', () => {
    expect(() => assertPathInsideHome(outsidePath, aliasHome)).toThrow(
      'Path must stay under the user home directory',
    )
  })
})