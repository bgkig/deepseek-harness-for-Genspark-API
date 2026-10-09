import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveProfiles } from '@deepseek-ai/dsh-llm-pi-ai/profiles'
import { gensparkProfile } from '../src/index.ts'
import { KeyRotation, memoryRotationStore, rotatingFetch } from '../src/rotation.ts'

/** Mock Genspark proxy: spent keys get the credit wall; good keys stream "ok". */
const spent = new Set<string>()
const requests: Array<{ key: string; messages: unknown[]; reasoning: unknown }> = []
let baseURL = ''
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk: Buffer) => { body += chunk.toString() })
  req.on('end', () => {
    const key = (req.headers.authorization ?? '').replace(/^Bearer /, '')
    const parsed = JSON.parse(body) as { messages: unknown[]; reasoning_effort?: unknown }
    requests.push({ key, messages: parsed.messages, reasoning: parsed.reasoning_effort })
    const headers: Record<string, string> = { 'content-type': 'text/event-stream' }
    if (spent.has(key)) headers['x-genspark-credit-wall'] = 'credit_exhausted'
    res.writeHead(200, headers)
    const text = spent.has(key) ? 'Please purchase credits' : `ok-${requests.length}`
    res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'gpt-5', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', model: 'gpt-5', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 } })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
})

beforeAll(async () => {
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
})
afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => { resolve() }) }) })

const volatile = <T>(value: T) => ({ get: () => value })

function adapterWith(keys: string[]) {
  const rotation = new KeyRotation(memoryRotationStore())
  const slots = keys.map((key, index) => ({ slot: index + 1, key }))
  const fetchImpl = rotatingFetch({ slots: () => Promise.resolve(slots), rotation })
  const profile = gensparkProfile({
    baseURL: volatile(baseURL), displayName: volatile('Genspark'),
    models: volatile([{ id: 'gpt-5', reasoning: ['minimal', 'low', 'medium', 'high'] }]),
    reasoning: volatile(undefined), streamIdleTimeoutMs: volatile(30_000),
  } as never)
  const profiles = resolveProfiles({ genspark: profile })
  const adapter = new PiAiAdapter({
    profiles: () => profiles,
    resolveApiKey: () => Promise.resolve('placeholder'),
    resolveFetch: () => fetchImpl,
    auth: {
      credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => {} },
      authContext: { env: async () => undefined, fileExists: async () => false },
    },
  })
  return { adapter, rotation }
}

async function textOf(stream: AsyncIterable<StreamChunk>): Promise<string> {
  let text = ''
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') text += chunk.text
    if (chunk.type === 'finish' && chunk.reason.kind === 'error') throw new Error(chunk.reason.failure.message)
  }
  return text
}

describe('Genspark route over the pi-ai adapter', () => {
  it('switches keys mid-conversation without losing any history, and the model never sees the credit notice', async () => {
    const { adapter, rotation } = adapterWith(['gsk-A', 'gsk-B'])
    const history: Message[] = [createUserMessage({ content: [{ type: 'text', text: 'Remember the number 42.' }] })]
    const first = await textOf(adapter.stream({ provider: 'genspark', model: 'gpt-5', messages: history, reasoningEffort: 'high' as never }))
    expect(first).toMatch(/^ok-/)
    expect(requests.at(-1)?.key).toBe('gsk-A')
    expect(requests.at(-1)?.reasoning).toBe('high')

    // Key A runs out between turns.
    spent.add('gsk-A')
    history.push(
      { id: 'a1', role: 'assistant', content: [{ type: 'text', text: first }], source: { kind: 'model', provider: 'genspark', model: 'gpt-5' } } as never,
      createUserMessage({ content: [{ type: 'text', text: 'What number did I ask you to remember?' }] }),
    )
    const before = requests.length
    const second = await textOf(adapter.stream({ provider: 'genspark', model: 'gpt-5', messages: history }))
    expect(second).toMatch(/^ok-/)
    expect(second).not.toContain('purchase')
    const attempts = requests.slice(before)
    expect(attempts.map(attempt => attempt.key)).toEqual(['gsk-A', 'gsk-B'])
    // The retried request carries the complete conversation, byte-identical.
    expect(attempts[1]!.messages).toEqual(attempts[0]!.messages)
    expect(JSON.stringify(attempts[1]!.messages)).toContain('Remember the number 42.')
    expect(rotation.pointer()).toBe(2)
  })
})
