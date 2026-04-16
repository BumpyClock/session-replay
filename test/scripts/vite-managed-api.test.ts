import { describe, expect, it } from 'vitest'
import { buildManagedApiCommand } from '../../scripts/vite-managed-api'

describe('buildManagedApiCommand', () => {
  it('uses the current Bun executable in watch mode when running under Bun', () => {
    expect(buildManagedApiCommand(true, '/usr/local/bin/bun')).toEqual([
      '/usr/local/bin/bun',
      ['--watch', 'server/dev.ts'],
    ])
  })

  it('falls back to bun watch when invoked outside Bun', () => {
    expect(buildManagedApiCommand(false, '/usr/bin/node')).toEqual([
      'bun',
      ['--watch', 'server/dev.ts'],
    ])
  })
})
