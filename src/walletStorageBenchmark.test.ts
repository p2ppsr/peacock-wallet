import { describe, expect, it, vi } from 'vitest'
import type {
  StorageIdb,
  WalletStorageManager,
  sdk
} from '@bsv/wallet-toolbox-client'
import { runWalletStorageBenchmark } from './walletStorageBenchmark'

describe('wallet storage benchmark', () => {
  it('separates continuously focused samples from background and focus-transition delays', async () => {
    vi.useFakeTimers()
    let focused = true
    let clock = 0
    const source = { makeAvailable: async () => ({ storageName: 'source' }), getSyncChunk: vi.fn() }
    const writer = { makeAvailable: async () => ({ storageName: 'local' }), processSyncChunk: vi.fn() }
    const manager = {
      getAuth: async () => ({}),
      runAsSync: async (fn: () => Promise<unknown>) => fn(),
      syncToWriter: async () => {
        clock = 110
        await vi.advanceTimersByTimeAsync(100)
        focused = false
        clock += 1000
        await vi.advanceTimersByTimeAsync(100)
        focused = true
        clock += 1000
        await vi.advanceTimersByTimeAsync(100)
        clock += 120
        await vi.advanceTimersByTimeAsync(100)
      }
    }
    try {
      const result = await runWalletStorageBenchmark({
        manager: manager as unknown as WalletStorageManager,
        source: source as unknown as sdk.WalletStorageProvider,
        writer: writer as unknown as StorageIdb,
        databaseName: 'unused', now: () => clock, isForeground: () => focused
      })
      expect(result.eventLoop).toMatchObject({
        samples: 4, p95DelayMs: 900,
        foreground: { samples: 2, maximumDelayMs: 20, p95DelayMs: 20 }
      })
      expect(vi.getTimerCount()).toBe(0)
    } finally { vi.useRealTimers() }
  })

  it('measures a one-way copy without attaching or selecting the writer', async () => {
    const chunk = {
      fromStorageIdentityKey: 'remote',
      toStorageIdentityKey: 'benchmark',
      userIdentityKey: 'user',
      transactions: [{ transactionId: 1 }, { transactionId: 2 }]
    } as unknown as sdk.SyncChunk
    const originalGetSyncChunk = vi.fn(async (_args: sdk.RequestSyncChunkArgs) => chunk)
    const originalProcessSyncChunk = vi.fn(async (
      _args: sdk.RequestSyncChunkArgs,
      _chunk: sdk.SyncChunk
    ) => ({
      done: true,
      inserts: 2,
      updates: 0,
      maxUpdated_at: new Date(0)
    }))
    const active = { getSyncChunk: originalGetSyncChunk }
    const writer = {
      makeAvailable: vi.fn(async () => ({ storageName: 'isolated local' })),
      processSyncChunk: originalProcessSyncChunk
    }
    const manager = {
      getActive: vi.fn(() => active),
      getActiveStoreName: vi.fn(() => 'remote primary'),
      getAuth: vi.fn(async () => ({ identityKey: 'user', userId: 1 })),
      syncToWriter: vi.fn(async (_auth: unknown, destination: typeof writer) => {
        const args = {
          identityKey: 'user',
          fromStorageIdentityKey: 'remote',
          toStorageIdentityKey: 'benchmark',
          maxItems: 250,
          maxRoughSize: 2 * 1024 * 1024,
          offsets: [{ name: 'transaction', offset: 0 }]
        } as sdk.RequestSyncChunkArgs
        const page = await active.getSyncChunk(args)
        await destination.processSyncChunk(args, page)
        return { inserts: 2, updates: 0, log: '' }
      }),
      addWalletStorageProvider: vi.fn(),
      setActive: vi.fn(),
      updateBackups: vi.fn()
    }
    let clock = 0

    const result = await runWalletStorageBenchmark({
      manager: manager as unknown as WalletStorageManager,
      writer: writer as unknown as StorageIdb,
      databaseName: 'wallet-toolbox-benchmark-test',
      now: () => ++clock
    })

    expect(result.totals).toMatchObject({ pages: 1, records: 2, inserts: 2, updates: 0 })
    expect(result.entities).toEqual({ transactions: 2 })
    expect(result.complete).toBe(true)
    expect(manager.addWalletStorageProvider).not.toHaveBeenCalled()
    expect(manager.setActive).not.toHaveBeenCalled()
    expect(manager.updateBackups).not.toHaveBeenCalled()
    expect(active.getSyncChunk).toBe(originalGetSyncChunk)
    expect(writer.processSyncChunk).toBe(originalProcessSyncChunk)
  })

  it.each([false, true])('reads a backup under the primary sync lock and restores hooks (failure=%s)', async failure => {
    const chunk = { transactions: [{ transactionId: 1 }] } as unknown as sdk.SyncChunk
    const read = vi.fn(async (_args: sdk.RequestSyncChunkArgs) => chunk)
    const write = vi.fn(async (_args: sdk.RequestSyncChunkArgs, _chunk: sdk.SyncChunk) => {
      if (failure) throw new Error('write failed')
      return { done: false, inserts: 1, updates: 0, maxUpdated_at: new Date(0) }
    })
    const source = { makeAvailable: vi.fn(async () => ({ storageName: 'remote backup' })), getSyncChunk: read }
    const writer = { makeAvailable: vi.fn(async () => ({ storageName: 'disposable local' })), processSyncChunk: write }
    let locked = false
    const manager = {
      getActive: vi.fn(),
      getAuth: vi.fn(async () => ({ identityKey: 'user' })),
      runAsSync: vi.fn(async (fn: () => Promise<unknown>) => {
        locked = true
        try { return await fn() } finally { locked = false }
      }),
      syncToWriter: vi.fn(async (_auth: unknown, destination: typeof writer, reader: typeof source) => {
        expect(locked).toBe(true)
        expect(reader).toBe(source)
        const args = { maxItems: 250, maxRoughSize: 2048 } as sdk.RequestSyncChunkArgs
        for (let page = 0; page < 5; page++) await destination.processSyncChunk(args, await reader.getSyncChunk(args))
      }),
      setActive: vi.fn(),
      addWalletStorageProvider: vi.fn()
    }
    const result = runWalletStorageBenchmark({
      manager: manager as unknown as WalletStorageManager,
      source: source as unknown as sdk.WalletStorageProvider,
      writer: writer as unknown as StorageIdb,
      databaseName: 'disposable', maxPages: 2
    })
    if (failure) {
      await expect(result).rejects.toThrow('write failed')
    } else {
      expect(await result).toMatchObject({ complete: false, sourceName: 'remote backup', totals: { pages: 2, records: 2, inserts: 2 } })
      expect(write).toHaveBeenCalledTimes(2)
    }
    expect(locked).toBe(false)
    expect(source.getSyncChunk).toBe(read)
    expect(writer.processSyncChunk).toBe(write)
    expect(manager.setActive).not.toHaveBeenCalled()
    expect(manager.addWalletStorageProvider).not.toHaveBeenCalled()
    expect(manager.getActive).not.toHaveBeenCalled()
  })

  it('rejects an invalid page limit before accessing storage', async () => {
    await expect(runWalletStorageBenchmark({
      manager: {} as WalletStorageManager, writer: {} as StorageIdb,
      databaseName: 'unused', maxPages: 0
    })).rejects.toThrow('page limit')
  })
})
