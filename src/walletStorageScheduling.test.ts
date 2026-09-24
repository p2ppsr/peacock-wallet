import { MessageChannel } from 'node:worker_threads'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { yieldWalletStorageTask } from './walletStorageScheduling'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('wallet storage task scheduling', () => {
  it('allows a background copy to progress when animation frames never run', async () => {
    vi.stubGlobal('MessageChannel', MessageChannel)
    const animationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', animationFrame)
    let resumed = false
    const task = yieldWalletStorageTask().then(() => { resumed = true })
    expect(resumed).toBe(false)
    await task
    expect(resumed).toBe(true)
    expect(animationFrame).not.toHaveBeenCalled()
  })

  it('retains a timer fallback for hosts without message channels', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('MessageChannel', undefined)
    let resumed = false
    const task = yieldWalletStorageTask().then(() => { resumed = true })
    expect(resumed).toBe(false)
    await vi.runAllTimersAsync()
    await task
    expect(resumed).toBe(true)
  })
})
