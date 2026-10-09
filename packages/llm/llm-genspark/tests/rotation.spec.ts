import { describe, expect, it } from 'vitest'
import {
  AllKeysExhaustedError, exhaustionOf, KeyRotation, memoryRotationStore, NoKeysConfiguredError, rotatingFetch,
} from '../src/rotation.ts'
import type { KeySlot, RotationEvent } from '../src/rotation.ts'
import { parseKeyList } from '../src/service.ts'

const slots = (...numbers: number[]): KeySlot[] => numbers.map(slot => ({ slot, key: `gsk-key-${slot}` }))

/** A fake proxy: keys listed in `spent` answer with the credit wall, others with a stream. */
function fakeProxy(spent: Set<string>, seen: Array<{ key: string; body: string }>): typeof fetch {
  return async (_input, init) => {
    const headers = new Headers(init?.headers)
    const key = (headers.get('authorization') ?? '').replace(/^Bearer /, '')
    seen.push({ key, body: String(init?.body ?? '') })
    if (spent.has(key)) {
      return new Response('data: {"choices":[{"delta":{"content":"Free-plan credits can\'t be used"}}]}\n\n', {
        status: 200, headers: { 'x-genspark-credit-wall': 'credit_exhausted' },
      })
    }
    return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
}

describe('exhaustionOf', () => {
  it('treats the credit-wall header as exhaustion even on HTTP 200', () => {
    expect(exhaustionOf(new Response('', { status: 200, headers: { 'x-genspark-credit-wall': 'free_plan_block' } })))
      .toEqual({ kind: 'credit-wall', code: 'free_plan_block' })
  })
  it('rotates on 401, 402, 403 but not on 429 or 5xx', () => {
    for (const status of [401, 402, 403]) expect(exhaustionOf(new Response('', { status }))).toEqual({ kind: 'http', status })
    for (const status of [200, 429, 500, 503]) expect(exhaustionOf(new Response('', { status }))).toBeUndefined()
  })
})

describe('KeyRotation', () => {
  it('starts at the first configured slot and walks forward, wrapping after the last', () => {
    const events: RotationEvent[] = []
    const rotation = new KeyRotation(memoryRotationStore(), event => events.push(event))
    const configured = slots(1, 2, 3)
    expect(rotation.active(configured)?.slot).toBe(1)
    expect(rotation.advance(configured, 1, { kind: 'http', status: 402 })?.slot).toBe(2)
    expect(rotation.advance(configured, 2, { kind: 'http', status: 402 })?.slot).toBe(3)
    expect(rotation.advance(configured, 3, { kind: 'http', status: 402 })?.slot).toBe(1)
    expect(events.map(event => [event.from, event.to, event.wrapped])).toEqual([[1, 2, false], [2, 3, false], [3, 1, true]])
  })

  it('skips empty slots (slot 100 wraps to the lowest configured slot)', () => {
    const rotation = new KeyRotation(memoryRotationStore(100))
    const configured = slots(5, 50, 100)
    expect(rotation.active(configured)?.slot).toBe(100)
    expect(rotation.advance(configured, 100, { kind: 'credit-wall', code: 'x' })?.slot).toBe(5)
    expect(rotation.advance(configured, 5, { kind: 'credit-wall', code: 'x' })?.slot).toBe(50)
  })

  it('persists the pointer so a restart resumes on the same key', () => {
    const store = memoryRotationStore()
    const first = new KeyRotation(store)
    first.advance(slots(1, 2, 3), 1, { kind: 'http', status: 401 })
    expect(new KeyRotation(store).active(slots(1, 2, 3))?.slot).toBe(2)
  })

  it('does not double-advance when a concurrent request already moved the pointer', () => {
    const rotation = new KeyRotation(memoryRotationStore())
    const configured = slots(1, 2, 3)
    rotation.advance(configured, 1, { kind: 'http', status: 402 })
    expect(rotation.advance(configured, 1, { kind: 'http', status: 402 })?.slot).toBe(2)
  })

  it('moves off a slot whose key was removed', () => {
    const rotation = new KeyRotation(memoryRotationStore(2))
    expect(rotation.active(slots(1, 3))?.slot).toBe(3)
  })

  it('selects a slot explicitly and rejects slots outside 1..100', () => {
    const rotation = new KeyRotation(memoryRotationStore())
    rotation.select(7)
    expect(rotation.pointer()).toBe(7)
    expect(() => { rotation.select(101) }).toThrow(RangeError)
  })
})

describe('rotatingFetch', () => {
  it('re-sends the identical request with the next key the moment a key is spent', async () => {
    const seen: Array<{ key: string; body: string }> = []
    const rotation = new KeyRotation(memoryRotationStore())
    const fetchImpl = rotatingFetch({
      slots: () => Promise.resolve(slots(1, 2, 3)),
      rotation,
      fetch: fakeProxy(new Set(['gsk-key-1', 'gsk-key-2']), seen),
    })
    const body = JSON.stringify({ model: 'gpt-5', messages: [{ role: 'user', content: 'remember 42' }] })
    const response = await fetchImpl('https://proxy/v1/chat/completions', {
      method: 'POST', body, headers: { authorization: 'Bearer placeholder' },
    })
    expect(await response.text()).toBe('data: [DONE]\n\n')
    expect(seen.map(entry => entry.key)).toEqual(['gsk-key-1', 'gsk-key-2', 'gsk-key-3'])
    // Memory continuity: every attempt carried the same conversation bytes.
    expect([...new Set(seen.map(entry => entry.body))]).toEqual([body])
    expect(rotation.pointer()).toBe(3)
  })

  it('wraps from the last key back to the first', async () => {
    const seen: Array<{ key: string; body: string }> = []
    const rotation = new KeyRotation(memoryRotationStore(3))
    const fetchImpl = rotatingFetch({
      slots: () => Promise.resolve(slots(1, 2, 3)),
      rotation,
      fetch: fakeProxy(new Set(['gsk-key-3']), seen),
    })
    await fetchImpl('https://proxy/v1/chat/completions', { method: 'POST', body: '{}' })
    expect(seen.map(entry => entry.key)).toEqual(['gsk-key-3', 'gsk-key-1'])
    expect(rotation.pointer()).toBe(1)
  })

  it('fails after one full lap when every key is spent, keeping the pointer valid', async () => {
    const seen: Array<{ key: string; body: string }> = []
    const rotation = new KeyRotation(memoryRotationStore())
    const fetchImpl = rotatingFetch({
      slots: () => Promise.resolve(slots(1, 2)),
      rotation,
      fetch: fakeProxy(new Set(['gsk-key-1', 'gsk-key-2']), seen),
    })
    await expect(fetchImpl('https://proxy/v1', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(AllKeysExhaustedError)
    expect(seen).toHaveLength(2)
    expect(rotation.pointer()).toBe(1)
  })

  it('supports 100 keys', async () => {
    const all = slots(...Array.from({ length: 100 }, (_, index) => index + 1))
    const spent = new Set(all.slice(0, 99).map(slot => slot.key))
    const seen: Array<{ key: string; body: string }> = []
    const rotation = new KeyRotation(memoryRotationStore())
    const fetchImpl = rotatingFetch({ slots: () => Promise.resolve(all), rotation, fetch: fakeProxy(spent, seen) })
    await fetchImpl('https://proxy/v1', { method: 'POST', body: '{}' })
    expect(seen).toHaveLength(100)
    expect(rotation.pointer()).toBe(100)
  })

  it('reports a missing key clearly', async () => {
    const fetchImpl = rotatingFetch({ slots: () => Promise.resolve([]), rotation: new KeyRotation() })
    await expect(fetchImpl('https://proxy/v1', {})).rejects.toBeInstanceOf(NoKeysConfiguredError)
  })
})

describe('parseKeyList', () => {
  it('splits on lines, commas, and spaces, dropping comments and duplicates', () => {
    expect(parseKeyList('gsk-a\n# comment\ngsk-b, gsk-c  gsk-a\n\n')).toEqual(['gsk-a', 'gsk-b', 'gsk-c'])
  })
})
