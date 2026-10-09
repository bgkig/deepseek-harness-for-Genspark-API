import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_AUTO_PROMPT, triggerOf } from '../src/index.ts'

describe('triggerOf', () => {
  it('auto-continues after completion and after an output cap', () => {
    expect(triggerOf({ kind: 'completed' })).toBe('completed')
    expect(triggerOf({ kind: 'max-tokens' })).toBe('completed')
  })
  it('auto-continues after an error', () => {
    expect(triggerOf({ kind: 'error', error: { message: 'boom', code: 'QUOTA' } })).toBe('error')
  })
  it('distinguishes a human Stop from structural aborts', () => {
    expect(triggerOf({ kind: 'aborted', reason: { kind: 'user' } })).toBe('user-stop')
    expect(triggerOf({ kind: 'aborted', reason: { kind: 'parent' } })).toBeUndefined()
    expect(triggerOf({ kind: 'aborted', reason: { kind: 'disposed' } })).toBeUndefined()
  })
  it('never fires for blocked or crash-closed turns', () => {
    expect(triggerOf({ kind: 'blocked' })).toBeUndefined()
    expect(triggerOf({ kind: 'interrupted' })).toBeUndefined()
  })
})

describe('Config', () => {
  it('is off by default', () => {
    const config = Config({})
    expect(config.enabled.get()).toBe(false)
    expect(config.completedPrompt.get()).toBe(DEFAULT_AUTO_PROMPT)
    expect(config.maxConsecutive.get()).toBe(20)
  })
})
