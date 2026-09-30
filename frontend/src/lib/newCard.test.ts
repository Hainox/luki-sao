import { afterEach, describe, expect, it, vi } from 'vitest'
import { newCardId } from '@/lib/newCard'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newCardId', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('даёт UUID v4', () => {
    expect(newCardId()).toMatch(UUID_V4)
  })

  it('без crypto.randomUUID собирает UUID v4 сам', () => {
    const real = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) })
    const ids = new Set(Array.from({ length: 20 }, () => newCardId()))
    expect(ids.size).toBe(20)
    for (const id of ids) expect(id).toMatch(UUID_V4)
  })
})
