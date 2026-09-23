import { describe, expect, it } from 'vitest'
import { liveSyncDisplayProgress, updateSyncDisplayProgress, type StorageSyncDisplayProgress } from './walletStorageProgress'
import type { WalletStorageSyncChunkProgress } from './walletStorageRuntime'

const page = (partial: Partial<WalletStorageSyncChunkProgress> = {}): WalletStorageSyncChunkProgress => ({
  phase: 'source-to-local', records: 250, completedRecords: 250, totalRecords: 250000,
  stageIndex: 0, stageCount: 12, stageName: 'transactions', stageOffset: 0, ...partial
})

describe('wallet storage progress', () => {
  it('keeps cumulative throughput beyond the 400-entry log window', () => {
    let progress: StorageSyncDisplayProgress | undefined
    for (let i = 1; i <= 1000; i++) {
      progress = updateSyncDisplayProgress(progress, page({ completedRecords: i * 250 }), i * 1000, 0)
    }
    expect(progress?.records).toBe(250000)
    expect(progress?.chunks).toBe(1000)
    expect(progress?.recordsPerSecond).toBe(250)
    expect(progress?.fraction).toBe(1)
    expect(progress?.etaSeconds).toBe(0)
  })

  it('estimates resumed work using records copied this run, not the historical checkpoint', () => {
    const first = updateSyncDisplayProgress(undefined, page({ completedRecords: 240000 }), 1000, 0)
    const next = updateSyncDisplayProgress(first, page({ completedRecords: 240250 }), 2000, 0)
    expect(next.recordsPerSecond).toBe(250)
    expect(next.etaSeconds).toBe(39)
    expect(liveSyncDisplayProgress(next, 4000).etaSeconds).toBe(78)
  })

  it('resets counters for another provider phase and ignores stale UI clock samples', () => {
    const first = updateSyncDisplayProgress(undefined, page(), 1000, 0)
    const next = updateSyncDisplayProgress(first, page({ phase: 'source-to-backup' }), 5000, 0)
    expect(next.startedAt).toBe(5000)
    expect(next.records).toBe(250)
    expect(next.chunks).toBe(1)
    expect(next.etaSeconds).toBeUndefined()
    expect(liveSyncDisplayProgress(next, 4000).elapsedSeconds).toBe(0.001)
  })

  it('keeps unknown totals unknown and completes an empty source without an infinite estimate', () => {
    const unknown = updateSyncDisplayProgress(undefined, page({ totalRecords: undefined, completedRecords: undefined }), 1000, 0)
    expect(unknown.fraction).toBeUndefined()
    expect(unknown.etaSeconds).toBeUndefined()
    const empty = updateSyncDisplayProgress(undefined, page({ records: 0, totalRecords: 0, completedRecords: 0 }), 1000, 0)
    expect(empty.fraction).toBe(1)
    expect(empty.etaSeconds).toBe(0)
    expect(empty.recordsPerSecond).toBe(0)
  })
})
