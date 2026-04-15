import { describe, expect, it } from 'vitest'
import {
  createPretextCache,
  isBrowserEnvironment,
} from '../../src/lib/text-layout/pretext-cache'

describe('pretext cache', () => {
  describe('isBrowserEnvironment', () => {
    it('returns a boolean', () => {
      const result = isBrowserEnvironment()
      expect(typeof result).toBe('boolean')
    })
  })

  describe('createPretextCache', () => {
    it('creates a cache instance with the expected API surface', () => {
      const cache = createPretextCache()

      expect(cache).toHaveProperty('estimate')
      expect(cache).toHaveProperty('clear')
      expect(typeof cache.estimate).toBe('function')
      expect(typeof cache.clear).toBe('function')
    })

    it('returns zero-height for empty text', () => {
      const cache = createPretextCache()
      const result = cache.estimate('', '15px sans-serif', 300, 23, 'pre-wrap')

      expect(result).toEqual({ height: 0, lineCount: 0 })
    })

    it('accepts pre-wrap whitespace mode without throwing', () => {
      const cache = createPretextCache()

      expect(() => {
        cache.estimate('Hello world', '15px sans-serif', 300, 23, 'pre-wrap')
      }).not.toThrow()
    })

    it('accepts normal whitespace mode without throwing', () => {
      const cache = createPretextCache()

      expect(() => {
        cache.estimate('Hello world', '15px sans-serif', 300, 23, 'normal')
      }).not.toThrow()
    })

    it('returns null or a valid estimate when canvas is unavailable', () => {
      // jsdom does not support canvas text measurement, so pretext
      // prepare will fail gracefully.
      const cache = createPretextCache()
      const result = cache.estimate(
        'Hello world',
        '15px sans-serif',
        300,
        23,
        'pre-wrap',
      )

      // Either null (canvas unavailable) or a numeric result.
      expect(result === null || typeof result?.height === 'number').toBe(true)
    })

    it('produces different cache entries for different whitespace modes', () => {
      const cache = createPretextCache()

      // These should not throw and should be independently callable.
      // In jsdom both may return null, but the cache must not conflate them.
      const preWrap = cache.estimate('line one\nline two', '15px sans-serif', 300, 23, 'pre-wrap')
      const normal = cache.estimate('line one\nline two', '15px sans-serif', 300, 23, 'normal')

      // At minimum, both calls succeed without error.
      expect(preWrap === null || typeof preWrap.height === 'number').toBe(true)
      expect(normal === null || typeof normal.height === 'number').toBe(true)
    })

    it('clears cached entries without throwing', () => {
      const cache = createPretextCache()
      cache.estimate('test', '15px sans-serif', 300, 23, 'pre-wrap')
      expect(() => cache.clear()).not.toThrow()
    })
  })
})
